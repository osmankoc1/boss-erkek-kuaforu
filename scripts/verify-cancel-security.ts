/**
 * Randevu iptal güvenliği testi — Faz 1.
 *
 * Çalıştırma (dev server ayakta olmalı):
 *   npx dotenv -e .env.local -- tsx scripts/verify-cancel-security.ts
 *
 * UYARI: Dev veritabanına gerçek kayıt yazar ve sonunda temizler.
 * Production endpoint'ine karşı çalışmayı reddeder.
 */

import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { assertWritableTestDatabase } from "../lib/db-guard";
import { SignJWT } from "jose";
import { temizleAuditIzleri } from "./audit-temizlik";

neonConfig.webSocketConstructor = ws;

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const TEST_TAG = "__cancel_test__";
const PHONE_PREFIX = "55577";

const { connectionString: connectionString } = assertWritableTestDatabase();

const db = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`   PASS  ${name}`); }
  else { failed++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`   FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

let seq = 0;
function nextPhone() { seq++; return `${PHONE_PREFIX}${String(seq).padStart(5, "0")}`; }

/** Test randevusu olusturur (dogrudan DB — slot dogrulamasindan bagimsiz). */
async function makeAppointment(status: string, barberId: string, serviceId: string) {
  const phone = nextPhone();
  const customer = await db.customer.create({
    data: { fullName: `Cancel Test ${seq}`, phone, email: `cancel-${seq}@example.invalid` },
  });
  const date = new Date();
  date.setDate(date.getDate() + 3);
  date.setHours(0, 0, 0, 0);
  const appt = await db.appointment.create({
    data: {
      barberId, serviceId, customerId: customer.id, date,
      startTime: "10:00", endTime: "11:00", status,
      notes: TEST_TAG, appointmentPrice: 100,
    },
  });
  return { appt, customer, phone, code: appt.id.slice(-8).toUpperCase() };
}

/**
 * Her cagri varsayilan olarak FARKLI bir IP kullanir; boylece guvenlik
 * testleri iptal rate limit'ine takilmaz. Rate limit'in kendisi TEST 11'de
 * sabit IP ile ayrica test edilir.
 */
let ipCounter = 0;
async function patch(id: string, body: Record<string, unknown>, fixedIp?: string) {
  const ip = fixedIp ?? `10.55.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;
  const res = await fetch(`${BASE_URL}/api/appointments/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

/** lib/session.ts ile ayni sekilde admin oturum cerezi uretir. */
async function adminCookie(userId: string): Promise<string> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET yok — admin testi calistirilamaz.");
  const key = new TextEncoder().encode(secret);
  const token = await new SignJWT({ userId, expiresAt: new Date(Date.now() + 7 * 864e5) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key);
  return `session=${token}`;
}

async function patchAsAdmin(id: string, body: Record<string, unknown>, cookie: string) {
  const res = await fetch(`${BASE_URL}/api/appointments/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

async function counters(customerId: string) {
  const c = await db.customer.findUnique({
    where: { id: customerId },
    select: { cancelledCount: true, completedCount: true },
  });
  return c!;
}

async function main() {
  const barber = await db.barber.findFirst({ where: { isActive: true } });
  const service = await db.service.findFirst({ where: { isActive: true } });
  if (!barber || !service) throw new Error("Aktif berber/hizmet yok.");

  try {
    // ── TEST 1 — Sadece ID bilen yabanci iptal edemez ───────────────────────
    console.log("TEST 1 — Sadece appointment ID bilen yabanci");
    const t1 = await makeAppointment("confirmed", barber.id, service.id);
    const r1 = await patch(t1.appt.id, { status: "cancelled" });
    check("Dogrulama bilgisi olmadan iptal REDDEDILDI", r1.status === 401 || r1.status === 403, `gelen ${r1.status} ${JSON.stringify(r1.body)}`);
    const s1 = await db.appointment.findUnique({ where: { id: t1.appt.id }, select: { status: true } });
    check("Randevu hala confirmed", s1?.status === "confirmed", `gelen ${s1?.status}`);
    const c1 = await counters(t1.customer.id);
    check("cancelledCount artmadi", c1.cancelledCount === 0, `gelen ${c1.cancelledCount}`);

    // ── TEST 2 — Yanlis telefon ────────────────────────────────────────────
    console.log("\nTEST 2 — Yanlis dogrulama bilgisi");
    const r2a = await patch(t1.appt.id, { status: "cancelled", phone: "5550000000", code: t1.code });
    check("Yanlis telefon -> reddedildi", r2a.status === 401 || r2a.status === 403, `gelen ${r2a.status}`);

    const r2b = await patch(t1.appt.id, { status: "cancelled", phone: t1.phone, code: "WRONGCOD" });
    check("Yanlis kod -> reddedildi", r2b.status === 401 || r2b.status === 403, `gelen ${r2b.status}`);

    const r2c = await patch(t1.appt.id, { status: "cancelled", phone: t1.phone });
    check("Kod eksik -> reddedildi", r2c.status === 401 || r2c.status === 403, `gelen ${r2c.status}`);

    const s2 = await db.appointment.findUnique({ where: { id: t1.appt.id }, select: { status: true } });
    check("Randevu hala confirmed (3 basarisiz denemeden sonra)", s2?.status === "confirmed", `gelen ${s2?.status}`);

    // ── TEST 3 — Dogru bilgi -> iptal basarili ─────────────────────────────
    console.log("\nTEST 3 — Dogru telefon + dogru kod");
    const r3 = await patch(t1.appt.id, { status: "cancelled", phone: t1.phone, code: t1.code });
    check("Dogru bilgiyle iptal BASARILI", r3.status === 200, `gelen ${r3.status} ${JSON.stringify(r3.body)}`);
    const s3 = await db.appointment.findUnique({ where: { id: t1.appt.id }, select: { status: true } });
    check("Randevu cancelled oldu", s3?.status === "cancelled", `gelen ${s3?.status}`);
    const c3 = await counters(t1.customer.id);
    check("cancelledCount tam olarak 1 arti", c3.cancelledCount === 1, `gelen ${c3.cancelledCount}`);

    // ── TEST 4 — Idempotency: ayni randevuyu tekrar iptal ───────────────────
    console.log("\nTEST 4 — Ayni randevuyu 5 kez daha iptal etmeye calis");
    const repeats = [];
    for (let i = 0; i < 5; i++) {
      repeats.push(await patch(t1.appt.id, { status: "cancelled", phone: t1.phone, code: t1.code }));
    }
    check("Tekrarli iptaller reddedildi (200 donmedi)", repeats.every((r) => r.status !== 200), `kodlar: ${repeats.map((r) => r.status).join(",")}`);
    const c4 = await counters(t1.customer.id);
    check("cancelledCount HALA 1 (yan etki yok)", c4.cancelledCount === 1, `gelen ${c4.cancelledCount}`);

    // ── TEST 5 — Gecersiz status gecisleri ─────────────────────────────────
    console.log("\nTEST 5 — Gecersiz status gecisleri");
    const t5 = await makeAppointment("completed", barber.id, service.id);
    const r5a = await patch(t5.appt.id, { status: "cancelled", phone: t5.phone, code: t5.code });
    check("completed -> cancelled REDDEDILDI", r5a.status !== 200, `gelen ${r5a.status}`);
    const s5a = await db.appointment.findUnique({ where: { id: t5.appt.id }, select: { status: true } });
    check("completed randevu degismedi", s5a?.status === "completed", `gelen ${s5a?.status}`);
    const c5a = await counters(t5.customer.id);
    check("completed randevuda cancelledCount artmadi", c5a.cancelledCount === 0, `gelen ${c5a.cancelledCount}`);

    const t5b = await makeAppointment("cancelled", barber.id, service.id);
    const r5b = await patch(t5b.appt.id, { status: "confirmed", phone: t5b.phone, code: t5b.code });
    check("cancelled -> confirmed REDDEDILDI", r5b.status !== 200, `gelen ${r5b.status}`);

    // ── TEST 6 — Public kullanici onaylayamaz/tamamlayamaz ─────────────────
    console.log("\nTEST 6 — Public kullanici sadece iptal edebilir");
    const t6 = await makeAppointment("pending", barber.id, service.id);
    const r6a = await patch(t6.appt.id, { status: "confirmed", phone: t6.phone, code: t6.code });
    check("Public 'confirmed' yapamaz", r6a.status === 401 || r6a.status === 403, `gelen ${r6a.status}`);
    const r6b = await patch(t6.appt.id, { status: "completed", phone: t6.phone, code: t6.code });
    check("Public 'completed' yapamaz", r6b.status === 401 || r6b.status === 403, `gelen ${r6b.status}`);
    const s6 = await db.appointment.findUnique({ where: { id: t6.appt.id }, select: { status: true } });
    check("Randevu hala pending", s6?.status === "pending", `gelen ${s6?.status}`);

    // ── TEST 7 — pending_verification iptali ───────────────────────────────
    console.log("\nTEST 7 — pending_verification randevu iptali");
    const t7 = await makeAppointment("pending_verification", barber.id, service.id);
    const r7 = await patch(t7.appt.id, { status: "cancelled", phone: t7.phone, code: t7.code });
    check("pending_verification -> cancelled basarili", r7.status === 200, `gelen ${r7.status}`);

    // ── TEST 8 — Kod buyuk/kucuk harf duyarsiz ─────────────────────────────
    console.log("\nTEST 8 — Kod buyuk/kucuk harf duyarsizligi");
    const t8 = await makeAppointment("confirmed", barber.id, service.id);
    const r8 = await patch(t8.appt.id, { status: "cancelled", phone: t8.phone, code: t8.code.toLowerCase() });
    check("Kucuk harfli kod kabul edildi", r8.status === 200, `gelen ${r8.status}`);

    // ── TEST 9 — Gecersiz status degeri ────────────────────────────────────
    console.log("\nTEST 9 — Tanimsiz status degeri");
    const t9 = await makeAppointment("confirmed", barber.id, service.id);
    const r9 = await patch(t9.appt.id, { status: "no_show", phone: t9.phone, code: t9.code });
    check("Bilinmeyen status reddedildi", r9.status === 400, `gelen ${r9.status}`);

    // ── TEST 10 — Var olmayan randevu ──────────────────────────────────────
    console.log("\nTEST 10 — Var olmayan randevu");
    const r10 = await patch("clzzzzzzzzzzzzzzzzzzzzzzz", { status: "cancelled", phone: "5551112233", code: "ABCD1234" });
    check("Var olmayan randevu icin 404/401", r10.status === 404 || r10.status === 401, `gelen ${r10.status}`);

    // ── TEST 11 — Kaba kuvvet rate limit ───────────────────────────────────
    console.log("\nTEST 11 — Ayni IP'den kaba kuvvet denemesi");
    const brute = await makeAppointment("confirmed", barber.id, service.id);
    const BRUTE_IP = "203.0.113.99";
    await db.rateLimit.deleteMany({ where: { key: `cancel-ip:${BRUTE_IP}` } });

    const attempts: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await patch(brute.appt.id, { status: "cancelled", phone: brute.phone, code: `BADCOD${i}` }, BRUTE_IP);
      attempts.push(r.status);
    }
    const blocked = attempts.filter((s) => s === 429).length;
    check("Kaba kuvvet denemeleri rate limit'e takildi", blocked > 0, `429 sayisi: ${blocked}, kodlar: ${attempts.join(",")}`);
    check("Hicbir yanlis deneme basarili olmadi", attempts.every((s) => s !== 200), `kodlar: ${attempts.join(",")}`);
    const bruteState = await db.appointment.findUnique({ where: { id: brute.appt.id }, select: { status: true } });
    check("Kaba kuvvet sonrasi randevu hala confirmed", bruteState?.status === "confirmed", `gelen ${bruteState?.status}`);

    // Rate limit devredeyken DOGRU bilgi de bloklanmali (kilit gercek)
    const afterBlock = await patch(brute.appt.id, { status: "cancelled", phone: brute.phone, code: brute.code }, BRUTE_IP);
    check("Rate limit devredeyken dogru bilgi de bloklandi", afterBlock.status === 429, `gelen ${afterBlock.status}`);

    // Farkli IP'den dogru bilgi calismali (limit IP bazli)
    const otherIp = await patch(brute.appt.id, { status: "cancelled", phone: brute.phone, code: brute.code });
    check("Farkli IP'den dogru bilgiyle iptal calisiyor", otherIp.status === 200, `gelen ${otherIp.status}`);

    // ── TEST 12 — Admin iptali bozulmadi ───────────────────────────────────
    console.log("\nTEST 12 — Admin oturumuyla iptal/onay/tamamlama");
    const admin = await db.user.findFirst({ select: { id: true, email: true } });
    if (!admin) {
      console.log("   ATLANDI — veritabaninda admin kullanici yok");
    } else {
      const cookie = await adminCookie(admin.id);

      // Admin, telefon/kod GONDERMEDEN iptal edebilmeli
      const a1 = await makeAppointment("confirmed", barber.id, service.id);
      const ra1 = await patchAsAdmin(a1.appt.id, { status: "cancelled" }, cookie);
      check("Admin telefon/kod olmadan iptal edebiliyor", ra1.status === 200, `gelen ${ra1.status} ${JSON.stringify(ra1.body)}`);
      const ca1 = await counters(a1.customer.id);
      check("Admin iptalinde cancelledCount tam 1", ca1.cancelledCount === 1, `gelen ${ca1.cancelledCount}`);

      // Admin tekrarli iptal -> yan etki yok
      const ra1b = await patchAsAdmin(a1.appt.id, { status: "cancelled" }, cookie);
      check("Admin tekrarli iptali reddedildi", ra1b.status === 409, `gelen ${ra1b.status}`);
      const ca1b = await counters(a1.customer.id);
      check("Admin tekrarinda sayac artmadi", ca1b.cancelledCount === 1, `gelen ${ca1b.cancelledCount}`);

      // Admin onaylama
      const a2 = await makeAppointment("pending", barber.id, service.id);
      const ra2 = await patchAsAdmin(a2.appt.id, { status: "confirmed" }, cookie);
      check("Admin pending -> confirmed yapabiliyor", ra2.status === 200, `gelen ${ra2.status}`);

      // Admin tamamlama
      const ra3 = await patchAsAdmin(a2.appt.id, { status: "completed" }, cookie);
      check("Admin confirmed -> completed yapabiliyor", ra3.status === 200, `gelen ${ra3.status}`);
      const ca3 = await counters(a2.customer.id);
      check("completedCount tam 1 arti", ca3.completedCount === 1, `gelen ${ca3.completedCount}`);

      // Status makinesi admin icin de gecerli
      const ra4 = await patchAsAdmin(a2.appt.id, { status: "cancelled" }, cookie);
      check("Admin bile completed -> cancelled yapamiyor", ra4.status === 409, `gelen ${ra4.status}`);
      const ca4 = await counters(a2.customer.id);
      check("Reddedilen adminde cancelledCount artmadi", ca4.cancelledCount === 0, `gelen ${ca4.cancelledCount}`);

      // Gecersiz cerez admin sayilmamali
      const a5 = await makeAppointment("confirmed", barber.id, service.id);
      const ra5 = await patchAsAdmin(a5.appt.id, { status: "confirmed" }, "session=gecersiz.jwt.token");
      check("Gecersiz oturum cerezi admin sayilmiyor", ra5.status === 401, `gelen ${ra5.status}`);
    }
  } finally {
    console.log("\nTEMIZLIK...");
    // Denetim izi (FAZ 2 - Sira 10b): entity'si silinen satirlar da
    // temizlenir; aksi halde dev veritabaninda birikir.
    await temizleAuditIzleri(db);
    const appts = await db.appointment.findMany({
      where: { OR: [{ notes: TEST_TAG }, { customer: { phone: { startsWith: PHONE_PREFIX } } }] },
      select: { id: true },
    });
    const ids = appts.map((a) => a.id);
    await db.appointmentService.deleteMany({ where: { appointmentId: { in: ids } } });
    const delA = await db.appointment.deleteMany({ where: { id: { in: ids } } });
    const delC = await db.customer.deleteMany({ where: { phone: { startsWith: PHONE_PREFIX } } });
    await db.rateLimit.deleteMany({ where: { action: "cancel" } });
    console.log(`  silinen: ${delA.count} randevu, ${delC.count} musteri`);
  }

  console.log("\n" + "=".repeat(64));
  console.log(`TOPLAM: ${passed + failed}   GECEN: ${passed}   KALAN: ${failed}`);
  if (failed > 0) { console.log("\nBASARISIZ:"); for (const f of failures) console.log("  - " + f); }
  console.log("=".repeat(64));
}

main()
  .then(() => db.$disconnect().then(() => process.exit(failed > 0 ? 1 : 0)))
  .catch(async (e) => { console.error("HATA:", e); await db.$disconnect(); process.exit(1); });

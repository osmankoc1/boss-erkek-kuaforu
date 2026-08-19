/**
 * Public randevu sorgulama güvenliği testi — Faz 1 · Sıra 10.
 *
 * Çalıştırma (dev server ayakta olmalı):
 *   npx dotenv -e .env.local -- tsx scripts/verify-appointment-lookup.ts
 *
 * UYARI: Dev veritabanına gerçek kayıt yazar ve sonunda temizler.
 * Production endpoint'ine karşı çalışmayı reddeder.
 */

import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { SignJWT } from "jose";
import { displayAppointmentCode } from "../lib/appointment-code";

neonConfig.webSocketConstructor = ws;

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const PROD_ENDPOINT_PREFIX = "ep-raspy-brook";
const TEST_TAG = "__lookup_test__";
const PHONE_A = "5554440001";
const PHONE_B = "5554440002";

const cs = process.env.DATABASE_URL;
if (!cs) { console.error("DATABASE_URL yok."); process.exit(1); }
const endpoint = (/@([^/.]+)/.exec(cs)?.[1] ?? "").replace(/-pooler$/, "");
if (endpoint.startsWith(PROD_ENDPOINT_PREFIX)) { console.error("DURDURULDU: production."); process.exit(1); }
console.log(`Hedef endpoint: ${endpoint.split("-").slice(0, 3).join("-")}-****  (production degil)\n`);

const db = new PrismaClient({ adapter: new PrismaNeon({ connectionString: cs }) });

let passed = 0, failed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`   PASS  ${name}`); }
  else { failed++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`   FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

let ipCounter = 0;
async function lookup(params: Record<string, string>, fixedIp?: string) {
  const qs = new URLSearchParams(params).toString();
  const ip = fixedIp ?? `10.99.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;
  const res = await fetch(`${BASE_URL}/api/appointments?${qs}`, {
    headers: { "x-forwarded-for": ip },
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text); } catch { /* html olabilir */ }
  return { status: res.status, body, raw: text };
}

/** Dahili alanlar public yanitta ASLA gorunmemeli. */
const FORBIDDEN = [
  "ipAddress", "userAgent", "riskScore", "riskReasons",
  "verificationToken", "verifiedAt", "verificationEmailSentAt",
  "reminderSent", "googleEventId", "customerId", "passwordHash",
];

async function main() {
  const barber = await db.barber.findFirst({ where: { isActive: true } });
  const service = await db.service.findFirst({ where: { isActive: true } });
  if (!barber || !service) throw new Error("Berber/hizmet yok.");

  // Musteri A: 2 randevu, Musteri B: 1 randevu
  const custA = await db.customer.create({ data: { fullName: `${TEST_TAG} A`, phone: PHONE_A, email: "a@example.invalid" } });
  const custB = await db.customer.create({ data: { fullName: `${TEST_TAG} B`, phone: PHONE_B, email: "b@example.invalid" } });

  const mk = async (customerId: string, dayOffset: number, start: string) => {
    const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(0, 0, 0, 0);
    return db.appointment.create({
      data: {
        barberId: barber.id, serviceId: service.id, customerId,
        date: d, startTime: start, endTime: "13:00", status: "confirmed",
        notes: TEST_TAG, appointmentPrice: 300,
        ipAddress: "1.2.3.4", userAgent: "test-agent", riskScore: 42,
        verificationToken: `tok_${Math.random().toString(36).slice(2)}`,
      },
    });
  };

  const a1 = await mk(custA.id, 3, "12:00");
  const a2 = await mk(custA.id, 5, "14:00");
  const b1 = await mk(custB.id, 4, "16:00");

  const codeA1 = displayAppointmentCode(a1.id);
  const codeA2 = displayAppointmentCode(a2.id);
  const codeB1 = displayAppointmentCode(b1.id);

  try {
    // ── TEST 1 — Sadece telefon ───────────────────────────────────────────
    console.log("TEST 1 — Sadece telefon numarasi ile sorgu");
    const onlyPhone = await lookup({ phone: PHONE_A });
    const leakedList = onlyPhone.status === 200 && /"appointments"\s*:\s*\[\s*\{/.test(onlyPhone.raw);
    check("Sadece telefonla randevu listesi DONMUYOR", !leakedList, `gelen ${onlyPhone.status}, ${onlyPhone.raw.slice(0, 120)}`);
    check("Uygun hata kodu (400/401/404)", [400, 401, 404].includes(onlyPhone.status), `gelen ${onlyPhone.status}`);

    // ── TEST 2 — Yanlis kod ───────────────────────────────────────────────
    console.log("\nTEST 2 — Dogru telefon + yanlis kod");
    const wrongCode = await lookup({ phone: PHONE_A, code: "ZZZZ9999" });
    check("Yanlis kod ile erisim yok", wrongCode.status === 404 || wrongCode.status === 401, `gelen ${wrongCode.status}`);
    check("Yanitta randevu verisi yok", !wrongCode.raw.includes('"startTime"'), wrongCode.raw.slice(0, 120));

    // ── TEST 3 — Yanlis telefon + dogru kod ───────────────────────────────
    console.log("\nTEST 3 — Yanlis telefon + dogru kod (baska musterinin kodu)");
    const crossed = await lookup({ phone: PHONE_B, code: codeA1 });
    check("Baska musterinin koduyla erisim yok", crossed.status === 404 || crossed.status === 401, `gelen ${crossed.status}`);
    check("Yanitta randevu verisi yok", !crossed.raw.includes('"startTime"'), crossed.raw.slice(0, 120));

    // ── TEST 4 — Dogru telefon + dogru kod ────────────────────────────────
    console.log("\nTEST 4 — Dogru telefon + dogru kod");
    const good = await lookup({ phone: PHONE_A, code: codeA1 });
    check("Erisim basarili (200)", good.status === 200, `gelen ${good.status} ${good.raw.slice(0, 150)}`);

    const appt = (good.body.appointment ?? null) as Record<string, unknown> | null;
    const list = (good.body.appointments ?? null) as unknown[] | null;
    const returned = appt ? [appt] : (list ?? []);
    check("Tam olarak 1 randevu dondu", returned.length === 1, `${returned.length}`);

    if (returned.length === 1) {
      const r = returned[0] as Record<string, unknown>;
      check("Donen randevu DOGRU olan (startTime 12:00)", r.startTime === "12:00", `gelen ${r.startTime}`);
      console.log(`      donen alanlar: ${Object.keys(r).join(", ")}`);
    }

    // ── TEST 5 — Baska randevular gorunmuyor ──────────────────────────────
    console.log("\nTEST 5 — Ayni musterinin DIGER randevusu sizmiyor");
    check("A'nin 2. randevusunun saati (14:00) yanitta YOK", !good.raw.includes('"14:00"'), "diger randevu sizdi");
    check("A'nin 2. randevusunun kodu yanitta YOK", !good.raw.toLowerCase().includes(codeA2.toLowerCase()), "diger randevu kodu sizdi");
    check("B'nin randevusu yanitta YOK", !good.raw.includes('"16:00"'), "baska musterinin randevusu sizdi");

    // Kendi kodu ile A2'ye erisebilmeli
    const goodA2 = await lookup({ phone: PHONE_A, code: codeA2 });
    check("A, 2. randevusuna kendi koduyla erisebiliyor", goodA2.status === 200 && goodA2.raw.includes('"14:00"'), `gelen ${goodA2.status}`);

    // ── TEST 6 — Dahili alanlar sizmiyor ──────────────────────────────────
    console.log("\nTEST 6 — Dahili alanlar public yanitta yok");
    for (const field of FORBIDDEN) {
      check(`'${field}' yanitta YOK`, !good.raw.includes(field), "sizdi");
    }
    check("Test verisindeki riskScore degeri (42) yanitta yok", !good.raw.includes('"riskScore":42') && !good.raw.includes("test-agent"), "dahili veri sizdi");

    // ── TEST 7 — Rate limit ───────────────────────────────────────────────
    console.log("\nTEST 7 — IP bazli rate limit");
    const RL_IP = "203.0.113.200";
    await db.rateLimit.deleteMany({ where: { key: `lookup-ip:${RL_IP}` } });
    const codes: number[] = [];
    for (let i = 0; i < 14; i++) {
      const r = await lookup({ phone: PHONE_A, code: "BADCODE1" }, RL_IP);
      codes.push(r.status);
    }
    const limited = codes.filter((c) => c === 429).length;
    check("Kaba kuvvet denemeleri rate limit'e takildi", limited > 0, `429 sayisi: ${limited}, kodlar: ${codes.join(",")}`);
    check("Hicbir yanlis deneme 200 donmedi", codes.every((c) => c !== 200), codes.join(","));

    const blockedCorrect = await lookup({ phone: PHONE_A, code: codeA1 }, RL_IP);
    check("Rate limit devredeyken dogru kod da bloklandi", blockedCorrect.status === 429, `gelen ${blockedCorrect.status}`);

    const otherIpOk = await lookup({ phone: PHONE_A, code: codeA1 });
    check("Farkli IP'den dogru kod calisiyor (limit IP bazli)", otherIpOk.status === 200, `gelen ${otherIpOk.status}`);

    // ── TEST 8 — Sorgudan sonra iptal calisiyor ───────────────────────────
    console.log("\nTEST 8 — Guvenli sorgudan sonra musteri iptali");
    const lookedUp = await lookup({ phone: PHONE_A, code: codeA1 });
    const found = (lookedUp.body.appointment ?? (lookedUp.body.appointments as unknown[])?.[0]) as Record<string, unknown> | undefined;
    const apptId = found?.id as string | undefined;
    check("Sorgu yaniti iptal icin gereken tanimlayiciyi iceriyor", !!apptId, "id yok — iptal akisi kirilir");

    if (apptId) {
      const cancel = await fetch(`${BASE_URL}/api/appointments/${apptId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "10.98.1.1" },
        body: JSON.stringify({ status: "cancelled", phone: PHONE_A, code: codeA1 }),
      });
      check("Sorgu sonrasi iptal basarili (200)", cancel.status === 200, `gelen ${cancel.status}`);
      const after = await db.appointment.findUnique({ where: { id: apptId }, select: { status: true } });
      check("Randevu cancelled oldu", after?.status === "cancelled", `gelen ${after?.status}`);

      const cancelOther = await fetch(`${BASE_URL}/api/appointments/${b1.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "10.98.1.2" },
        body: JSON.stringify({ status: "cancelled", phone: PHONE_A, code: codeB1 }),
      });
      check("A, B'nin randevusunu iptal EDEMIYOR", cancelOther.status === 401, `gelen ${cancelOther.status}`);
    }

    // ── TEST 9 — Admin tarafi etkilenmedi ─────────────────────────────────
    console.log("\nTEST 9 — Admin randevu ekranlari etkilenmiyor");
    const admin = await db.user.findFirst({ select: { id: true } });
    if (admin) {
      const key = new TextEncoder().encode(process.env.SESSION_SECRET);
      const tok = await new SignJWT({ userId: admin.id, expiresAt: new Date(Date.now() + 7 * 864e5) })
        .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(key);
      const cookie = `session=${tok}`;
      for (const p of ["/admin/randevular", "/admin/randevular?view=daily", "/admin/musteriler"]) {
        const r = await fetch(`${BASE_URL}${p}`, { headers: { Cookie: cookie }, redirect: "manual" });
        check(`Admin ${p} -> 200`, r.status === 200, `gelen ${r.status}`);
      }
      const adminSees = await fetch(`${BASE_URL}/admin/randevular`, { headers: { Cookie: cookie } });
      const html = await adminSees.text();
      check("Admin randevu listesinde test musterisi gorunuyor", html.includes(`${TEST_TAG} B`), "admin veriyi goremiyor");
    }

    // ── TEST 10 — Randevu kodu musteriye ulasiyor ─────────────────────────
    console.log("\nTEST 10 — Randevu kodu gorunur mu");
    const onay = await fetch(`${BASE_URL}/randevu/onay?id=${b1.id}`);
    const onayHtml = await onay.text();
    check("Onay sayfasi randevu kodunu gosteriyor", onayHtml.includes(codeB1), "kod onay sayfasinda yok");

    const mailSrc = await import("fs").then((fs) => fs.promises.readFile("lib/mail.ts", "utf8"));
    check(
      "E-posta sablonlarinda randevu kodu var",
      /appointmentCode|displayAppointmentCode|Randevu Kodu/i.test(mailSrc),
      "e-postalarda kod yok — musteri kodu kaybederse sorgulayamaz"
    );
  } finally {
    console.log("\nTEMIZLIK...");
    const appts = await db.appointment.findMany({ where: { notes: TEST_TAG }, select: { id: true } });
    const ids = appts.map((a) => a.id);
    await db.appointmentService.deleteMany({ where: { appointmentId: { in: ids } } });
    const delA = await db.appointment.deleteMany({ where: { id: { in: ids } } });
    const delC = await db.customer.deleteMany({ where: { phone: { in: [PHONE_A, PHONE_B] } } });
    await db.rateLimit.deleteMany({ where: { action: "lookup" } });
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

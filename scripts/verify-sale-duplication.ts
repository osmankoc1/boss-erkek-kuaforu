/**
 * Randevu başına çift kasa kaydı testi — Faz 1 · Sıra 9.
 *
 * Çalıştırma (dev server ayakta olmalı):
 *   npx dotenv -e .env.local -- tsx scripts/verify-sale-duplication.ts
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

neonConfig.webSocketConstructor = ws;

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const TEST_TAG = "__sale_dup_test__";
const PHONE_PREFIX = "55566";

const { connectionString: cs } = assertWritableTestDatabase();

const db = new PrismaClient({ adapter: new PrismaNeon({ connectionString: cs }) });

let passed = 0, failed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`   PASS  ${name}`); }
  else { failed++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`   FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

let cookie = "";
let seq = 0;

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}
async function get(path: string) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: { Cookie: cookie } });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/** Test randevusu (dogrudan DB — slot dogrulamasindan bagimsiz). */
async function makeAppointment(barberId: string, serviceId: string, price: number) {
  seq++;
  const phone = `${PHONE_PREFIX}${String(seq).padStart(5, "0")}`;
  const customer = await db.customer.create({
    data: { fullName: `${TEST_TAG} ${seq}`, phone },
  });
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  const appt = await db.appointment.create({
    data: {
      barberId, serviceId, customerId: customer.id, date,
      startTime: "12:00", endTime: "13:00", status: "confirmed",
      notes: TEST_TAG, appointmentPrice: price,
    },
  });
  return { appt, customer, phone };
}

function salePayload(appointmentId: string | null, barberId: string, serviceId: string, name: string, phone: string, amount: number) {
  return {
    appointmentId,
    barberId,
    customerName: name,
    customerPhone: phone,
    items: [{ serviceId, serviceName: "Test Hizmet", category: "Diğer", price: amount, durationMinutes: 60 }],
    saleAmount: amount,
    paidAmount: amount,
    paymentMethod: "CASH",
    note: TEST_TAG,
  };
}

async function activeSaleCount(appointmentId: string) {
  return db.sale.count({ where: { appointmentId, saleStatus: { not: "VOIDED" } } });
}
async function allSaleCount(appointmentId: string) {
  return db.sale.count({ where: { appointmentId } });
}

async function main() {
  const admin = await db.user.findFirst({ select: { id: true } });
  if (!admin) throw new Error("Admin yok.");
  const key = new TextEncoder().encode(process.env.SESSION_SECRET);
  cookie = `session=${await new SignJWT({ userId: admin.id, expiresAt: new Date(Date.now() + 7 * 864e5) })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(key)}`;

  const barber = await db.barber.findFirst({ where: { isActive: true } });
  const service = await db.service.findFirst({ where: { isActive: true } });
  if (!barber || !service) throw new Error("Berber/hizmet yok.");

  const AMOUNT = 250;

  try {
    // ── TEST 1 — Ilk kasa kaydi ───────────────────────────────────────────
    console.log("TEST 1 — Onayli randevu icin ilk kasa kaydi");
    const t1 = await makeAppointment(barber.id, service.id, AMOUNT);
    const r1 = await post("/api/cash", salePayload(t1.appt.id, barber.id, service.id, `${TEST_TAG} A`, t1.phone, AMOUNT));
    check("Ilk kasa kaydi -> 201", r1.status === 201, `gelen ${r1.status} ${JSON.stringify(r1.body).slice(0, 150)}`);
    check("Veritabaninda 1 aktif satis", (await activeSaleCount(t1.appt.id)) === 1, `${await activeSaleCount(t1.appt.id)}`);
    const apptAfter = await db.appointment.findUnique({ where: { id: t1.appt.id }, select: { status: true } });
    check("Randevu 'completed' oldu", apptAfter?.status === "completed", `gelen ${apptAfter?.status}`);
    const custAfter = await db.customer.findUnique({ where: { id: t1.customer.id }, select: { completedCount: true } });
    check("completedCount tam 1", custAfter?.completedCount === 1, `gelen ${custAfter?.completedCount}`);

    // ── TEST 2 — Ayni appointmentId ile ikinci POST ───────────────────────
    console.log("\nTEST 2 — Ayni appointmentId ile ikinci POST (replay)");
    const r2 = await post("/api/cash", salePayload(t1.appt.id, barber.id, service.id, `${TEST_TAG} A`, t1.phone, AMOUNT));
    check("Ikinci POST -> 409", r2.status === 409, `gelen ${r2.status} ${JSON.stringify(r2.body).slice(0, 150)}`);
    check("Hala tek aktif satis", (await activeSaleCount(t1.appt.id)) === 1, `${await activeSaleCount(t1.appt.id)}`);
    const cust2 = await db.customer.findUnique({ where: { id: t1.customer.id }, select: { completedCount: true } });
    check("completedCount hala 1 (yan etki yok)", cust2?.completedCount === 1, `gelen ${cust2?.completedCount}`);

    // ── TEST 3 — 10 paralel POST ──────────────────────────────────────────
    console.log("\nTEST 3 — 10 PARALEL POST (race condition)");
    const t3 = await makeAppointment(barber.id, service.id, AMOUNT);
    const t0 = Date.now();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        post("/api/cash", salePayload(t3.appt.id, barber.id, service.id, `${TEST_TAG} B`, t3.phone, AMOUNT))
      )
    );
    const elapsed = Date.now() - t0;
    const ok = results.filter((r) => r.status === 201).length;
    const conflict = results.filter((r) => r.status === 409).length;
    const other = results.filter((r) => r.status !== 201 && r.status !== 409);
    console.log(`   (10 istek ${elapsed} ms) 201: ${ok}  409: ${conflict}  diger: ${other.length}`);
    check("Tam olarak 1 istek basarili", ok === 1, `gelen ${ok}`);
    check("Diger 9 istek 409", conflict === 9, `gelen ${conflict}`);
    check("Beklenmeyen durum kodu yok", other.length === 0, JSON.stringify(other.map((o) => o.status)));
    check("Veritabaninda TEK aktif satis", (await activeSaleCount(t3.appt.id)) === 1, `${await activeSaleCount(t3.appt.id)}`);
    const cust3 = await db.customer.findUnique({ where: { id: t3.customer.id }, select: { completedCount: true } });
    check("completedCount tam 1 (10 paralel istege ragmen)", cust3?.completedCount === 1, `gelen ${cust3?.completedCount}`);

    // ── TEST 4 — Kasa ekrani ──────────────────────────────────────────────
    console.log("\nTEST 4 — Kasa ekraninda tek satis");
    const kasa = await get(`/api/cash?appointmentId=${t3.appt.id}`);
    const kasaSales = (kasa.body.sales as unknown[]) ?? [];
    check("Kasa API tek kayit donduruyor", kasaSales.length === 1, `${kasaSales.length}`);

    // ── TEST 5 — Gun Sonu tutari ──────────────────────────────────────────
    console.log("\nTEST 5 — Gun Sonu tutari bir kez sayiliyor");
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const dayEnd = await get(`/api/day-end?date=${dateStr}`);
    const testSalesToday = await db.sale.findMany({
      where: { note: TEST_TAG, saleStatus: { not: "VOIDED" } },
      select: { saleAmount: true },
    });
    const expectedFromTests = testSalesToday.reduce((s, r) => s + r.saleAmount, 0);
    check(
      `Gun Sonu'nda test satislari beklenen tutarda (${expectedFromTests} TL, ${testSalesToday.length} satis)`,
      testSalesToday.length === 2,
      `${testSalesToday.length} aktif test satisi (2 bekleniyor: TEST1 + TEST3)`
    );
    check("Gun Sonu API calisiyor", dayEnd.status === 200, `gelen ${dayEnd.status}`);

    // ── TEST 6 — Hakedis bir kez ──────────────────────────────────────────
    console.log("\nTEST 6 — Hakedis bir kez olusuyor");
    const saleRows = await db.sale.findMany({
      where: { appointmentId: t3.appt.id, saleStatus: { not: "VOIDED" } },
      select: { barberShare: true, businessShare: true, saleAmount: true },
    });
    check("Tek satis kaydi -> tek hakedis", saleRows.length === 1, `${saleRows.length}`);
    const commissions = await get(`/api/commissions?range=today`);
    check("Hakedis API calisiyor", commissions.status === 200, `gelen ${commissions.status}`);

    // ── TEST 7 — Randevusuz manuel satislar ───────────────────────────────
    console.log("\nTEST 7 — Randevusuz manuel satislar bozulmadi");
    const m1 = await post("/api/cash", salePayload(null, barber.id, service.id, `${TEST_TAG} Manuel1`, "", 100));
    const m2 = await post("/api/cash", salePayload(null, barber.id, service.id, `${TEST_TAG} Manuel2`, "", 150));
    check("1. manuel satis -> 201", m1.status === 201, `gelen ${m1.status}`);
    check("2. manuel satis -> 201 (engellenmiyor)", m2.status === 201, `gelen ${m2.status}`);
    const manualCount = await db.sale.count({ where: { note: TEST_TAG, appointmentId: null } });
    check("Iki manuel satis da kaydedildi", manualCount === 2, `${manualCount}`);

    // ── TEST 8 — VOIDED sonrasi davranis (is kurali: rehber md. 425) ──────
    console.log("\nTEST 8 — VOIDED satis sonrasi yeniden satis");
    console.log("   (is kurali: rehber 'Yanlis fiyat girildiyse: Void edin, tekrar dogru tutar ile girin')");
    const t8 = await makeAppointment(barber.id, service.id, AMOUNT);
    const s8 = await post("/api/cash", salePayload(t8.appt.id, barber.id, service.id, `${TEST_TAG} C`, t8.phone, 999));
    check("Ilk (yanlis tutarli) satis -> 201", s8.status === 201, `gelen ${s8.status}`);
    const sale8 = s8.body.sale as { id?: string } | undefined;

    // Void oncesi ikinci satis engelli olmali
    const beforeVoid = await post("/api/cash", salePayload(t8.appt.id, barber.id, service.id, `${TEST_TAG} C`, t8.phone, AMOUNT));
    check("Void ONCESI ikinci satis -> 409", beforeVoid.status === 409, `gelen ${beforeVoid.status}`);

    if (sale8?.id) {
      const v = await post(`/api/cash/${sale8.id}/void`, { voidReason: TEST_TAG });
      check("Void islemi basarili", v.status === 200, `gelen ${v.status}`);

      const afterVoid = await post("/api/cash", salePayload(t8.appt.id, barber.id, service.id, `${TEST_TAG} C`, t8.phone, AMOUNT));
      check("Void SONRASI dogru tutarla yeni satis -> 201 (is kuralina uygun)", afterVoid.status === 201, `gelen ${afterVoid.status} ${JSON.stringify(afterVoid.body).slice(0, 120)}`);
      check("Aktif satis sayisi 1", (await activeSaleCount(t8.appt.id)) === 1, `${await activeSaleCount(t8.appt.id)}`);
      check("Toplam satis (VOIDED dahil) 2", (await allSaleCount(t8.appt.id)) === 2, `${await allSaleCount(t8.appt.id)}`);

      const afterVoid2 = await post("/api/cash", salePayload(t8.appt.id, barber.id, service.id, `${TEST_TAG} C`, t8.phone, AMOUNT));
      check("Yeni satistan sonra ucuncu deneme -> 409", afterVoid2.status === 409, `gelen ${afterVoid2.status}`);
    }

    // ── TEST 9 — Var olmayan randevu ──────────────────────────────────────
    console.log("\nTEST 9 — Var olmayan randevu");
    const nf = await post("/api/cash", salePayload("clzzzzzzzzzzzzzzzzzzzzzz", barber.id, service.id, `${TEST_TAG} X`, "", AMOUNT));
    check("Var olmayan randevu -> 404", nf.status === 404, `gelen ${nf.status}`);

    // ── TEST 10 — Oturumsuz erisim ────────────────────────────────────────
    console.log("\nTEST 10 — Oturumsuz erisim");
    const saved = cookie; cookie = "";
    const unauth = await post("/api/cash", salePayload(null, barber.id, service.id, `${TEST_TAG} Y`, "", 50));
    cookie = saved;
    check("Oturumsuz kasa kaydi -> 401", unauth.status === 401, `gelen ${unauth.status}`);
  } finally {
    console.log("\nTEMIZLIK...");
    const sales = await db.sale.findMany({
      where: { OR: [{ note: TEST_TAG }, { customerName: { contains: TEST_TAG } }, { appointment: { notes: TEST_TAG } }] },
      select: { id: true },
    });
    const saleIds = sales.map((s) => s.id);
    await db.customerPayment.deleteMany({ where: { saleId: { in: saleIds } } });
    await db.saleItem.deleteMany({ where: { saleId: { in: saleIds } } });
    const delS = await db.sale.deleteMany({ where: { id: { in: saleIds } } });
    const appts = await db.appointment.findMany({ where: { notes: TEST_TAG }, select: { id: true } });
    const apptIds = appts.map((a) => a.id);
    await db.appointmentService.deleteMany({ where: { appointmentId: { in: apptIds } } });
    const delA = await db.appointment.deleteMany({ where: { id: { in: apptIds } } });
    const delC = await db.customer.deleteMany({ where: { phone: { startsWith: PHONE_PREFIX } } });
    console.log(`  silinen: ${delS.count} satis, ${delA.count} randevu, ${delC.count} musteri`);
  }

  console.log("\n" + "=".repeat(64));
  console.log(`TOPLAM: ${passed + failed}   GECEN: ${passed}   KALAN: ${failed}`);
  if (failed > 0) { console.log("\nBASARISIZ:"); for (const f of failures) console.log("  - " + f); }
  console.log("=".repeat(64));
}

main()
  .then(() => db.$disconnect().then(() => process.exit(failed > 0 ? 1 : 0)))
  .catch(async (e) => { console.error("HATA:", e); await db.$disconnect(); process.exit(1); });

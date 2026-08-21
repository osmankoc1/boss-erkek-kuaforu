/**
 * POST /api/appointments sunucu tarafı slot doğrulaması — uçtan uca test.
 *
 * Çalıştırma (dev server ayakta olmalı):
 *   npx dotenv -e .env.local -- tsx scripts/verify-booking-api.ts
 *
 * UYARI: Bu script dev veritabanına GERÇEK kayıt yazar ve sonunda
 * kendi oluşturduğu kayıtları siler. Production'a karşı ÇALIŞTIRILMAMALIDIR
 * — bu yüzden başlangıçta endpoint kontrolü yapar.
 */

import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { assertWritableTestDatabase } from "../lib/db-guard";
import { minutesToTime, timeToMinutes } from "../lib/booking-rules";

neonConfig.webSocketConstructor = ws;

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const TEST_TAG = "__slot_test__";

const { connectionString: connectionString } = assertWritableTestDatabase();


const adapter = new PrismaNeon({ connectionString });
const db = new PrismaClient({ adapter });

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`   PASS  ${name}`);
  } else {
    failed++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`   FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Public randevu istegi. Her cagridan once IP rate limit kayitlarini temizler. */
async function postAppointment(payload: Record<string, unknown>) {
  await db.rateLimit.deleteMany({ where: { action: "appointment" } });
  const res = await fetch(`${BASE_URL}/api/appointments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/** dateStr icin yerel gun basi (route'daki new Date(dateStr) ile ayni yorum). */
function localDayStart(dateStr: string): Date {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function main() {
  // ── Test verisini bul ─────────────────────────────────────────────────────
  const barber = await db.barber.findFirst({
    where: { isActive: true },
    include: { workingHours: true },
  });
  if (!barber) throw new Error("Aktif berber yok — test calistirilamaz.");

  const service = await db.service.findFirst({ where: { isActive: true } });
  if (!service) throw new Error("Aktif hizmet yok — test calistirilamaz.");

  // Berberin calistigi, bugunden sonraki ilk gunu bul
  let target: { dateStr: string; start: number; end: number } | null = null;
  for (let offset = 1; offset <= 14 && !target; offset++) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    d.setHours(0, 0, 0, 0);
    const wh = barber.workingHours.find((h) => h.dayOfWeek === d.getDay() && !h.isOff);
    if (!wh) continue;
    const start = timeToMinutes(wh.startTime);
    const end = timeToMinutes(wh.endTime);
    if (start === null || end === null) continue;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    target = { dateStr: `${year}-${month}-${day}`, start, end };
  }
  if (!target) throw new Error("Berberin onumuzdeki 14 gun icinde calistigi gun yok.");

  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  console.log(`Berber   : ${barber.name}`);
  console.log(`Hizmet   : ${service.name} (${service.durationMinutes} dk)`);
  console.log(`Test gunu: ${target.dateStr}  calisma ${minutesToTime(target.start)}-${minutesToTime(target.end)}`);
  console.log(`Bugun    : ${todayStr}\n`);

  // Test slotu: calisma penceresinin sonuna yakin, bos olmasi muhtemel
  const slotStart = Math.max(target.start, target.end - service.durationMinutes - 30);
  const freeSlot = minutesToTime(slotStart);

  const base = {
    serviceIds: [service.id],
    barberId: barber.id,
    date: target.dateStr,
    notes: TEST_TAG,
  };

  const createdApptIds: string[] = [];
  const createdCustomerPhones: string[] = [];
  let exceptionId: string | null = null;

  try {
    // ── TEST A — Gecerli bos slot -> 201 ────────────────────────────────────
    console.log("TEST A — Gecerli bos slota POST");
    const phoneA = "5559990001";
    const a = await postAppointment({
      ...base,
      startTime: freeSlot,
      customerName: "Slot Test A",
      customerPhone: phoneA,
      customerEmail: "slot-test-a@example.invalid",
    });
    createdCustomerPhones.push(phoneA);
    check("Gecerli bos slot -> 201", a.status === 201, `gelen ${a.status} ${JSON.stringify(a.body)}`);
    if (a.body?.id) createdApptIds.push(a.body.id);

    // Kayit gercekten dogru olustu mu (normal akis bozulmadi mi)
    if (a.body?.id) {
      const saved = await db.appointment.findUnique({
        where: { id: a.body.id },
        include: { services: true, customer: true },
      });
      check("Randevu veritabanina yazildi", saved !== null);
      check("Durum pending_verification", saved?.status === "pending_verification", `gelen ${saved?.status}`);
      check("startTime dogru", saved?.startTime === freeSlot, `gelen ${saved?.startTime}`);
      check(
        "endTime dogru hesaplandi",
        saved?.endTime === minutesToTime(slotStart + service.durationMinutes),
        `gelen ${saved?.endTime}`
      );
      check("AppointmentService satiri olustu", (saved?.services.length ?? 0) === 1);
      check("appointmentPrice yazildi", saved?.appointmentPrice === service.price, `gelen ${saved?.appointmentPrice}`);
      check("Musteri kaydi olustu", saved?.customer.phone === phoneA);
      check("verificationToken uretildi", !!saved?.verificationToken);
    }

    // ── TEST B — Ayni slot, farkli musteri -> 409 SLOT_TAKEN ────────────────
    console.log("\nTEST B — Dolu slota dogrudan POST");
    const phoneB = "5559990002";
    const b = await postAppointment({
      ...base,
      startTime: freeSlot,
      customerName: "Slot Test B",
      customerPhone: phoneB,
      customerEmail: "slot-test-b@example.invalid",
    });
    createdCustomerPhones.push(phoneB);
    check("Dolu slot -> 409", b.status === 409, `gelen ${b.status}`);
    check("Kod SLOT_TAKEN", b.body?.code === "SLOT_TAKEN", `gelen ${b.body?.code}`);
    check("Turkce mesaj dondu", typeof b.body?.error === "string" && b.body.error.length > 0, `${b.body?.error}`);
    if (b.body?.id) createdApptIds.push(b.body.id);

    // ── TEST C — Gecmis saat -> 409 IN_PAST ─────────────────────────────────
    console.log("\nTEST C — Gecmis saate POST (bugun 00:15)");
    const phoneC = "5559990003";
    const c = await postAppointment({
      ...base,
      date: todayStr,
      startTime: "00:15",
      customerName: "Slot Test C",
      customerPhone: phoneC,
      customerEmail: "slot-test-c@example.invalid",
    });
    createdCustomerPhones.push(phoneC);
    check("Gecmis saat -> 409", c.status === 409, `gelen ${c.status}`);
    check("Kod IN_PAST", c.body?.code === "IN_PAST", `gelen ${c.body?.code}`);
    if (c.body?.id) createdApptIds.push(c.body.id);

    // ── TEST D — Calisma saati disi -> 409 OUTSIDE_WORKING_HOURS ────────────
    console.log("\nTEST D — Calisma saati disina POST");
    const outsideSlot = minutesToTime(Math.min(23 * 60 + 30, target.end + 120));
    const phoneD = "5559990004";
    const d = await postAppointment({
      ...base,
      startTime: outsideSlot,
      customerName: "Slot Test D",
      customerPhone: phoneD,
      customerEmail: "slot-test-d@example.invalid",
    });
    createdCustomerPhones.push(phoneD);
    check(`Calisma saati disi (${outsideSlot}) -> 409`, d.status === 409, `gelen ${d.status}`);
    check("Kod OUTSIDE_WORKING_HOURS", d.body?.code === "OUTSIDE_WORKING_HOURS", `gelen ${d.body?.code}`);
    if (d.body?.id) createdApptIds.push(d.body.id);

    // ── TEST E — Izinli gun -> 409 DATE_EXCEPTION ───────────────────────────
    console.log("\nTEST E — Izinli gune POST");
    const created = await db.dateException.create({
      data: { barberId: barber.id, date: localDayStart(target.dateStr), reason: TEST_TAG },
    });
    exceptionId = created.id;

    const freeSlot2 = minutesToTime(Math.max(target.start, slotStart - 120));
    const phoneE = "5559990005";
    const e = await postAppointment({
      ...base,
      startTime: freeSlot2,
      customerName: "Slot Test E",
      customerPhone: phoneE,
      customerEmail: "slot-test-e@example.invalid",
    });
    createdCustomerPhones.push(phoneE);
    check("Izinli gun -> 409", e.status === 409, `gelen ${e.status}`);
    check("Kod DATE_EXCEPTION", e.body?.code === "DATE_EXCEPTION", `gelen ${e.body?.code}`);
    if (e.body?.id) createdApptIds.push(e.body.id);

    await db.dateException.delete({ where: { id: exceptionId } });
    exceptionId = null;

    // ── TEST F — Izin kalkinca ayni slot kabul edilir ───────────────────────
    console.log("\nTEST F — Izin kaldirildiktan sonra ayni slot");
    const phoneF = "5559990006";
    const f = await postAppointment({
      ...base,
      startTime: freeSlot2,
      customerName: "Slot Test F",
      customerPhone: phoneF,
      customerEmail: "slot-test-f@example.invalid",
    });
    createdCustomerPhones.push(phoneF);
    check("Izin kalkinca ayni slot -> 201", f.status === 201, `gelen ${f.status} ${JSON.stringify(f.body)}`);
    if (f.body?.id) createdApptIds.push(f.body.id);

    // ── TEST G — 409 alan istekler yan etki birakmadi mi ────────────────────
    console.log("\nTEST G — Reddedilen istekler yan etki birakmadi");
    for (const phone of [phoneB, phoneC, phoneD, phoneE]) {
      const cust = await db.customer.findUnique({ where: { phone } });
      check(`Reddedilen istek musteri kaydi olusturmadi (${phone})`, cust === null, cust ? "musteri olusmus" : "");
    }
  } finally {
    // ── Temizlik ────────────────────────────────────────────────────────────
    console.log("\nTEMIZLIK...");
    if (exceptionId) {
      await db.dateException.delete({ where: { id: exceptionId } }).catch(() => {});
    }
    const deletedExceptions = await db.dateException.deleteMany({ where: { reason: TEST_TAG } });
    const testAppts = await db.appointment.findMany({
      where: { OR: [{ id: { in: createdApptIds } }, { notes: TEST_TAG }] },
      select: { id: true, customerId: true },
    });
    const apptIds = testAppts.map((a) => a.id);
    await db.appointmentService.deleteMany({ where: { appointmentId: { in: apptIds } } });
    const deletedAppts = await db.appointment.deleteMany({ where: { id: { in: apptIds } } });
    const deletedCustomers = await db.customer.deleteMany({
      where: { phone: { in: createdCustomerPhones } },
    });
    await db.rateLimit.deleteMany({ where: { action: "appointment" } });
    console.log(
      `  silinen: ${deletedAppts.count} randevu, ${deletedCustomers.count} musteri, ${deletedExceptions.count} izin kaydi`
    );
  }

  console.log("\n" + "=".repeat(64));
  console.log(`TOPLAM: ${passed + failed}   GECEN: ${passed}   KALAN: ${failed}`);
  if (failed > 0) {
    console.log("\nBASARISIZ:");
    for (const f of failures) console.log("  - " + f);
  }
  console.log("=".repeat(64));
}

main()
  .then(() => db.$disconnect().then(() => process.exit(failed > 0 ? 1 : 0)))
  .catch(async (error) => {
    console.error("HATA:", error);
    await db.$disconnect();
    process.exit(1);
  });

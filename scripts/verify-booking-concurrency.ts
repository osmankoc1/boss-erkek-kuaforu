/**
 * Eşzamanlı randevu (race condition) testi — Faz 1 · Sıra 8.
 *
 * Çalıştırma (dev server ayakta olmalı):
 *   npx dotenv -e .env.local -- tsx scripts/verify-booking-concurrency.ts
 *
 * UYARI: Dev veritabanına gerçek kayıt yazar ve sonunda temizler.
 * Production endpoint'ine karşı çalışmayı reddeder.
 *
 * Rate limit'e takılmamak için her istek farklı bir x-forwarded-for
 * gönderir (rate limit anahtarı IP bazlıdır).
 */

import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { assertWritableTestDatabase } from "../lib/db-guard";
import { BLOCKING_STATUSES, minutesToTime, timeToMinutes } from "../lib/booking-rules";

neonConfig.webSocketConstructor = ws;

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const TEST_TAG = "__race_test__";
const PHONE_PREFIX = "55588";

const { connectionString: connectionString } = assertWritableTestDatabase();

const db = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`   PASS  ${name}`); }
  else { failed++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`   FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

type PostResult = { status: number; code?: string; id?: string; error?: string };

let phoneCounter = 0;
const usedPhones: string[] = [];
function nextPhone(): string {
  phoneCounter++;
  const phone = `${PHONE_PREFIX}${String(phoneCounter).padStart(5, "0")}`;
  usedPhones.push(phone);
  return phone;
}

async function post(payload: Record<string, unknown>, ipSuffix: number): Promise<PostResult> {
  const res = await fetch(`${BASE_URL}/api/appointments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Her istek farkli IP -> rate limit testi bozmaz
      "x-forwarded-for": `10.77.${Math.floor(ipSuffix / 250)}.${(ipSuffix % 250) + 1}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, code: body?.code, id: body?.id, error: body?.error };
}

function dateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function main() {
  const barbers = await db.barber.findMany({ where: { isActive: true }, include: { workingHours: true } });
  if (barbers.length === 0) throw new Error("Aktif berber yok.");
  const service = await db.service.findFirst({ where: { isActive: true } });
  if (!service) throw new Error("Aktif hizmet yok.");

  /** Berberin calistigi ilk gunu bulur (fromOffset gunu dahil). */
  function findWorkday(barber: (typeof barbers)[number], fromOffset = 1) {
    for (let offset = fromOffset; offset <= 21; offset++) {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      d.setHours(0, 0, 0, 0);
      const wh = barber.workingHours.find((h) => h.dayOfWeek === d.getDay() && !h.isOff);
      if (!wh) continue;
      const start = timeToMinutes(wh.startTime);
      const end = timeToMinutes(wh.endTime);
      if (start === null || end === null) continue;
      return { dateStr: dateStr(d), start, end, offset };
    }
    return null;
  }

  const primary = barbers[0];
  const day = findWorkday(primary);
  if (!day) throw new Error("Berberin calistigi gun bulunamadi.");

  console.log(`Berber : ${primary.name}`);
  console.log(`Hizmet : ${service.name} (${service.durationMinutes} dk)`);
  console.log(`Gun    : ${day.dateStr}  ${minutesToTime(day.start)}-${minutesToTime(day.end)}\n`);

  try {
    // ── TEST A — Ayni slota 10 paralel istek ────────────────────────────────
    console.log("TEST A — Ayni berber + ayni slot: 10 PARALEL istek");
    const raceSlot = minutesToTime(Math.max(day.start, day.end - service.durationMinutes - 60));
    const N = 10;

    const t0 = Date.now();
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        post(
          {
            serviceIds: [service.id],
            barberId: primary.id,
            date: day.dateStr,
            startTime: raceSlot,
            customerName: `Race ${i}`,
            customerPhone: nextPhone(),
            customerEmail: `race-${i}@example.invalid`,
            notes: TEST_TAG,
          },
          i
        )
      )
    );
    const elapsed = Date.now() - t0;

    const created = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);
    const others = results.filter((r) => r.status !== 201 && r.status !== 409);

    console.log(`   (${N} istek ${elapsed} ms'de tamamlandi)`);
    console.log(`   201: ${created.length}   409: ${conflicts.length}   diger: ${others.length}`);
    if (others.length > 0) {
      console.log(`   diger yanitlar: ${JSON.stringify(others.slice(0, 3))}`);
    }

    check("Tam olarak 1 istek basarili (201)", created.length === 1, `gelen ${created.length}`);
    check(`Diger ${N - 1} istek 409 aldi`, conflicts.length === N - 1, `gelen ${conflicts.length}`);
    check("Beklenmeyen durum kodu yok (500/429 vb.)", others.length === 0, JSON.stringify(others.map((o) => o.status)));
    check(
      "Tum 409'lar SLOT_TAKEN",
      conflicts.length > 0 && conflicts.every((r) => r.code === "SLOT_TAKEN"),
      `kodlar: ${[...new Set(conflicts.map((r) => r.code))].join(",")}`
    );

    // Veritabani gercegi
    const dayStart = new Date(day.dateStr); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    const activeInSlot = await db.appointment.findMany({
      where: {
        barberId: primary.id,
        date: { gte: dayStart, lt: dayEnd },
        startTime: raceSlot,
        status: { in: [...BLOCKING_STATUSES] },
      },
      select: { id: true, startTime: true, endTime: true },
    });
    check("Veritabaninda o slotta TEK aktif randevu", activeInSlot.length === 1, `gelen ${activeInSlot.length}`);

    // Yetim musteri kalmadi mi (409 alanlar musteri olusturmamali)
    const orphans = await db.customer.count({
      where: { phone: { startsWith: PHONE_PREFIX }, appointments: { none: {} } },
    });
    check("Reddedilen istekler yetim musteri birakmadi", orphans === 0, `${orphans} yetim`);

    // ── TEST B — Ayni berber + ayni gun, FARKLI slotlar paralel ─────────────
    console.log("\nTEST B — Ayni berber + ayni gun, FARKLI slotlar: 5 PARALEL istek");
    const step = service.durationMinutes;
    const slots: string[] = [];
    for (let i = 0; i < 5; i++) {
      const m = day.start + i * step;
      if (m + service.durationMinutes <= day.end) slots.push(minutesToTime(m));
    }

    const t1 = Date.now();
    const bResults = await Promise.all(
      slots.map((slot, i) =>
        post(
          {
            serviceIds: [service.id],
            barberId: primary.id,
            date: day.dateStr,
            startTime: slot,
            customerName: `Distinct ${i}`,
            customerPhone: nextPhone(),
            customerEmail: `distinct-${i}@example.invalid`,
            notes: TEST_TAG,
          },
          100 + i
        )
      )
    );
    const elapsed1 = Date.now() - t1;
    const bOk = bResults.filter((r) => r.status === 201);
    console.log(`   (${slots.length} istek ${elapsed1} ms'de tamamlandi — slotlar: ${slots.join(", ")})`);
    console.log(`   201: ${bOk.length}   diger: ${bResults.length - bOk.length}`);
    check(
      "Farkli slotlarin HEPSI basarili — kilit gereksiz yere engellemiyor",
      bOk.length === slots.length,
      `${bOk.length}/${slots.length}, yanitlar: ${JSON.stringify(bResults.filter((r) => r.status !== 201))}`
    );

    // ── TEST C — Farkli berberler paralel ───────────────────────────────────
    const second = barbers.find((b) => b.id !== primary.id);
    if (second) {
      const day2 = findWorkday(second);
      if (day2) {
        console.log(`\nTEST C — Farkli berberler paralel (${primary.name} + ${second.name})`);
        const slotP = minutesToTime(Math.max(day.start, day.end - service.durationMinutes - 180));
        const slotS = minutesToTime(Math.max(day2.start, day2.end - service.durationMinutes - 180));
        const cResults = await Promise.all([
          post({ serviceIds: [service.id], barberId: primary.id, date: day.dateStr, startTime: slotP,
                 customerName: "Cross A", customerPhone: nextPhone(), customerEmail: "cross-a@example.invalid", notes: TEST_TAG }, 200),
          post({ serviceIds: [service.id], barberId: second.id, date: day2.dateStr, startTime: slotS,
                 customerName: "Cross B", customerPhone: nextPhone(), customerEmail: "cross-b@example.invalid", notes: TEST_TAG }, 201),
        ]);
        check(
          "Farkli berberler birbirini engellemiyor",
          cResults.every((r) => r.status === 201),
          JSON.stringify(cResults)
        );
      } else {
        console.log("\nTEST C — atlandi (ikinci berberin calisma gunu yok)");
      }
    } else {
      console.log("\nTEST C — atlandi (tek aktif berber var)");
    }

    // ── TEST D — Kilit birakildi mi (arka arkaya istekler takilmiyor) ───────
    // Onceki testlerin doldurdugu gunden bagimsiz olmasi icin AYRI bir gunde.
    const cleanDay = findWorkday(primary, day.offset + 1) ?? day;
    console.log(`\nTEST D — Kilit transaction sonunda birakiliyor (gun: ${cleanDay.dateStr})`);
    const freeSlot = minutesToTime(cleanDay.start);

    const d0 = Date.now();
    const seq1 = await post({ serviceIds: [service.id], barberId: primary.id, date: cleanDay.dateStr, startTime: freeSlot,
      customerName: "Seq 1", customerPhone: nextPhone(), customerEmail: "seq1@example.invalid", notes: TEST_TAG }, 300);
    const seq2 = await post({ serviceIds: [service.id], barberId: primary.id, date: cleanDay.dateStr, startTime: freeSlot,
      customerName: "Seq 2", customerPhone: nextPhone(), customerEmail: "seq2@example.invalid", notes: TEST_TAG }, 301);
    const seqElapsed = Date.now() - d0;

    check("Ilk sirali istek 201", seq1.status === 201, `gelen ${seq1.status} ${seq1.error ?? ""}`);
    check("Ikinci sirali istek 409 SLOT_TAKEN", seq2.status === 409 && seq2.code === "SLOT_TAKEN", `gelen ${seq2.status}/${seq2.code}`);
    check(
      `Ikinci istek kilitte beklemedi (${seqElapsed} ms < 10000)`,
      seqElapsed < 10_000,
      `${seqElapsed} ms — kilit birakilmamis olabilir`
    );

    const stuck = await db.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM pg_locks WHERE locktype = 'advisory'
    `;
    check("Sunucuda asili kalan advisory lock yok", Number(stuck[0]?.count ?? 0) === 0, `${stuck[0]?.count} lock`);
  } finally {
    // ── Temizlik ────────────────────────────────────────────────────────────
    console.log("\nTEMIZLIK...");
    const appts = await db.appointment.findMany({
      where: { OR: [{ notes: TEST_TAG }, { customer: { phone: { startsWith: PHONE_PREFIX } } }] },
      select: { id: true },
    });
    const ids = appts.map((a) => a.id);
    await db.appointmentService.deleteMany({ where: { appointmentId: { in: ids } } });
    const delAppts = await db.appointment.deleteMany({ where: { id: { in: ids } } });
    const delCustomers = await db.customer.deleteMany({ where: { phone: { startsWith: PHONE_PREFIX } } });
    await db.rateLimit.deleteMany({ where: { action: "appointment" } });
    console.log(`  silinen: ${delAppts.count} randevu, ${delCustomers.count} musteri (${usedPhones.length} telefon kullanildi)`);
  }

  console.log("\n" + "=".repeat(64));
  console.log(`TOPLAM: ${passed + failed}   GECEN: ${passed}   KALAN: ${failed}`);
  if (failed > 0) { console.log("\nBASARISIZ:"); for (const f of failures) console.log("  - " + f); }
  console.log("=".repeat(64));
}

main()
  .then(() => db.$disconnect().then(() => process.exit(failed > 0 ? 1 : 0)))
  .catch(async (error) => {
    console.error("HATA:", error);
    await db.$disconnect();
    process.exit(1);
  });

/**
 * lib/booking-rules.ts doğrulama script'i.
 *
 * Çalıştırma:  npx tsx scripts/verify-booking-rules.ts
 *
 * ÖNEMLİ: Bu script yalnızca saf kural katmanını import eder.
 * Veritabanına BAĞLANMAZ ve hiçbir kayıt yazmaz.
 */

import {
  buildSlots,
  evaluateBookingSlot,
  rangesOverlap,
  timeToMinutes,
  type BookingContext,
  type BookingIssueCode,
} from "../lib/booking-rules";

// ── Mini test koşucusu ───────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`   PASS  ${name}`);
  } else {
    failed++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`   FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function group(title: string) {
  console.log(`\n${title}`);
}

// ── Ortak bağlam ─────────────────────────────────────────────────────────────

/** 15 Eylül 2026, yerel gece yarısı. */
const DAY = new Date(2026, 8, 15, 0, 0, 0, 0);
/** Aynı günün sabahı — 14:00 slotu bu ana göre gelecektedir. */
const MORNING = new Date(2026, 8, 15, 8, 0, 0, 0);

function ctx(overrides: Partial<BookingContext> = {}): BookingContext {
  return {
    barber: { id: "b1", isActive: true },
    workingHour: { startTime: "09:00", endTime: "19:00", isOff: false },
    hasDateException: false,
    existingAppointments: [],
    dayStart: DAY,
    startTime: "14:00",
    durationMinutes: 30,
    now: MORNING,
    ...overrides,
  };
}

function expectOk(name: string, c: BookingContext) {
  const result = evaluateBookingSlot(c);
  check(name, result.ok === true, result.ok ? "" : `beklenen ok, gelen ${result.code}`);
}

function expectCode(name: string, c: BookingContext, code: BookingIssueCode) {
  const result = evaluateBookingSlot(c);
  check(
    name,
    result.ok === false && result.code === code,
    result.ok ? "beklenen red, gelen ok" : `beklenen ${code}, gelen ${result.code}`
  );
}

const appt = (id: string, startTime: string, endTime: string) => ({ id, startTime, endTime });

// ── TEST 1 — Kısmi çakışma ───────────────────────────────────────────────────

group("TEST 1 — Kismi cakisma");

expectCode(
  "14:00-15:00 dolu iken 14:30-15:00 reddedilir (sona binen)",
  ctx({ startTime: "14:30", durationMinutes: 30, existingAppointments: [appt("a1", "14:00", "15:00")] }),
  "SLOT_TAKEN"
);

expectCode(
  "14:00-15:00 dolu iken 13:30-14:30 reddedilir (basa binen)",
  ctx({ startTime: "13:30", durationMinutes: 60, existingAppointments: [appt("a1", "14:00", "15:00")] }),
  "SLOT_TAKEN"
);

expectCode(
  "14:00-15:00 dolu iken 13:00-16:00 reddedilir (tamamen kapsayan)",
  ctx({ startTime: "13:00", durationMinutes: 180, existingAppointments: [appt("a1", "14:00", "15:00")] }),
  "SLOT_TAKEN"
);

expectCode(
  "14:00-16:00 dolu iken 14:30-15:00 reddedilir (icine gomulu)",
  ctx({ startTime: "14:30", durationMinutes: 30, existingAppointments: [appt("a1", "14:00", "16:00")] }),
  "SLOT_TAKEN"
);

// ── TEST 2 — Tam çakışma ─────────────────────────────────────────────────────

group("TEST 2 — Tam cakisma");

expectCode(
  "Birebir ayni aralik reddedilir",
  ctx({ startTime: "14:00", durationMinutes: 30, existingAppointments: [appt("a1", "14:00", "14:30")] }),
  "SLOT_TAKEN"
);

expectCode(
  "Ayni baslangic farkli sure reddedilir",
  ctx({ startTime: "14:00", durationMinutes: 90, existingAppointments: [appt("a1", "14:00", "14:30")] }),
  "SLOT_TAKEN"
);

expectOk(
  "Bos gunde ayni saat kabul edilir",
  ctx({ startTime: "14:00", durationMinutes: 30, existingAppointments: [] })
);

expectOk(
  "excludeAppointmentId verilince kendi kaydiyla cakisma sayilmaz",
  ctx({
    startTime: "14:00",
    durationMinutes: 30,
    existingAppointments: [appt("self", "14:00", "14:30")],
    excludeAppointmentId: "self",
  })
);

expectCode(
  "excludeAppointmentId baska kaydi maskelemez",
  ctx({
    startTime: "14:00",
    durationMinutes: 30,
    existingAppointments: [appt("self", "14:00", "14:30"), appt("other", "14:00", "14:30")],
    excludeAppointmentId: "self",
  }),
  "SLOT_TAKEN"
);

// ── TEST 3 — Çalışma saati sınırları ─────────────────────────────────────────

group("TEST 3 — Calisma saati sinirlari");

expectOk("Tam acilista baslayan slot kabul edilir (09:00)", ctx({ startTime: "09:00" }));

expectCode(
  "Acilistan once reddedilir (08:30)",
  ctx({ startTime: "08:30" }),
  "OUTSIDE_WORKING_HOURS"
);

expectOk(
  "Kapanisa tam oturan slot kabul edilir (18:30 + 30dk = 19:00)",
  ctx({ startTime: "18:30", durationMinutes: 30 })
);

expectCode(
  "Kapanisi 15dk asan slot reddedilir (18:45 + 30dk = 19:15)",
  ctx({ startTime: "18:45", durationMinutes: 30 }),
  "OUTSIDE_WORKING_HOURS"
);

expectCode(
  "Calisma saati disi tamamen reddedilir (20:00)",
  ctx({ startTime: "20:00" }),
  "OUTSIDE_WORKING_HOURS"
);

expectCode(
  "Bozuk calisma saati kaydi DAY_OFF olarak ele alinir",
  ctx({ workingHour: { startTime: "19:00", endTime: "09:00", isOff: false } }),
  "DAY_OFF"
);

// ── TEST 4 — Kapalı gün ──────────────────────────────────────────────────────

group("TEST 4 — Kapali gun");

expectCode("isOff=true olan gun reddedilir", ctx({ workingHour: { startTime: "09:00", endTime: "19:00", isOff: true } }), "DAY_OFF");
expectCode("Calisma saati kaydi olmayan gun reddedilir", ctx({ workingHour: null }), "DAY_OFF");
expectCode("Berber bulunamazsa reddedilir", ctx({ barber: null }), "BARBER_NOT_FOUND");
expectCode("Pasif berber reddedilir", ctx({ barber: { id: "b1", isActive: false } }), "BARBER_INACTIVE");

// ── TEST 5 — DateException / izin ────────────────────────────────────────────

group("TEST 5 — DateException / izin gunu");

expectCode("Izin gunu reddedilir", ctx({ hasDateException: true }), "DATE_EXCEPTION");

expectCode(
  "Izin, bos gun + gecerli saat olsa bile reddedilir",
  ctx({ hasDateException: true, startTime: "10:00", existingAppointments: [] }),
  "DATE_EXCEPTION"
);

expectOk("Izin kalkinca ayni slot kabul edilir", ctx({ hasDateException: false, startTime: "10:00" }));

// ── TEST 6 — Geçmiş tarih ve saat ────────────────────────────────────────────

group("TEST 6 — Gecmis tarih ve saat");

expectCode(
  "Bugunun gecmis saati reddedilir (saat 16:00 iken 14:00)",
  ctx({ startTime: "14:00", now: new Date(2026, 8, 15, 16, 0) }),
  "IN_PAST"
);

expectOk(
  "Bugunun ilerideki saati kabul edilir (saat 16:00 iken 17:00)",
  ctx({ startTime: "17:00", now: new Date(2026, 8, 15, 16, 0) })
);

expectCode(
  "Dunun tarihi reddedilir",
  ctx({ startTime: "14:00", now: new Date(2026, 8, 16, 10, 0) }),
  "IN_PAST"
);

expectOk(
  "Yarinin tarihi kabul edilir",
  ctx({ startTime: "14:00", now: new Date(2026, 8, 14, 10, 0) })
);

expectOk(
  "allowPast=true ile admin gecmise kayit girebilir",
  ctx({ startTime: "14:00", now: new Date(2026, 8, 16, 10, 0), allowPast: true })
);

expectCode(
  "Gecmis kontrolu cakisma kontrolunden once raporlanir",
  ctx({
    startTime: "14:00",
    now: new Date(2026, 8, 15, 16, 0),
    existingAppointments: [appt("a1", "14:00", "14:30")],
  }),
  "IN_PAST"
);

// ── TEST 7 — Sınır teması (arka arkaya randevular) ───────────────────────────

group("TEST 7 — Arka arkaya randevularda sinir temasi");

expectOk(
  "14:00-14:30 dolu iken 14:30 baslangic kabul edilir",
  ctx({ startTime: "14:30", durationMinutes: 30, existingAppointments: [appt("a1", "14:00", "14:30")] })
);

expectOk(
  "14:30-15:00 dolu iken 14:00-14:30 kabul edilir",
  ctx({ startTime: "14:00", durationMinutes: 30, existingAppointments: [appt("a1", "14:30", "15:00")] })
);

expectOk(
  "Iki randevu arasindaki tam bosluga sigar (13:30-14:00 ve 14:30-15:00 arasi 14:00)",
  ctx({
    startTime: "14:00",
    durationMinutes: 30,
    existingAppointments: [appt("a1", "13:30", "14:00"), appt("a2", "14:30", "15:00")],
  })
);

expectCode(
  "Bosluktan 1 dk uzun hizmet sigmaz",
  ctx({
    startTime: "14:00",
    durationMinutes: 31,
    existingAppointments: [appt("a1", "13:30", "14:00"), appt("a2", "14:30", "15:00")],
  }),
  "SLOT_TAKEN"
);

check(
  "rangesOverlap: sinir temasi cakisma degildir",
  rangesOverlap({ startMinutes: 840, endMinutes: 870 }, { startMinutes: 870, endMinutes: 900 }) === false
);

check(
  "rangesOverlap: 1 dakikalik binisme cakismadir",
  rangesOverlap({ startMinutes: 840, endMinutes: 871 }, { startMinutes: 870, endMinutes: 900 }) === true
);

// ── TEST 8 — /api/availability davranış regresyonu ───────────────────────────

group("TEST 8 — /api/availability davranis regresyonu (eski algoritma vs yeni)");

/** getAvailableSlots'un refactor ONCESI slot uretme algoritmasi — birebir kopya. */
function legacyBuildSlots(
  windowStart: string,
  windowEnd: string,
  durationMinutes: number,
  existing: { startTime: string; endTime: string }[]
): string[] {
  const t2m = (time: string) => {
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
  };
  const slots: string[] = [];
  const [startH, startM] = windowStart.split(":").map(Number);
  const [endH, endM] = windowEnd.split(":").map(Number);
  let current = startH * 60 + startM;
  const end = endH * 60 + endM;

  while (current + durationMinutes <= end) {
    const slotStart = `${String(Math.floor(current / 60)).padStart(2, "0")}:${String(current % 60).padStart(2, "0")}`;
    const isOccupied = existing.some((a) => {
      const apptStart = t2m(a.startTime);
      const apptEnd = t2m(a.endTime);
      return current < apptEnd && current + durationMinutes > apptStart;
    });
    if (!isOccupied) slots.push(slotStart);
    current += 30;
  }
  return slots;
}

function newBuildSlots(
  windowStart: string,
  windowEnd: string,
  durationMinutes: number,
  existing: { startTime: string; endTime: string }[]
): string[] {
  return buildSlots({
    windowStartMinutes: timeToMinutes(windowStart)!,
    windowEndMinutes: timeToMinutes(windowEnd)!,
    durationMinutes,
    busy: existing.map((a) => ({
      startMinutes: timeToMinutes(a.startTime)!,
      endMinutes: timeToMinutes(a.endTime)!,
    })),
  });
}

// Elle secilmis senaryolar
const scenarios: {
  name: string;
  window: [string, string];
  duration: number;
  existing: { startTime: string; endTime: string }[];
}[] = [
  { name: "Bos gun 09-19 / 30dk", window: ["09:00", "19:00"], duration: 30, existing: [] },
  { name: "Bos gun 09-19 / 45dk", window: ["09:00", "19:00"], duration: 45, existing: [] },
  { name: "Bos gun 09-19 / 60dk", window: ["09:00", "19:00"], duration: 60, existing: [] },
  { name: "Bos gun 09:30-18:15 / 30dk", window: ["09:30", "18:15"], duration: 30, existing: [] },
  {
    name: "Tek randevu ortada",
    window: ["09:00", "19:00"],
    duration: 30,
    existing: [{ startTime: "14:00", endTime: "14:30" }],
  },
  {
    name: "Uzun randevu",
    window: ["09:00", "19:00"],
    duration: 30,
    existing: [{ startTime: "12:00", endTime: "15:00" }],
  },
  {
    name: "Cok randevu",
    window: ["09:00", "19:00"],
    duration: 60,
    existing: [
      { startTime: "09:00", endTime: "10:00" },
      { startTime: "11:30", endTime: "12:15" },
      { startTime: "16:00", endTime: "17:30" },
    ],
  },
  {
    name: "Gun tamamen dolu",
    window: ["09:00", "12:00"],
    duration: 30,
    existing: [{ startTime: "09:00", endTime: "12:00" }],
  },
  { name: "Sure pencereye sigmiyor", window: ["09:00", "10:00"], duration: 120, existing: [] },
];

for (const s of scenarios) {
  const legacy = legacyBuildSlots(s.window[0], s.window[1], s.duration, s.existing);
  const modern = newBuildSlots(s.window[0], s.window[1], s.duration, s.existing);
  check(
    `Ayni cikti: ${s.name} (${legacy.length} slot)`,
    JSON.stringify(legacy) === JSON.stringify(modern),
    `eski=${JSON.stringify(legacy)} yeni=${JSON.stringify(modern)}`
  );
}

// Deterministik fuzz karsilastirmasi
let seed = 20260915;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const m2t = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

let fuzzMismatch = 0;
const FUZZ_RUNS = 500;
for (let i = 0; i < FUZZ_RUNS; i++) {
  const wStart = pick(6 * 60, 12 * 60);
  const wEnd = wStart + pick(60, 12 * 60);
  const duration = pick(1, 180);
  const count = pick(0, 6);
  const existing: { startTime: string; endTime: string }[] = [];
  for (let j = 0; j < count; j++) {
    const aStart = pick(wStart - 60, wEnd + 60);
    const aEnd = aStart + pick(15, 180);
    existing.push({ startTime: m2t(aStart), endTime: m2t(aEnd) });
  }
  const legacy = legacyBuildSlots(m2t(wStart), m2t(wEnd), duration, existing);
  const modern = newBuildSlots(m2t(wStart), m2t(wEnd), duration, existing);
  if (JSON.stringify(legacy) !== JSON.stringify(modern)) fuzzMismatch++;
}
check(`Fuzz karsilastirmasi: ${FUZZ_RUNS} rastgele senaryoda fark yok`, fuzzMismatch === 0, `${fuzzMismatch} uyusmazlik`);

// ── Sonuç ────────────────────────────────────────────────────────────────────

console.log("\n" + "=".repeat(64));
console.log(`TOPLAM: ${passed + failed}   GECEN: ${passed}   KALAN: ${failed}`);
if (failed > 0) {
  console.log("\nBASARISIZ TESTLER:");
  for (const f of failures) console.log("  - " + f);
}
console.log("=".repeat(64));

process.exit(failed > 0 ? 1 : 0);

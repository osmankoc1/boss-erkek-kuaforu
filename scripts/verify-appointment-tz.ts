/**
 * Randevu tarafı saat dilimi denetimi (FAZ 2 · Sıra 1 tamamlayıcı).
 *
 * Çalıştırma (DB ve dev server GEREKMEZ — tamamen saf):
 *   npx tsx scripts/verify-appointment-tz.ts
 *   TZ=UTC npx tsx scripts/verify-appointment-tz.ts     ← Vercel production
 *
 * DEPOLAMA GERÇEĞİ (önce doğrulandı, varsayılmadı):
 *   `Appointment.date`  = takvim gününün UTC gece yarısı (2026-07-04T00:00:00.000Z)
 *   `Appointment.startTime` = "HH:MM" metni (İstanbul duvar saati)
 * Yani `date` bir AN değil, gün etiketidir. Gün penceresi sorguları bu
 * etiketle eşleştiği sürece doğrudur.
 *
 * Bu test, randevu tarafındaki tarih kullanımlarını bu gerçeğe göre sınar ve
 * hangilerinin gerçekten bozuk, hangilerinin doğru olduğunu ayırır.
 */
import {
  startOfLocalDay,
  startOfNextLocalDay,
  slotInstant,
  resolveEarliestStartMinutes,
  timeToMinutes,
  localDayOfWeek,
} from "../lib/booking-rules";

/** timeToMinutes null donebiliyor; testte gecerli saatler kullaniliyor. */
const dakika = (t: string): number => {
  const v = timeToMinutes(t);
  if (v === null || v === undefined) throw new Error(`gecersiz saat: ${t}`);
  return v;
};
import { istanbulDateString, istanbulInstant, startOfIstanbulDay } from "../lib/tz";
import { readFileSync } from "node:fs";

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

const TZ = process.env.TZ ?? "(tanimsiz)";
console.log(`Calisan surecin TZ degeri  : ${TZ}`);
console.log(`Intl cozumlenen saat dilimi: ${Intl.DateTimeFormat().resolvedOptions().timeZone}\n`);

const istRef = (d: Date) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Istanbul",
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);

/** `Appointment.date` alanının deposundaki biçim. */
const gunEtiketi = (gun: string) => new Date(`${gun}T00:00:00.000Z`);

/** Ürün kodu: müşteri/admin randevu oluştururken `new Date(dateStr)`. */
const girdiTarihi = (gun: string) => new Date(gun);

/** Ürün kodunun "bugün" değeri (randevular, CalendarView, BookingForm, modal). */
const urunBugun = (now: Date) => istanbulDateString(now);

const GUNLER = ["2026-08-21", "2026-08-31", "2026-09-01", "2026-12-31", "2027-01-01", "2028-02-29"];

/** İstanbul saatiyle tanımlı anlar (kritik pencere 00:00–02:59 dahil). */
const ANLAR: { etiket: string; utc: string; istGun: string }[] = [
  { etiket: "00:30 Istanbul", utc: "2026-08-20T21:30:00.000Z", istGun: "2026-08-21" },
  { etiket: "01:00 Istanbul", utc: "2026-08-20T22:00:00.000Z", istGun: "2026-08-21" },
  { etiket: "02:59 Istanbul", utc: "2026-08-20T23:59:00.000Z", istGun: "2026-08-21" },
  { etiket: "03:00 Istanbul", utc: "2026-08-21T00:00:00.000Z", istGun: "2026-08-21" },
  { etiket: "10:00 Istanbul", utc: "2026-08-21T07:00:00.000Z", istGun: "2026-08-21" },
  { etiket: "23:59 Istanbul", utc: "2026-08-21T20:59:00.000Z", istGun: "2026-08-21" },
  { etiket: "1 Eyl 00:30 (ay basi)", utc: "2026-08-31T21:30:00.000Z", istGun: "2026-09-01" },
  { etiket: "1 Oca 00:30 (yil basi)", utc: "2026-12-31T21:30:00.000Z", istGun: "2027-01-01" },
];

function main() {
  // ── TEST 1 — Gün penceresi, gün etiketiyle eşleşiyor mu ────────────────
  console.log("TEST 1 — Gun penceresi `date` etiketini dogru esliyor");
  console.log("        (musteri + admin randevu olusturma, cakisma kontrolu, slot listesi)");
  for (const gun of GUNLER) {
    const d = girdiTarihi(gun);
    const dayStart = startOfLocalDay(d);
    const dayEnd = startOfNextLocalDay(d);
    const etiket = gunEtiketi(gun);
    const icinde = etiket.getTime() >= dayStart.getTime() && etiket.getTime() < dayEnd.getTime();
    check(`${gun}: kendi kaydi pencerede`, icinde,
      `etiket ${etiket.toISOString()} | pencere ${dayStart.toISOString()} .. ${dayEnd.toISOString()}`);

    const oncekiGun = new Date(etiket.getTime() - 86400000);
    const sonrakiGun = new Date(etiket.getTime() + 86400000);
    check(`  ...onceki gunun kaydi DISARIDA`,
      !(oncekiGun.getTime() >= dayStart.getTime() && oncekiGun.getTime() < dayEnd.getTime()), "iceri girdi");
    check(`  ...sonraki gunun kaydi DISARIDA`,
      !(sonrakiGun.getTime() >= dayStart.getTime() && sonrakiGun.getTime() < dayEnd.getTime()), "iceri girdi");
  }

  // ── TEST 2 — Haftanın günü (çalışma saati eşleşmesi) ───────────────────
  console.log("\nTEST 2 — dayOfWeek dogru (calisma saati / izin gunu eslesmesi)");
  for (const gun of GUNLER) {
    const dayStart = startOfLocalDay(girdiTarihi(gun));
    const [y, m, d] = gun.split("-").map(Number);
    const beklenen = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    // Urun kodu (availability.ts, booking-guard.ts) localDayOfWeek kullanir.
    check(`${gun}: dayOfWeek = ${beklenen}`, localDayOfWeek(dayStart) === beklenen,
      `hesaplanan ${localDayOfWeek(dayStart)}`);
  }

  // ── TEST 3 — Slot anı gerçekten İstanbul duvar saatine denk mi ─────────
  console.log("\nTEST 3 — slotInstant('09:00') gercek Istanbul 09:00'a denk mi");
  for (const gun of GUNLER) {
    const dayStart = startOfLocalDay(girdiTarihi(gun));
    const an = slotInstant(dayStart, dakika("09:00"));
    const [y, m, d] = gun.split("-").map(Number);
    const gercek09 = istanbulInstant(y, m, d, 9, 0, 0, 0);
    check(`${gun} 09:00 slotu = Istanbul 09:00`, an.getTime() === gercek09.getTime(),
      `hesaplanan ${istRef(an)} | gercek ${istRef(gercek09)}`);
  }

  // ── TEST 4 — Geçmiş slot filtresi (Faz 1 · Sıra 6) ─────────────────────
  console.log("\nTEST 4 — Gecmis saat filtresi dogru saati eliyor");
  {
    const gun = "2026-08-21";
    const dayStart = startOfLocalDay(girdiTarihi(gun));
    // Istanbul saat 10:00; 09:00 ve 09:30 slotlari GECMISTE kalmali.
    const now = istanbulInstant(2026, 8, 21, 10, 0, 0, 0);
    const enErken = resolveEarliestStartMinutes({ dayStart, now });
    check("10:00 Istanbul'da filtre devrede (null degil)", enErken !== null, `deger ${enErken}`);
    check("  ...esik = 600 dakika (10:00)", enErken === 600, `hesaplanan ${enErken} dakika`);
    for (const [saat, gecmisMi] of [["09:00", true], ["09:30", true], ["10:00", false], ["11:00", false]] as [string, boolean][]) {
      const dk = dakika(saat);
      const elendi = enErken !== null && dk < enErken;
      check(`  ...${saat} ${gecmisMi ? "ELENMELI" : "gosterilmeli"}`, elendi === gecmisMi,
        elendi ? "elendi" : "gosteriliyor");
    }
  }

  // ── TEST 5 — IN_PAST kontrolü (doğrudan API çağrısında) ────────────────
  console.log("\nTEST 5 — IN_PAST: gecmis slot dogrudan API'den alinamamali");
  {
    const gun = "2026-08-21";
    const dayStart = startOfLocalDay(girdiTarihi(gun));
    const now = istanbulInstant(2026, 8, 21, 10, 0, 0, 0); // Istanbul 10:00
    for (const saat of ["08:00", "09:00", "09:30"]) {
      const an = slotInstant(dayStart, dakika(saat));
      check(`${saat} slotu gecmis sayiliyor (IN_PAST)`, an.getTime() < now.getTime(),
        `slot ani ${istRef(an)} >= simdi ${istRef(now)}`);
    }
    for (const saat of ["11:00", "14:00"]) {
      const an = slotInstant(dayStart, dakika(saat));
      check(`${saat} slotu gelecekte`, an.getTime() >= now.getTime(), `slot ani ${istRef(an)}`);
    }
  }

  // ── TEST 6 — Gün tamamen geçmişte mi (00:00–02:59 penceresi) ───────────
  console.log("\nTEST 6 — 00:00-02:59 Istanbul'da 'dun' tamamen gecmis sayilmali");
  for (const a of ANLAR.filter((x) => x.etiket.includes("00:30") || x.etiket.includes("01:00") || x.etiket.includes("02:59"))) {
    const now = new Date(a.utc);
    const dun = startOfIstanbulDay(new Date(now.getTime() - 86400000));
    const dunStr = istanbulDateString(dun);
    const dayStart = startOfLocalDay(girdiTarihi(dunStr));
    const sonuc = resolveEarliestStartMinutes({ dayStart, now });
    check(`${a.etiket}: ${dunStr} tamamen gecmis (null)`, sonuc === null, `donen ${sonuc}`);
  }

  // ── TEST 7 — Ekranların "bugün" değeri ─────────────────────────────────
  console.log("\nTEST 7 — Randevu ekranlarinin 'bugun' varsayilani");
  console.log("        (randevular/page.tsx, CalendarView, BookingForm min, AdminAppointmentModal)");
  for (const a of ANLAR) {
    const now = new Date(a.utc);
    check(`${a.etiket} -> '${a.istGun}'`, urunBugun(now) === a.istGun, `uretilen '${urunBugun(now)}'`);
  }

  // ── TEST 8 — Randevu kodunda sunucu-yerel "bugün" deseni kalmadı ──────
  console.log("\nTEST 8 — Randevu kodunda sunucu-yerel 'bugun' deseni kalmadi");
  const DOSYALAR = [
    "lib/booking-rules.ts",
    "lib/availability.ts",
    "lib/booking-guard.ts",
    "app/(admin)/admin/(protected)/randevular/page.tsx",
    "app/(admin)/admin/(protected)/randevular/CalendarView.tsx",
    "app/(admin)/admin/(protected)/randevular/AdminAppointmentModal.tsx",
    "app/(site)/randevu/BookingForm.tsx",
  ];
  // Yorumlar taranmaz: eski davranışı ANLATAN açıklamalar bulgu değildir.
  const yorumsuz = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");
  for (const f of DOSYALAR) {
    const src = yorumsuz(readFileSync(f, "utf8"));
    // "Şimdi"den gün üretimi: new Date() -> toISOString()
    const kirik = /new Date\(\)\.toISOString\(\)/.test(src);
    check(
      `${f.replace("app/(admin)/admin/(protected)/", ".../")} · new Date().toISOString() yok`,
      !kirik,
      "sunucu-yerel 'bugun' deseni duruyor"
    );
  }
  const kuralSrc = readFileSync("lib/booking-rules.ts", "utf8");
  check("lib/booking-rules.ts setHours kullanmiyor", !/setHours\(/.test(yorumsuz(kuralSrc)));
  check("lib/booking-rules.ts lib/tz'den besleniyor", /from "\.\/tz"/.test(kuralSrc));

  console.log("\n" + "=".repeat(66));
  console.log(`TOPLAM: ${passed + failed}   GECEN: ${passed}   KALAN: ${failed}   (TZ=${TZ})`);
  if (failed > 0) {
    console.log("\nBASARISIZ:");
    for (const f of failures) console.log("  - " + f);
  }
  console.log("=".repeat(66));
}

main();
process.exit(failed > 0 ? 1 : 0);

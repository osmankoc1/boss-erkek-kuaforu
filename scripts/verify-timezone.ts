/**
 * Europe/Istanbul gün/ay/yıl sınırı testi (FAZ 2 · Sıra 1).
 *
 * Çalıştırma (dev server ve DB GEREKMEZ — tamamen saf):
 *   npx dotenv -e .env.local -- tsx scripts/verify-timezone.ts
 *
 * Sunucunun saat dilimini taklit etmek için TZ ile çalıştırılabilir:
 *   TZ=UTC              npx tsx scripts/verify-timezone.ts   ← Vercel production
 *   TZ=Europe/Istanbul  npx tsx scripts/verify-timezone.ts   ← geliştirici makinesi
 *
 * DOĞRU davranış: iki koşu da BİREBİR aynı sonucu vermeli. Fark varsa iş
 * mantığı sunucunun saat dilimine bağımlı demektir.
 */
import { startOfDay, endOfDay } from "../lib/sale";
import {
  istanbulDateString,
  startOfIstanbulDay,
  startOfNextIstanbulDay,
  startOfIstanbulMonth,
  startOfNextIstanbulMonth,
  startOfIstanbulWeek,
  addIstanbulDays,
  istanbulDayOfWeek,
} from "../lib/tz";
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
console.log(`Calisan surecin TZ degeri : ${TZ}`);
console.log(`Intl cozumlenen saat dilimi: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
console.log(`UTC ofseti (dakika)        : ${-new Date().getTimezoneOffset()}\n`);

/** Bir anın Europe/Istanbul takvimindeki karşılığı — referans doğru cevap. */
function istanbulRef(date: Date) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(date)) p[part.type] = part.value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    month: `${p.year}-${p.month}`,
    year: p.year,
    time: `${p.hour}:${p.minute}`,
  };
}

/** Test anları: İstanbul saatiyle tanımlanır, UTC instant olarak kurulur. */
const ANLAR: { etiket: string; utc: string; beklenenGun: string; beklenenAy: string; beklenenYil: string }[] = [
  { etiket: "00:30 Istanbul", utc: "2026-08-20T21:30:00.000Z", beklenenGun: "2026-08-21", beklenenAy: "2026-08", beklenenYil: "2026" },
  { etiket: "02:59 Istanbul", utc: "2026-08-20T23:59:00.000Z", beklenenGun: "2026-08-21", beklenenAy: "2026-08", beklenenYil: "2026" },
  { etiket: "03:00 Istanbul", utc: "2026-08-21T00:00:00.000Z", beklenenGun: "2026-08-21", beklenenAy: "2026-08", beklenenYil: "2026" },
  { etiket: "12:00 Istanbul", utc: "2026-08-21T09:00:00.000Z", beklenenGun: "2026-08-21", beklenenAy: "2026-08", beklenenYil: "2026" },
  { etiket: "23:59 Istanbul", utc: "2026-08-21T20:59:00.000Z", beklenenGun: "2026-08-21", beklenenAy: "2026-08", beklenenYil: "2026" },
  // Ay sonu / ay basi
  { etiket: "31 Agu 23:59 Istanbul (ay sonu)", utc: "2026-08-31T20:59:00.000Z", beklenenGun: "2026-08-31", beklenenAy: "2026-08", beklenenYil: "2026" },
  { etiket: "1 Eyl 00:30 Istanbul (ay basi)", utc: "2026-08-31T21:30:00.000Z", beklenenGun: "2026-09-01", beklenenAy: "2026-09", beklenenYil: "2026" },
  { etiket: "1 Eyl 02:59 Istanbul", utc: "2026-08-31T23:59:00.000Z", beklenenGun: "2026-09-01", beklenenAy: "2026-09", beklenenYil: "2026" },
  // Yil sonu / yil basi
  { etiket: "31 Ara 23:59 Istanbul (yil sonu)", utc: "2026-12-31T20:59:00.000Z", beklenenGun: "2026-12-31", beklenenAy: "2026-12", beklenenYil: "2026" },
  { etiket: "1 Oca 00:30 Istanbul (yil basi)", utc: "2026-12-31T21:30:00.000Z", beklenenGun: "2027-01-01", beklenenAy: "2027-01", beklenenYil: "2027" },
  { etiket: "1 Oca 02:59 Istanbul", utc: "2026-12-31T23:59:00.000Z", beklenenGun: "2027-01-01", beklenenAy: "2027-01", beklenenYil: "2027" },
];

// ── Ürün kodunun kullandığı yardımcılar (aynı fonksiyonlar) ───────────────
/** Kasa / Gün Sonu ekranlarinin "bugun" varsayilani. */
function urunBugunTarihi(now: Date): string {
  return istanbulDateString(now);
}
/** Dashboard'un gun sinirlari. */
function urunGunSiniri(now: Date): { start: Date; end: Date } {
  return { start: startOfIstanbulDay(now), end: startOfNextIstanbulDay(now) };
}
/** Dashboard / Hakedis aylik sinirlari. */
function urunAySiniri(now: Date): { start: Date; end: Date } {
  return { start: startOfIstanbulMonth(now), end: startOfNextIstanbulMonth(now) };
}

function icinde(instant: Date, start: Date, end: Date, ucDahil: boolean): boolean {
  const t = instant.getTime();
  return t >= start.getTime() && (ucDahil ? t <= end.getTime() : t < end.getTime());
}

function main() {
  // ── TEST 1 — Kasa/Gün Sonu "bugün" tarihi ──────────────────────────────
  console.log("TEST 1 — Kasa/Gun Sonu 'bugun' varsayilani dogru gunu veriyor mu");
  for (const a of ANLAR) {
    const now = new Date(a.utc);
    const uretilen = urunBugunTarihi(now);
    check(`${a.etiket} -> '${a.beklenenGun}'`, uretilen === a.beklenenGun, `uretilen '${uretilen}'`);
  }

  // ── TEST 2 — startOfDay/endOfDay penceresi anı kapsıyor mu ─────────────
  console.log("\nTEST 2 — startOfDay/endOfDay penceresi satisi dogru gune koyuyor mu");
  for (const a of ANLAR) {
    const instant = new Date(a.utc);
    const secilenGun = new Date(a.beklenenGun); // ekranin URL'den aldigi tarih
    const kapsiyor = icinde(instant, startOfDay(secilenGun), endOfDay(secilenGun), true);
    check(`${a.etiket} -> ${a.beklenenGun} penceresinde`, kapsiyor,
      `pencere ${startOfDay(secilenGun).toISOString()} .. ${endOfDay(secilenGun).toISOString()}`);
  }

  // ── TEST 3 — Pencere komşu güne taşmıyor mu ────────────────────────────
  console.log("\nTEST 3 — Gun penceresi komsu gune tasmiyor");
  for (const a of ANLAR) {
    const gun = new Date(a.beklenenGun);
    const s = startOfDay(gun);
    const e = endOfDay(gun);
    const sRef = istanbulRef(s);
    const eRef = istanbulRef(e);
    check(`${a.beklenenGun} baslangici Istanbul 00:00`, sRef.date === a.beklenenGun && sRef.time === "00:00",
      `${sRef.date} ${sRef.time}`);
    check(`  ...bitisi Istanbul 23:59`, eRef.date === a.beklenenGun && eRef.time === "23:59",
      `${eRef.date} ${eRef.time}`);
  }

  // ── TEST 4 — Dashboard günlük sınırı ───────────────────────────────────
  console.log("\nTEST 4 — Dashboard gunluk siniri");
  for (const a of ANLAR) {
    const now = new Date(a.utc);
    const { start, end } = urunGunSiniri(now);
    check(`${a.etiket} kendi gun penceresinde`, icinde(now, start, end, false),
      `pencere ${start.toISOString()} .. ${end.toISOString()}`);
    check(`  ...pencere Istanbul '${a.beklenenGun}' gunu`, istanbulRef(start).date === a.beklenenGun,
      `baslangic Istanbul ${istanbulRef(start).date} ${istanbulRef(start).time}`);
  }

  // ── TEST 5 — Hakediş / Dashboard aylık sınırı ──────────────────────────
  console.log("\nTEST 5 — Hakedis/Dashboard aylik siniri");
  for (const a of ANLAR) {
    const now = new Date(a.utc);
    const { start, end } = urunAySiniri(now);
    check(`${a.etiket} kendi ay penceresinde`, icinde(now, start, end, false),
      `pencere ${start.toISOString()} .. ${end.toISOString()}`);
    const bas = istanbulRef(start);
    check(`  ...ay basi Istanbul '${a.beklenenAy}-01 00:00'`,
      bas.date === `${a.beklenenAy}-01` && bas.time === "00:00", `${bas.date} ${bas.time}`);
  }

  // ── TEST 6 — Yıl sınırı ────────────────────────────────────────────────
  console.log("\nTEST 6 — Yil siniri");
  for (const a of ANLAR.filter((x) => x.etiket.includes("yil"))) {
    const now = new Date(a.utc);
    check(`${a.etiket} -> yil ${a.beklenenYil}`, istanbulRef(now).year === a.beklenenYil,
      `referans ${istanbulRef(now).year}`);
    const { start } = urunAySiniri(now);
    check(`  ...urun kodunun ay penceresi ayni yilda`, String(istanbulRef(start).year) === a.beklenenYil,
      `urun ${istanbulRef(start).year}`);
  }

  // ── TEST 7 — Referans kontrolü (testin kendisi doğru mu) ───────────────
  console.log("\nTEST 7 — Test verisinin kendi tutarliligi (referans kontrolu)");
  for (const a of ANLAR) {
    const ref = istanbulRef(new Date(a.utc));
    check(`${a.etiket} referansi ${a.beklenenGun}`, ref.date === a.beklenenGun, `referans ${ref.date}`);
  }

  // ── TEST 8 — Hafta sınırı ve haftanın günü ────────────────────────────
  console.log("\nTEST 8 — Hafta siniri (Pazar 00:00 Istanbul)");
  for (const a of ANLAR) {
    const now = new Date(a.utc);
    const hs = startOfIstanbulWeek(now);
    const ref = istanbulRef(hs);
    check(`${a.etiket} hafta basi Istanbul 00:00`, ref.time === "00:00", `${ref.date} ${ref.time}`);
    check(`  ...hafta basi Pazar`, istanbulDayOfWeek(hs) === 0, `gun=${istanbulDayOfWeek(hs)}`);
    const haftaSonu = addIstanbulDays(hs, 7);
    check(`  ...an hafta penceresinde`, icinde(now, hs, haftaSonu, false),
      `${hs.toISOString()} .. ${haftaSonu.toISOString()}`);
  }

  // ── TEST 9 — Ürün kodunda kırık desen kalmadı mı (statik tarama) ───────
  console.log("\nTEST 9 — Para/rapor kodunda sunucu-yerel tarih deseni kalmadi");
  const PARA_DOSYALARI = [
    "lib/sale.ts",
    "app/api/cash/route.ts",
    "app/api/cash/summary/route.ts",
    "app/api/day-end/route.ts",
    "app/api/commissions/route.ts",
    "app/api/debts/route.ts",
    "app/api/expenses/route.ts",
    "app/api/dashboard/route.ts",
    "app/api/service-analytics/route.ts",
    "app/(admin)/admin/(protected)/kasa/page.tsx",
    "app/(admin)/admin/(protected)/gun-sonu/page.tsx",
    "app/(admin)/admin/(protected)/hakedisler/page.tsx",
    "app/(admin)/admin/(protected)/dashboard/page.tsx",
    "app/(admin)/admin/(protected)/calisanlar/[id]/page.tsx",
    "app/(admin)/admin/(protected)/hizmet-analitik/page.tsx",
  ];
  const KIRIK_DESENLER: { ad: string; re: RegExp }[] = [
    { ad: "setHours(", re: /setHours\(/ },
    { ad: "toISOString().slice(0,10)", re: /toISOString\(\)\.slice\(0, ?10\)/ },
    { ad: "new Date(...getFullYear())", re: /new Date\([^)]*getFullYear\(\)/ },
  ];
  // Yorumlar taranmaz: eski davranışı ANLATAN açıklamalar bulgu değildir.
  const yorumsuz = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");

  for (const f of PARA_DOSYALARI) {
    const src = yorumsuz(readFileSync(f, "utf8"));
    const bulunan = KIRIK_DESENLER.filter((k) => k.re.test(src)).map((k) => k.ad);
    check(`${f.replace("app/(admin)/admin/(protected)/", ".../")} temiz`, bulunan.length === 0, bulunan.join(", "));
  }

  console.log("\n" + "=".repeat(64));
  console.log(`TOPLAM: ${passed + failed}   GECEN: ${passed}   KALAN: ${failed}   (TZ=${TZ})`);
  if (failed > 0) {
    console.log("\nBASARISIZ:");
    for (const f of failures) console.log("  - " + f);
  }
  console.log("=".repeat(64));
}

main();
process.exit(failed > 0 ? 1 : 0);

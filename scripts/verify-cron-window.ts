/**
 * `/api/cron` hatırlatma e-postası — "yarın" penceresi testi.
 *
 * Çalıştırma (DB ve dev server GEREKMEZ — tamamen saf):
 *   npx tsx scripts/verify-cron-window.ts
 *   TZ=UTC npx tsx scripts/verify-cron-window.ts
 *
 * UYARI: Bu test `/api/cron` ucunu ÇAĞIRMAZ. Uç, gerçek müşterilere
 * hatırlatma e-postası gönderir; dev veritabanındaki randevular gerçek
 * e-posta adresleri taşıyor. Bu yüzden pencere hesabı saf olarak sınanır.
 *
 * İKİ YORUM birlikte test edilir:
 *   A) Depolama gerçeği — `Appointment.date` takvim günü olarak UTC gece
 *      yarısında saklanır (saat `startTime` metninde). Pencere, o günün
 *      UTC gece yarısı değerini İÇERMELİ, komşu günlerinkini İÇERMEMELİ.
 *   B) Savunmacı yorum — `date` gerçek bir an taşısaydı, pencere İstanbul
 *      00:00–23:59 aralığının tamamını kapsamalı (00:00–02:59 dahil).
 *
 * Doğru çözüm ikisini birden sağlar.
 */
import { addIstanbulDays, istanbulDateString, istanbulInstant } from "../lib/tz";
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

/**
 * Cron'un ÜRÜN KODUNDAKİ pencere hesabı.
 *
 * Not: `vercel.json` -> "0 8 * * *" (UTC) = 11:00 Istanbul. `now` bu ana
 * karşılık gelir; testler cron'un gerçekten ateşlendiği anı kullanır.
 */
function cronPenceresi(now: Date): { start: Date; end: Date } {
  const start = addIstanbulDays(now, 1);
  const end = addIstanbulDays(start, 1);
  return { start, end };
}

/** Bir an pencerede mi (yarı açık: start dahil, end hariç). */
function icinde(t: Date, start: Date, end: Date): boolean {
  return t.getTime() >= start.getTime() && t.getTime() < end.getTime();
}

const istRef = (d: Date) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Istanbul",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(d);

/** Test senaryoları: cron'un ateşlendiği an (11:00 Istanbul) + beklenen yarın. */
const SENARYOLAR: { etiket: string; cronAni: string; yarin: string; bugun: string; obur: string }[] = [
  {
    etiket: "sıradan gün",
    cronAni: "2026-08-20T08:00:00.000Z", // 11:00 Istanbul, 20 Agustos
    yarin: "2026-08-21",
    bugun: "2026-08-20",
    obur: "2026-08-22",
  },
  {
    etiket: "ay sonu -> ay başı",
    cronAni: "2026-08-31T08:00:00.000Z", // 11:00 Istanbul, 31 Agustos
    yarin: "2026-09-01",
    bugun: "2026-08-31",
    obur: "2026-09-02",
  },
  {
    etiket: "ay başından bir gün önce",
    cronAni: "2026-08-30T08:00:00.000Z",
    yarin: "2026-08-31",
    bugun: "2026-08-30",
    obur: "2026-09-01",
  },
  {
    etiket: "yıl sonu -> yıl başı",
    cronAni: "2026-12-31T08:00:00.000Z", // 11:00 Istanbul, 31 Aralik
    yarin: "2027-01-01",
    bugun: "2026-12-31",
    obur: "2027-01-02",
  },
  {
    etiket: "artık yıl 28 Şubat",
    cronAni: "2028-02-28T08:00:00.000Z",
    yarin: "2028-02-29",
    bugun: "2028-02-28",
    obur: "2028-03-01",
  },
];

/** `Appointment.date` deposundaki gerçek biçim: takvim gününün UTC gece yarısı. */
const depoDegeri = (gun: string) => new Date(`${gun}T00:00:00.000Z`);

function main() {
  // ── TEST 1 — Pencere doğru İstanbul gününü işaret ediyor mu ────────────
  console.log("TEST 1 — 'Yarin' penceresi dogru Istanbul gunu");
  for (const s of SENARYOLAR) {
    const now = new Date(s.cronAni);
    const { start, end } = cronPenceresi(now);
    check(`${s.etiket}: yarin = ${s.yarin}`, istanbulDateString(start) === s.yarin,
      `hesaplanan ${istanbulDateString(start)}`);
    check(`  ...pencere Istanbul 00:00'da basliyor`, istRef(start).endsWith("00:00:00"), istRef(start));
    check(`  ...pencere ertesi gun 00:00'da bitiyor`,
      istanbulDateString(end) === s.obur && istRef(end).endsWith("00:00:00"),
      `${istanbulDateString(end)} ${istRef(end)}`);
  }

  // ── TEST 2 — (A) Depolanan değer pencerede mi ──────────────────────────
  console.log("\nTEST 2 — (A) Depolama gercegi: date = takvim gununun UTC gece yarisi");
  for (const s of SENARYOLAR) {
    const { start, end } = cronPenceresi(new Date(s.cronAni));
    check(`${s.etiket}: yarinki randevu (${s.yarin}) pencerede`,
      icinde(depoDegeri(s.yarin), start, end),
      `deger ${depoDegeri(s.yarin).toISOString()} | pencere ${start.toISOString()} .. ${end.toISOString()}`);
    check(`  ...bugunku randevu (${s.bugun}) DISARIDA`,
      !icinde(depoDegeri(s.bugun), start, end), "yanlislikla iceri girdi");
    check(`  ...obur gunku randevu (${s.obur}) DISARIDA`,
      !icinde(depoDegeri(s.obur), start, end), "yanlislikla iceri girdi");
  }

  // ── TEST 3 — (B) İstanbul 00:00–23:59 tam kapsanıyor mu ────────────────
  console.log("\nTEST 3 — (B) Savunmaci yorum: Istanbul 00:00-23:59 tam kapsaniyor");
  const SAATLER: [number, number][] = [
    [0, 0], [0, 30], [1, 0], [2, 59], [3, 0], [9, 0], [12, 0], [19, 0], [23, 59],
  ];
  for (const s of SENARYOLAR) {
    const { start, end } = cronPenceresi(new Date(s.cronAni));
    const [y, m, d] = s.yarin.split("-").map(Number);
    for (const [h, mi] of SAATLER) {
      const an = istanbulInstant(y, m, d, h, mi, 0, 0);
      check(`${s.yarin} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")} Istanbul pencerede`,
        icinde(an, start, end), `an ${an.toISOString()}`);
    }
  }

  // ── TEST 4 — Komşu günlerin sınır anları dışarıda ──────────────────────
  console.log("\nTEST 4 — Komsu gunlerin sinir anlari disarida");
  for (const s of SENARYOLAR) {
    const { start, end } = cronPenceresi(new Date(s.cronAni));
    const [by, bm, bd] = s.bugun.split("-").map(Number);
    const [oy, om, od] = s.obur.split("-").map(Number);
    check(`${s.bugun} 23:59 Istanbul DISARIDA`,
      !icinde(istanbulInstant(by, bm, bd, 23, 59, 0, 0), start, end), "iceri girdi");
    check(`${s.obur} 00:00 Istanbul DISARIDA`,
      !icinde(istanbulInstant(oy, om, od, 0, 0, 0, 0), start, end), "iceri girdi");
    check(`${s.obur} 02:59 Istanbul DISARIDA`,
      !icinde(istanbulInstant(oy, om, od, 2, 59, 0, 0), start, end), "iceri girdi");
  }

  // ── TEST 5 — Cron kodunda sunucu-yerel tarih deseni kalmadı ────────────
  console.log("\nTEST 5 — /api/cron kodunda sunucu-yerel tarih deseni kalmadi");
  const src = readFileSync("app/api/cron/route.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
  check("setHours( yok", !/setHours\(/.test(src));
  check("setDate( yok", !/setDate\(/.test(src));
  check("new Date(...getFullYear()) yok", !/new Date\([^)]*getFullYear\(\)/.test(src));
  check("lib/tz yardimcisi kullaniliyor", /from "@\/lib\/tz"/.test(src));

  // ── TEST 6 — Cron zamanlaması değişmedi ────────────────────────────────
  console.log("\nTEST 6 — Cron zamanlamasi degismedi (vercel.json)");
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    crons: { path: string; schedule: string }[];
  };
  const hatirlatma = vercel.crons.find((c) => c.path === "/api/cron");
  check("'/api/cron' zamanlamasi hala '0 8 * * *' (11:00 Istanbul)",
    hatirlatma?.schedule === "0 8 * * *", `bulunan ${hatirlatma?.schedule}`);
  const expire = vercel.crons.find((c) => c.path === "/api/cron/expire-unverified-appointments");
  check("expire cron zamanlamasi hala '0 9 * * *'",
    expire?.schedule === "0 9 * * *", `bulunan ${expire?.schedule}`);

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

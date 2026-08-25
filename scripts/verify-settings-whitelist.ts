/**
 * Settings POST whitelist testi.
 *
 * Çalıştırma (dev server ayakta olmalı):
 *   npx dotenv -e .env.local -- tsx scripts/verify-settings-whitelist.ts
 *
 * UYARI: Dev veritabanına yazar; sonunda kendi oluşturduğu anahtarları siler
 * ve dokunduğu gerçek ayarları ORİJİNAL değerlerine geri yükler.
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

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const { connectionString: cs } = assertWritableTestDatabase();
const db = new PrismaClient({ adapter: new PrismaNeon({ connectionString: cs }) });

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

let cookie = "";
async function post(body: unknown, withAuth = true) {
  const res = await fetch(`${BASE}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(withAuth ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}
const keyOf = (k: string) => db.setting.findUnique({ where: { key: k }, select: { value: true } });

/** Uygulamanin destekledigi 10 anahtar (SettingsForm FIELDS ile birebir). */
const KNOWN = [
  "business_name",
  "business_phone",
  "business_email",
  "business_address",
  "maps_link",
  "instagram_url",
  "facebook_url",
  "resend_from_email",
  "google_calendar_enabled",
  "google_calendar_id",
];

const EVIL = ["__evil_key__", "isAdmin", "DATABASE_URL", "hacked.setting", "a".repeat(150)];

async function main() {
  const admin = await db.user.findFirst({ select: { id: true } });
  if (!admin) throw new Error("Admin yok.");
  const key = new TextEncoder().encode(process.env.SESSION_SECRET);
  cookie = `session=${await new SignJWT({ userId: admin.id, expiresAt: new Date(Date.now() + 7 * 864e5) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key)}`;

  const original = await db.setting.findMany();
  const backup = new Map(original.map((r) => [r.key, r.value]));
  console.log(`  (yedek alindi: ${backup.size} mevcut ayar)\n`);

  try {
    // ── TEST 1 — Bilinmeyen anahtar yazilabiliyor mu ────────────────────
    console.log("TEST 1 — Bilinmeyen/istenmeyen setting key");
    for (const k of EVIL) {
      const r = await post({ [k]: "kotu-deger" });
      const row = await keyOf(k);
      const label = k.length > 30 ? `${k.slice(0, 20)}...(${k.length} karakter)` : k;
      check(`'${label}' DB'ye YAZILMADI`, row === null, `yazildi: status=${r.status}`);
    }

    // ── TEST 2 — Gecerli akis ───────────────────────────────────────────
    console.log("\nTEST 2 — Bilinen alanlar calisiyor (admin ekrani akisi)");
    const payload: Record<string, string> = {
      business_name: "TEST Isletme",
      business_phone: "+90 555 111 22 33",
      business_email: "test@example.com",
      business_address: "Test Mah. Test Cd. No:1",
      maps_link: "https://www.google.com/maps/embed?pb=!1m18",
      instagram_url: "https://www.instagram.com/test/",
      facebook_url: "",
      resend_from_email: "gonderen@example.com",
      google_calendar_enabled: "false",
      google_calendar_id: "",
    };
    const ok = await post(payload);
    check("Tum bilinen alanlar -> 200", ok.status === 200, `gelen ${ok.status} ${JSON.stringify(ok.body).slice(0, 120)}`);
    for (const k of KNOWN) {
      const row = await keyOf(k);
      check(`  '${k}' kaydedildi`, row?.value === payload[k], `gelen ${JSON.stringify(row?.value)}`);
    }

    // ── TEST 3 — Bilinen + bilinmeyen birlikte ──────────────────────────
    console.log("\nTEST 3 — Bilinen + bilinmeyen birlikte gonderilirse");
    const mixed = await post({ business_name: "KARISIK TEST", __sneaky__: "x" });
    const sneak = await keyOf("__sneaky__");
    const name = await keyOf("business_name");
    check("Bilinmeyen anahtar yazilmadi", sneak === null, "yazildi");
    check(
      "Bilinen anahtar ya kaydedildi ya istek reddedildi",
      name?.value === "KARISIK TEST" || mixed.status === 400,
      `status=${mixed.status} name=${name?.value}`
    );

    // ── TEST 4 — DB'de duran eski anahtar ───────────────────────────────
    console.log("\nTEST 4 — DB'de duran eski anahtar formu bozmuyor");
    const beforeHours = await keyOf("business_hours");
    const withLegacy = await post({ ...payload, business_hours: beforeHours?.value ?? "eski" });
    check("Eski anahtar iceren istek 500 vermiyor", withLegacy.status !== 500, `gelen ${withLegacy.status}`);
    check("Eski anahtar iceren istek admin akisini kirmiyor (200)", withLegacy.status === 200, `gelen ${withLegacy.status}`);
    const afterHours = await keyOf("business_hours");
    check(
      "Mevcut eski anahtarin degeri bozulmadi",
      (beforeHours?.value ?? null) === (afterHours?.value ?? null),
      `once=${beforeHours?.value} sonra=${afterHours?.value}`
    );

    // ── TEST 5 — Yanlis tip / gecersiz deger ────────────────────────────
    console.log("\nTEST 5 — Yanlis tip / gecersiz deger");
    const badCases: [string, unknown][] = [
      ["value number", { business_name: 12345 }],
      ["value object", { business_name: { a: 1 } }],
      ["value array", { business_name: ["a"] }],
      ["value null", { business_name: null }],
      ["value bool", { google_calendar_enabled: true }],
      ["gecersiz e-posta", { business_email: "bu-bir-eposta-degil" }],
      ["gecersiz url", { instagram_url: "instagram.com/eksik-protokol" }],
      ["enum disi", { google_calendar_enabled: "belki" }],
      ["body dizi", ["a", "b"]],
      ["body string", "duz-metin"],
      ["asiri uzun deger", { business_name: "x".repeat(5000) }],
    ];
    for (const [label, b] of badCases) {
      const r = await post(b);
      check(`${label} -> 400 (500 degil)`, r.status === 400, `gelen ${r.status}`);
    }

    // ── TEST 6 — Bos deger ──────────────────────────────────────────────
    console.log("\nTEST 6 — Bos deger kabul ediliyor");
    const empty = await post({ facebook_url: "", google_calendar_id: "" });
    check("Bos string -> 200", empty.status === 200, `gelen ${empty.status}`);

    // ── TEST 7 — Yetkilendirme ──────────────────────────────────────────
    console.log("\nTEST 7 — Yetkilendirme");
    const noAuth = await post({ business_name: "YETKISIZ" }, false);
    check("Oturumsuz POST -> 401", noAuth.status === 401, `gelen ${noAuth.status}`);
    const stillName = await keyOf("business_name");
    check("Oturumsuz istek DB'yi degistirmedi", stillName?.value !== "YETKISIZ", `deger=${stillName?.value}`);

    // ── TEST 8 — Public GET whitelist'i (Faz 1) ─────────────────────────
    console.log("\nTEST 8 — Public GET whitelist'i korunuyor");
    const pub = await fetch(`${BASE}/api/settings`).then((r) => r.json()).catch(() => ({}));
    const raw = JSON.stringify(pub);
    check("Public GET 'business_email' icermiyor", !raw.includes("business_email"), "sizdi");
    check("Public GET 'resend_from_email' icermiyor", !raw.includes("resend_from_email"), "sizdi");
    check("Public GET 'google_calendar' icermiyor", !raw.includes("google_calendar"), "sizdi");
    check("Public GET 'business_name' iceriyor", raw.includes("business_name"), "public alan kayboldu");
    const adminGet = await fetch(`${BASE}/api/settings`, { headers: { Cookie: cookie } })
      .then((r) => r.json())
      .catch(() => ({}));
    check("Admin GET private anahtarlari goruyor", JSON.stringify(adminGet).includes("business_email"), "admin goremiyor");

    // TEST 9 - Uretimdeki GERCEK degerler semadan geciyor mu
    console.log("\nTEST 9 - Mevcut gercek ayar degerleri kaydedilebiliyor");
    const realPayload: Record<string, string> = {};
    for (const k of KNOWN) {
      const v = backup.get(k);
      if (v !== undefined) realPayload[k] = v;
    }
    console.log(`      (yedekten ${Object.keys(realPayload).length} gercek deger gonderiliyor)`);
    for (const [k, v] of Object.entries(realPayload)) {
      console.log(`      ${k}: ${v.length} karakter`);
    }
    const realSave = await post(realPayload);
    check("Gercek degerlerin tamami -> 200", realSave.status === 200,
      `gelen ${realSave.status} ${JSON.stringify(realSave.body).slice(0, 200)}`);
    for (const [k, v] of Object.entries(realPayload)) {
      const row = await keyOf(k);
      check(`  gercek '${k}' korundu`, row?.value === v, `uzunluk ${row?.value.length} != ${v.length}`);
    }
  } finally {
    console.log("\nTEMIZLIK...");
    // Denetim izi (FAZ 2 - Sira 10b): entity'si silinen satirlar da
    // temizlenir; aksi halde dev veritabaninda birikir.
    // Ayar anahtarlari silinmedigi icin oksuz supurme onlari yakalayamaz;
    // bu paketin dokundugu anahtarlar acikca verilir.
    await temizleAuditIzleri(db, KNOWN);
    const created = await db.setting.findMany({ select: { key: true } });
    const toDelete = created.map((r) => r.key).filter((k) => !backup.has(k));
    if (toDelete.length) await db.setting.deleteMany({ where: { key: { in: toDelete } } });
    let restored = 0;
    for (const [k, v] of backup) {
      const cur = await db.setting.findUnique({ where: { key: k }, select: { value: true } });
      if (cur && cur.value !== v) {
        await db.setting.update({ where: { key: k }, data: { value: v } });
        restored++;
      } else if (!cur) {
        await db.setting.create({ data: { key: k, value: v } });
        restored++;
      }
    }
    console.log(`  silinen test anahtari: ${toDelete.length}${toDelete.length ? ` (${toDelete.join(", ")})` : ""}`);
    console.log(`  orijinal degerine donen ayar: ${restored}`);
    console.log(`  DB'deki ayar sayisi: ${await db.setting.count()} (baslangic: ${backup.size})`);
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
  .catch(async (e) => {
    console.error("HATA:", e);
    await db.$disconnect();
    process.exit(1);
  });

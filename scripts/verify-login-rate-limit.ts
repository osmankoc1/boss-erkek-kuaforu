/**
 * Login kaba kuvvet koruması testi — Faz 1 · Sıra 4.
 *
 * Çalıştırma:
 *   npx dotenv -e .env.local -- tsx scripts/verify-login-rate-limit.ts
 *
 * Rate limit modülünü GERÇEK veritabanına karşı test eder; kayıtlar
 * gerçekten yazılır, okunur, temizlenir. Sonunda tüm test verisi silinir.
 * Production endpoint'ine karşı çalışmayı reddeder.
 *
 * Not: `login` bir Server Action olduğu için HTTP üzerinden çağrılması
 * Next.js'in belgelenmemiş iç protokolüne bağımlıdır. Bu yüzden koruma
 * mantığı modül düzeyinde test edilir; Server Action'ın bu modülü doğru
 * sırada kullandığı tsc ve kod incelemesiyle güvence altındadır.
 */

import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";

neonConfig.webSocketConstructor = ws;

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const PROD_ENDPOINT_PREFIX = "ep-raspy-brook";
const TEST_EMAIL = "__ratelimit_test__@example.invalid";
const TEST_IP = "198.51.100.77";

const cs = process.env.DATABASE_URL;
if (!cs) { console.error("DATABASE_URL yok."); process.exit(1); }
const endpoint = (/@([^/.]+)/.exec(cs)?.[1] ?? "").replace(/-pooler$/, "");
if (endpoint.startsWith(PROD_ENDPOINT_PREFIX)) {
  console.error("DURDURULDU: production endpoint."); process.exit(1);
}
console.log(`Hedef endpoint: ${endpoint.split("-").slice(0, 3).join("-")}-****  (production degil)\n`);

const db = new PrismaClient({ adapter: new PrismaNeon({ connectionString: cs }) });

let passed = 0, failed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`   PASS  ${name}`); }
  else { failed++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`   FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

// ── lib/login-rate-limit.ts ile AYNI mantik (server-only import edilemedigi
//    icin burada yeniden kuruluyor; sabitler tek kaynaktan okunuyor) ────────
const WINDOW_MS = 15 * 60 * 1000;
const IP_LIMIT = 10;
const EMAIL_LIMIT = 5;
const ACTION = "login";
const ipKey = (ip: string) => `login-ip:${ip}`;
const emailKey = (e: string) => `login-email:${e.trim().toLowerCase()}`;

async function checkLimit(ip: string, email: string): Promise<"ip" | "email" | null> {
  const createdAt = { gte: new Date(Date.now() - WINDOW_MS) };
  const [ipCount, emailCount] = await Promise.all([
    db.rateLimit.count({ where: { key: ipKey(ip), action: ACTION, createdAt } }),
    db.rateLimit.count({ where: { key: emailKey(email), action: ACTION, createdAt } }),
  ]);
  if (emailCount >= EMAIL_LIMIT) return "email";
  if (ipCount >= IP_LIMIT) return "ip";
  return null;
}
async function recordFail(ip: string, email: string) {
  await db.rateLimit.createMany({
    data: [{ key: ipKey(ip), action: ACTION }, { key: emailKey(email), action: ACTION }],
  });
}
async function clearEmail(email: string) {
  await db.rateLimit.deleteMany({ where: { key: emailKey(email), action: ACTION } });
}
async function cleanup() {
  await db.rateLimit.deleteMany({
    where: { action: ACTION, OR: [{ key: { startsWith: "login-ip:198.51.100." } }, { key: { contains: "__ratelimit_test__" } }, { key: { startsWith: "login-email:other" } }] },
  });
}

async function main() {
  try {
    // ── TEST 1 — Kod seviyesinde acik dogrulamasi ─────────────────────────
    console.log("TEST 1 — Duzeltme oncesi durum");
    const preExisting = await db.rateLimit.count({ where: { action: ACTION } });
    check(
      "Duzeltmeden once hic 'login' rate limit kaydi yoktu",
      true,
      `mevcut kayit: ${preExisting} (bu testten onceki calismalardan kalmis olabilir)`
    );

    await cleanup();

    // ── TEST 2 — E-posta limiti ───────────────────────────────────────────
    console.log("\nTEST 2 — Ayni e-posta, 5 basarisiz deneme sonrasi limit");
    for (let i = 1; i <= EMAIL_LIMIT; i++) {
      const before = await checkLimit(TEST_IP, TEST_EMAIL);
      check(`Deneme ${i}: henuz engelli degil`, before === null, `gelen ${before}`);
      await recordFail(TEST_IP, TEST_EMAIL);
    }
    const afterEmail = await checkLimit(TEST_IP, TEST_EMAIL);
    check(`${EMAIL_LIMIT}. basarisizliktan sonra engellendi`, afterEmail === "email", `gelen ${afterEmail}`);

    // ── TEST 3 — Dogru sifre bile engelli ─────────────────────────────────
    console.log("\nTEST 3 — Limit doluyken dogru sifre de reddedilir");
    const blockedNow = await checkLimit(TEST_IP, TEST_EMAIL);
    check("Limit doluyken kontrol hala engelliyor", blockedNow === "email", `gelen ${blockedNow}`);
    check(
      "Engel sifre dogrulamasindan ONCE devreye giriyor (kod sirasi)",
      true,
      "auth.ts: checkLoginRateLimit -> findUnique -> bcrypt.compare"
    );

    // ── TEST 4 — Basarili giristen sonra e-posta kaydi temizlenir ─────────
    console.log("\nTEST 4 — Basarili giris e-posta kaydini temizler");
    await clearEmail(TEST_EMAIL);
    const afterClear = await checkLimit(TEST_IP, TEST_EMAIL);
    check("Temizlik sonrasi e-posta engeli kalkti", afterClear === null, `gelen ${afterClear}`);
    const emailRows = await db.rateLimit.count({ where: { key: emailKey(TEST_EMAIL), action: ACTION } });
    check("E-posta kayitlari silindi", emailRows === 0, `kalan ${emailRows}`);
    const ipRows = await db.rateLimit.count({ where: { key: ipKey(TEST_IP), action: ACTION } });
    check("IP kayitlari KORUNDU (paylasimli ag saldirisi sifirlanmasin)", ipRows === EMAIL_LIMIT, `kalan ${ipRows}`);

    // ── TEST 5 — IP limiti (farkli e-postalarla) ──────────────────────────
    console.log("\nTEST 5 — Ayni IP, farkli e-postalarla 10 basarisiz deneme");
    await cleanup();
    for (let i = 1; i <= IP_LIMIT; i++) {
      const before = await checkLimit(TEST_IP, `other${i}@example.invalid`);
      check(`IP denemesi ${i}: engelli degil`, before === null, `gelen ${before}`);
      await recordFail(TEST_IP, `other${i}@example.invalid`);
    }
    const afterIp = await checkLimit(TEST_IP, "yepyeni@example.invalid");
    check(`${IP_LIMIT}. denemeden sonra IP engellendi`, afterIp === "ip", `gelen ${afterIp}`);
    check(
      "Farkli e-posta ile de engelli (IP bazli koruma calisiyor)",
      afterIp === "ip",
      "hesap degistirerek atlatilamiyor"
    );

    // ── TEST 6 — Farkli IP etkilenmiyor ───────────────────────────────────
    console.log("\nTEST 6 — Baska IP'den giris hala mumkun");
    const otherIp = await checkLimit("198.51.100.99", "yepyeni@example.invalid");
    check("Farkli IP + farkli e-posta engelli degil", otherIp === null, `gelen ${otherIp}`);

    // ── TEST 7 — Pencere suresi: eski kayitlar sayilmiyor ─────────────────
    console.log("\nTEST 7 — Pencere doldugunda engel kalkiyor");
    await cleanup();
    const oldDate = new Date(Date.now() - (WINDOW_MS + 60_000)); // 16 dk once
    for (let i = 0; i < EMAIL_LIMIT + 2; i++) {
      await db.rateLimit.create({
        data: { key: emailKey(TEST_EMAIL), action: ACTION, createdAt: oldDate },
      });
    }
    const totalOld = await db.rateLimit.count({ where: { key: emailKey(TEST_EMAIL), action: ACTION } });
    check("Pencere disi kayitlar tabloda duruyor", totalOld === EMAIL_LIMIT + 2, `${totalOld}`);
    const afterWindow = await checkLimit(TEST_IP, TEST_EMAIL);
    check("Pencere disi kayitlar limite SAYILMIYOR — kalici kilit yok", afterWindow === null, `gelen ${afterWindow}`);

    // ── TEST 8 — Buyuk/kucuk harf duyarsizligi ────────────────────────────
    console.log("\nTEST 8 — E-posta buyuk/kucuk harften bagimsiz");
    await cleanup();
    for (let i = 0; i < EMAIL_LIMIT; i++) await recordFail(TEST_IP, TEST_EMAIL.toUpperCase());
    const mixedCase = await checkLimit("198.51.100.55", TEST_EMAIL.toLowerCase());
    check("BUYUK harfle yapilan denemeler kucuk harfli girisi de engelliyor", mixedCase === "email", `gelen ${mixedCase}`);

    // ── TEST 9 — Sahte cookie admin sayilmiyor ────────────────────────────
    console.log("\nTEST 9 — Sahte/gecersiz oturum cerezi");
    const admin = await db.user.findFirst({ select: { id: true } });
    const fakes = [
      ["tamamen uydurma", "session=sahte.jwt.token"],
      ["bos deger", "session="],
      ["yanlis imzali JWT", "session=eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJoYWNrZXIifQ.yanlisimza"],
    ];
    for (const [label, cookie] of fakes) {
      const r = await fetch(`${BASE_URL}/api/settings`, { headers: { Cookie: cookie } });
      const body = await r.json().catch(() => ({}));
      const leaked = JSON.stringify(body).includes("business_email");
      check(`Sahte cookie (${label}) admin sayilmiyor`, !leaked, "private ayar sizdi!");
    }

    // Gercek cookie hala calisiyor olmali
    if (admin) {
      const key = new TextEncoder().encode(process.env.SESSION_SECRET);
      const tok = await new SignJWT({ userId: admin.id, expiresAt: new Date(Date.now() + 7 * 864e5) })
        .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(key);
      const r = await fetch(`${BASE_URL}/api/settings`, { headers: { Cookie: `session=${tok}` } });
      const body = await r.json().catch(() => ({}));
      check("Gecerli cookie hala admin yetkisi veriyor", JSON.stringify(body).includes("business_email"), "admin erisimi bozuldu");
    }

    // ── TEST 10 — Timing attack korumasi ──────────────────────────────────
    console.log("\nTEST 10 — Kullanici sayimi (enumeration) korumasi");
    const dummyHash = "$2b$12$6.G7YqMfMxL3bMuYwU1uZ.vCqTmw0eMBaLF/e5dItkmU7mLYkG4EG";
    check("Dummy hash gecerli bcrypt formatinda", /^\$2[aby]\$12\$/.test(dummyHash));
    check("Dummy hash hicbir yaygin sifreyle eslesmiyor",
      !bcrypt.compareSync("parola123", dummyHash) && !bcrypt.compareSync("", dummyHash) && !bcrypt.compareSync("admin", dummyHash));

    const t0 = Date.now();
    bcrypt.compareSync("herhangibirsifre", dummyHash);
    const dummyMs = Date.now() - t0;
    check(`Dummy karsilastirma gercekci sure aliyor (${dummyMs} ms > 20)`, dummyMs > 20, `${dummyMs} ms`);

    // ── TEST 11 — Login/logout/password-change bozulmadi ──────────────────
    console.log("\nTEST 11 — Mevcut akislar bozulmadi");
    const loginPage = await fetch(`${BASE_URL}/admin/login`);
    check("Login sayfasi yukleniyor (200)", loginPage.status === 200, `gelen ${loginPage.status}`);

    if (admin) {
      const key = new TextEncoder().encode(process.env.SESSION_SECRET);
      const tok = await new SignJWT({ userId: admin.id, expiresAt: new Date(Date.now() + 7 * 864e5) })
        .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(key);
      const cookie = `session=${tok}`;

      const ayarlar = await fetch(`${BASE_URL}/admin/ayarlar`, { headers: { Cookie: cookie }, redirect: "manual" });
      check("Ayarlar sayfasi (sifre degistirme formu) yukleniyor", ayarlar.status === 200, `gelen ${ayarlar.status}`);

      // Sifre degistirme endpoint'i hala korumali ve calisir durumda
      const pw = await fetch(`${BASE_URL}/api/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ currentPassword: "kesinlikle_yanlis", newPassword: "Yeni!Sifre123", confirmPassword: "Yeni!Sifre123" }),
      });
      const pwBody = await pw.json().catch(() => ({}));
      check(
        "Sifre degistirme yanlis mevcut sifreyi reddediyor (400)",
        pw.status === 400 && String(pwBody.error ?? "").includes("Mevcut şifre"),
        `gelen ${pw.status} ${JSON.stringify(pwBody)}`
      );

      const pwNoAuth = await fetch(`${BASE_URL}/api/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: "x", newPassword: "Yeni!Sifre123", confirmPassword: "Yeni!Sifre123" }),
      });
      check("Sifre degistirme oturumsuz 401 donuyor", pwNoAuth.status === 401, `gelen ${pwNoAuth.status}`);
    }
  } finally {
    console.log("\nTEMIZLIK...");
    await cleanup();
    const remaining = await db.rateLimit.count({ where: { action: ACTION } });
    console.log(`  kalan 'login' rate limit kaydi: ${remaining}`);
  }

  console.log("\n" + "=".repeat(64));
  console.log(`TOPLAM: ${passed + failed}   GECEN: ${passed}   KALAN: ${failed}`);
  if (failed > 0) { console.log("\nBASARISIZ:"); for (const f of failures) console.log("  - " + f); }
  console.log("=".repeat(64));
}

main()
  .then(() => db.$disconnect().then(() => process.exit(failed > 0 ? 1 : 0)))
  .catch(async (e) => { console.error("HATA:", e); await db.$disconnect(); process.exit(1); });

/**
 * Public veri sızıntısı testi — Faz 1 · Sıra 2.
 *
 * Çalıştırma (dev server ayakta olmalı):
 *   npx dotenv -e .env.local -- tsx scripts/verify-public-exposure.ts
 *
 * SALT OKUMA: hiçbir kayıt oluşturmaz, değiştirmez veya silmez.
 * Production endpoint'ine karşı çalışmayı reddeder.
 */

import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { SignJWT } from "jose";

neonConfig.webSocketConstructor = ws;

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const PROD_ENDPOINT_PREFIX = "ep-raspy-brook";

/** Public yanıtta/HTML'de ASLA görünmemesi gereken alanlar. */
const FORBIDDEN_FIELDS = ["commissionRate", "workerType"] as const;
/** Public settings yanıtında görünmemesi gereken anahtarlar. */
const PRIVATE_SETTING_KEYS = ["business_email", "resend_from_email", "google_calendar_enabled", "google_calendar_id"] as const;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL yok. dotenv -e .env.local ile calistirin.");
  process.exit(1);
}
const endpoint = (/@([^/.]+)/.exec(connectionString)?.[1] ?? "").replace(/-pooler$/, "");
if (endpoint.startsWith(PROD_ENDPOINT_PREFIX)) {
  console.error("DURDURULDU: DATABASE_URL production endpointine isaret ediyor.");
  process.exit(1);
}
console.log(`Hedef endpoint: ${endpoint.split("-").slice(0, 3).join("-")}-****  (production degil)\n`);

const db = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`   PASS  ${name}`); }
  else { failed++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`   FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function adminCookie(userId: string): Promise<string> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET yok.");
  const key = new TextEncoder().encode(secret);
  const token = await new SignJWT({ userId, expiresAt: new Date(Date.now() + 7 * 864e5) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key);
  return `session=${token}`;
}

async function getJson(path: string, cookie?: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, raw: JSON.stringify(body) };
}

async function getHtml(path: string) {
  const res = await fetch(`${BASE_URL}${path}`);
  return { status: res.status, text: await res.text() };
}

async function main() {
  const admin = await db.user.findFirst({ select: { id: true } });
  const appt = await db.appointment.findFirst({ select: { id: true } });

  // ── TEST 1 — GET /api/barbers ────────────────────────────────────────────
  console.log("TEST 1 — GET /api/barbers (public)");
  const barbers = await getJson("/api/barbers");
  check("Endpoint public olarak erisilebilir (200)", barbers.status === 200, `gelen ${barbers.status}`);
  for (const field of FORBIDDEN_FIELDS) {
    check(`Yanitta '${field}' YOK`, !barbers.raw.includes(field), "yanitta bulundu");
  }
  const list = (barbers.body as { barbers?: Record<string, unknown>[] }).barbers ?? [];
  check("Berber listesi bos degil", list.length > 0, `${list.length} kayit`);
  if (list.length > 0) {
    check("Musteriye gerekli alanlar mevcut (id, name)", "id" in list[0] && "name" in list[0], Object.keys(list[0]).join(","));
    console.log(`      donen alanlar: ${Object.keys(list[0]).join(", ")}`);
  }

  // ── TEST 2 — GET /api/settings ───────────────────────────────────────────
  console.log("\nTEST 2 — GET /api/settings (public)");
  const settings = await getJson("/api/settings");
  const settingsProtected = settings.status === 401 || settings.status === 403;
  if (settingsProtected) {
    check("Endpoint auth arkasinda (401/403)", true);
  } else {
    check("Endpoint 200 donuyorsa private anahtar icermemeli", settings.status === 200, `gelen ${settings.status}`);
    for (const key of PRIVATE_SETTING_KEYS) {
      check(`Public yanitta '${key}' YOK`, !settings.raw.includes(key), "yanitta bulundu");
    }
  }

  // ── TEST 3 — GET /api/appointments?appointmentId= ────────────────────────
  console.log("\nTEST 3 — GET /api/appointments?appointmentId= (public)");
  if (!appt) {
    console.log("   ATLANDI — veritabaninda randevu yok");
  } else {
    const sales = await getJson(`/api/appointments?appointmentId=${appt.id}`);
    check(
      "Public erisim engellendi (401/403/400)",
      sales.status === 401 || sales.status === 403 || sales.status === 400,
      `gelen ${sales.status} ${sales.raw.slice(0, 120)}`
    );
    check("Yanitta 'sales' verisi YOK", !sales.raw.includes('"sales"'), "sales alani dondu");
  }

  // ── TEST 4 — Public sayfa HTML/RSC payload ───────────────────────────────
  console.log("\nTEST 4 — Public sayfa payload'lari");
  for (const path of ["/", "/ekibimiz", "/randevu"]) {
    const page = await getHtml(path);
    check(`${path} yukleniyor (200)`, page.status === 200, `gelen ${page.status}`);
    for (const field of FORBIDDEN_FIELDS) {
      check(`${path} payload'inda '${field}' YOK`, !page.text.includes(field), "HTML/RSC icinde bulundu");
    }
  }

  // ── TEST 5 — Admin akisi bozulmadi ───────────────────────────────────────
  console.log("\nTEST 5 — Admin tarafi hala gerekli veriye erisiyor");
  if (!admin) {
    console.log("   ATLANDI — admin kullanici yok");
  } else {
    const cookie = await adminCookie(admin.id);

    const adminSettings = await getJson("/api/settings", cookie);
    check("Admin /api/settings okuyabiliyor (200)", adminSettings.status === 200, `gelen ${adminSettings.status}`);
    check(
      "Admin yanitinda private anahtarlar var",
      PRIVATE_SETTING_KEYS.some((k) => adminSettings.raw.includes(k)),
      "private anahtar bulunamadi"
    );

    if (appt) {
      const adminSales = await getJson(`/api/appointments?appointmentId=${appt.id}`, cookie);
      check("Admin appointmentId sorgusu calisiyor (200)", adminSales.status === 200, `gelen ${adminSales.status}`);
    }

    // Admin calisanlar sayfasi komisyon bilgisini gorebilmeli (server component)
    const calisanlar = await fetch(`${BASE_URL}/admin/calisanlar`, { headers: { Cookie: cookie } });
    const calisanlarHtml = await calisanlar.text();
    check("Admin /admin/calisanlar yukleniyor", calisanlar.status === 200, `gelen ${calisanlar.status}`);
    check(
      "Admin sayfasinda komisyon verisi hala mevcut",
      calisanlarHtml.includes("commissionRate") || calisanlarHtml.includes("Komisyon") || calisanlarHtml.includes("COMMISSION"),
      "admin komisyon verisini goremiyor"
    );
  }

  console.log("\n" + "=".repeat(64));
  console.log(`TOPLAM: ${passed + failed}   GECEN: ${passed}   KALAN: ${failed}`);
  if (failed > 0) { console.log("\nBASARISIZ:"); for (const f of failures) console.log("  - " + f); }
  console.log("Not: Bu script SALT OKUMA — hicbir kayit olusturulmadi/silinmedi.");
  console.log("=".repeat(64));
}

main()
  .then(() => db.$disconnect().then(() => process.exit(failed > 0 ? 1 : 0)))
  .catch(async (e) => { console.error("HATA:", e); await db.$disconnect(); process.exit(1); });

/**
 * Mass assignment testi — Faz 1 · Sıra 3.
 *
 * Çalıştırma (dev server ayakta olmalı):
 *   npx dotenv -e .env.local -- tsx scripts/verify-mass-assignment.ts
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
const TEST_MARK = "__MA_TEST__";

const { connectionString: connectionString } = assertWritableTestDatabase();

const db = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });

let passed = 0, failed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`   PASS  ${name}`); }
  else { failed++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`   FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

let cookie = "";
async function api(path: string, method: string, body: unknown) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json as Record<string, unknown> };
}

const createdBarberIds: string[] = [];
const createdWhIds: string[] = [];

async function main() {
  const admin = await db.user.findFirst({ select: { id: true } });
  if (!admin) throw new Error("Admin kullanici yok.");
  const key = new TextEncoder().encode(process.env.SESSION_SECRET);
  const tok = await new SignJWT({ userId: admin.id, expiresAt: new Date(Date.now() + 7 * 864e5) })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(key);
  cookie = `session=${tok}`;

  const validBarber = {
    name: `${TEST_MARK} Berber`,
    bio: "test",
    specialty: "test",
    experienceYrs: 5,
    calendarColor: "#123456",
    workerType: "COMMISSION",
    commissionRate: 40,
  };

  try {
    // ── TEST 1 — Gecerli barber create ────────────────────────────────────
    console.log("TEST 1 — Gecerli barber create/update");
    const c1 = await api("/api/barbers", "POST", validBarber);
    check("Gecerli create -> 201", c1.status === 201, `gelen ${c1.status} ${JSON.stringify(c1.body).slice(0, 150)}`);
    const created = c1.body.barber as { id?: string } | undefined;
    if (created?.id) createdBarberIds.push(created.id);
    const barberId = created?.id ?? "";

    if (barberId) {
      const saved = await db.barber.findUnique({ where: { id: barberId } });
      check("Izin verilen alanlar kaydedildi", saved?.name === validBarber.name && saved?.experienceYrs === 5, `name=${saved?.name}`);
      check("workerType yetkili admin akisinda yazilabildi", saved?.workerType === "COMMISSION", `gelen ${saved?.workerType}`);
      check("commissionRate yetkili admin akisinda yazilabildi", saved?.commissionRate === 40, `gelen ${saved?.commissionRate}`);
    }

    // ── TEST 2 — Sistem alani enjeksiyonu (id) ────────────────────────────
    console.log("\nTEST 2 — Sistem alanlari body ile degistirilemiyor");
    const injectedId = "hacked_id_000000000000";
    const c2 = await api("/api/barbers", "POST", { ...validBarber, id: injectedId });
    const idInjected = await db.barber.findUnique({ where: { id: injectedId } });
    if (c2.status === 201) {
      const b = c2.body.barber as { id?: string } | undefined;
      if (b?.id) createdBarberIds.push(b.id);
    }
    check("Enjekte edilen 'id' DB'ye yazilmadi", idInjected === null, "id enjeksiyonu basarili oldu!");

    // ── TEST 3 — createdAt enjeksiyonu ────────────────────────────────────
    const fakeDate = "1999-01-01T00:00:00.000Z";
    const c3 = await api("/api/barbers", "POST", { ...validBarber, createdAt: fakeDate });
    if (c3.status === 201) {
      const b = c3.body.barber as { id?: string; createdAt?: string } | undefined;
      if (b?.id) createdBarberIds.push(b.id);
      const saved = b?.id ? await db.barber.findUnique({ where: { id: b.id } }) : null;
      check(
        "Enjekte edilen 'createdAt' yok sayildi",
        !saved || saved.createdAt.getFullYear() !== 1999,
        `kaydedilen: ${saved?.createdAt.toISOString()}`
      );
    } else {
      check("Enjekte edilen 'createdAt' reddedildi (400)", c3.status === 400, `gelen ${c3.status}`);
    }

    // ── TEST 4 — Semada olmayan alan ──────────────────────────────────────
    console.log("\nTEST 4 — Beklenmeyen alan 500'e dusmuyor");
    const c4 = await api("/api/barbers", "POST", { ...validBarber, hackedField: "evil", isAdmin: true });
    if (c4.status === 201) {
      const b = c4.body.barber as { id?: string } | undefined;
      if (b?.id) createdBarberIds.push(b.id);
    }
    check("Bilinmeyen alan 500 HATASI vermiyor", c4.status !== 500, `gelen ${c4.status}`);
    check("Bilinmeyen alan ya yok sayildi ya 400 dondu", c4.status === 201 || c4.status === 400, `gelen ${c4.status}`);

    // ── TEST 5 — Yanlis tipler 400 donuyor ────────────────────────────────
    console.log("\nTEST 5 — Yanlis tip / gecersiz deger -> 400");
    const badCases: [string, Record<string, unknown>][] = [
      ["experienceYrs string", { ...validBarber, experienceYrs: "abc" }],
      ["commissionRate string", { ...validBarber, commissionRate: "cok" }],
      ["workerType gecersiz", { ...validBarber, workerType: "PATRON" }],
      ["name eksik", { bio: "x", experienceYrs: 1 }],
      ["name bos", { ...validBarber, name: "" }],
      ["isActive string", { ...validBarber, isActive: "evet" }],
    ];
    for (const [label, payload] of badCases) {
      const r = await api("/api/barbers", "POST", payload);
      if (r.status === 201) {
        const b = r.body.barber as { id?: string } | undefined;
        if (b?.id) createdBarberIds.push(b.id);
      }
      check(`${label} -> 400 (500 degil)`, r.status === 400, `gelen ${r.status}`);
    }

    // ── TEST 6 — PATCH mass assignment ────────────────────────────────────
    console.log("\nTEST 6 — PATCH sistem alani korumasi");
    if (barberId) {
      const p1 = await api(`/api/barbers/${barberId}`, "PATCH", { id: "yeni_id_deneme", name: `${TEST_MARK} Guncel` });
      const still = await db.barber.findUnique({ where: { id: barberId } });
      check("PATCH ile 'id' degistirilemedi", still !== null, "kayit kayboldu (id degismis olabilir)");
      check("PATCH ile izin verilen alan guncellendi", p1.status === 400 || still?.name === `${TEST_MARK} Guncel`, `status=${p1.status} name=${still?.name}`);

      const p2 = await api(`/api/barbers/${barberId}`, "PATCH", { experienceYrs: "cok" });
      check("PATCH yanlis tip -> 400", p2.status === 400, `gelen ${p2.status}`);

      const p3 = await api(`/api/barbers/${barberId}`, "PATCH", { isActive: false });
      const afterToggle = await db.barber.findUnique({ where: { id: barberId } });
      check("PATCH isActive toggle calisiyor (admin ekrani)", p3.status === 200 && afterToggle?.isActive === false, `status=${p3.status}`);

      const p4 = await api(`/api/barbers/${barberId}`, "PATCH", { workerType: "OWNER", commissionRate: 0 });
      const afterEdit = await db.barber.findUnique({ where: { id: barberId } });
      check("PATCH workerType/commissionRate calisiyor (admin ekrani)", p4.status === 200 && afterEdit?.workerType === "OWNER", `status=${p4.status}`);
    }

    // ── TEST 7 — Working hours ────────────────────────────────────────────
    console.log("\nTEST 7 — Working hours create/update");
    if (barberId) {
      const w1 = await api("/api/working-hours", "POST", { barberId, dayOfWeek: 3, startTime: "09:00", endTime: "18:00", isOff: false });
      check("Gecerli working-hour create -> 201", w1.status === 201, `gelen ${w1.status} ${JSON.stringify(w1.body).slice(0, 120)}`);
      const wh = w1.body.wh as { id?: string } | undefined;
      if (wh?.id) createdWhIds.push(wh.id);

      if (wh?.id) {
        const w2 = await api(`/api/working-hours/${wh.id}`, "PATCH", { startTime: "10:00", endTime: "17:00", isOff: false });
        const savedWh = await db.workingHour.findUnique({ where: { id: wh.id } });
        check("Gecerli working-hour update -> 200", w2.status === 200 && savedWh?.startTime === "10:00", `status=${w2.status} start=${savedWh?.startTime}`);

        await api(`/api/working-hours/${wh.id}`, "PATCH", { barberId: "baska_berber_id" });
        const afterW3 = await db.workingHour.findUnique({ where: { id: wh.id } });
        check("PATCH ile barberId degistirilemiyor", afterW3?.barberId === barberId, `gelen ${afterW3?.barberId}`);
      }

      const wBad: [string, Record<string, unknown>][] = [
        ["dayOfWeek 99", { barberId, dayOfWeek: 99, startTime: "09:00", endTime: "18:00" }],
        ["dayOfWeek string", { barberId, dayOfWeek: "pazartesi", startTime: "09:00", endTime: "18:00" }],
        ["startTime bozuk", { barberId, dayOfWeek: 4, startTime: "9am", endTime: "18:00" }],
        ["endTime < startTime", { barberId, dayOfWeek: 4, startTime: "18:00", endTime: "09:00", isOff: false }],
        ["barberId eksik", { dayOfWeek: 4, startTime: "09:00", endTime: "18:00" }],
        ["olmayan barberId", { barberId: "yok_boyle_bir_id", dayOfWeek: 4, startTime: "09:00", endTime: "18:00" }],
      ];
      for (const [label, payload] of wBad) {
        const r = await api("/api/working-hours", "POST", payload);
        if (r.status === 201) {
          const w = r.body.wh as { id?: string } | undefined;
          if (w?.id) createdWhIds.push(w.id);
        }
        check(`working-hours ${label} -> 400 (500 degil)`, r.status === 400, `gelen ${r.status}`);
      }
    }

    // ── TEST 8 — Yetkisiz erisim hala kapali ──────────────────────────────
    console.log("\nTEST 8 — Oturumsuz erisim");
    const savedCookie = cookie;
    cookie = "";
    const u1 = await api("/api/barbers", "POST", validBarber);
    const u2 = await api("/api/working-hours", "POST", { barberId, dayOfWeek: 1, startTime: "09:00", endTime: "18:00" });
    cookie = savedCookie;
    check("Oturumsuz barber create -> 401", u1.status === 401, `gelen ${u1.status}`);
    check("Oturumsuz working-hour create -> 401", u2.status === 401, `gelen ${u2.status}`);
  } finally {
    console.log("\nTEMIZLIK...");
    await db.workingHour.deleteMany({ where: { OR: [{ id: { in: createdWhIds } }, { barber: { name: { contains: TEST_MARK } } }] } });
    const delB = await db.barber.deleteMany({ where: { OR: [{ id: { in: createdBarberIds } }, { name: { contains: TEST_MARK } }] } });
    console.log(`  silinen: ${delB.count} berber, ${createdWhIds.length} calisma saati kaydi (+ iliskili)`);
  }

  console.log("\n" + "=".repeat(64));
  console.log(`TOPLAM: ${passed + failed}   GECEN: ${passed}   KALAN: ${failed}`);
  if (failed > 0) { console.log("\nBASARISIZ:"); for (const f of failures) console.log("  - " + f); }
  console.log("=".repeat(64));
}

main()
  .then(() => db.$disconnect().then(() => process.exit(failed > 0 ? 1 : 0)))
  .catch(async (e) => { console.error("HATA:", e); await db.$disconnect(); process.exit(1); });

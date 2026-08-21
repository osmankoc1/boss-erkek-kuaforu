/**
 * "Kayıt bulunamadı" (Prisma P2025) davranışı testi.
 *
 * Kapsam:
 *   DELETE /api/appointments/[id]
 *   POST   /api/customers/merge
 *
 * Çalıştırma (dev server ayakta olmalı):
 *   npx dotenv -e .env.local -- tsx scripts/verify-notfound-handling.ts
 *
 * UYARI: Dev veritabanına kendi test müşterilerini/randevularını yazar ve
 * sonunda hepsini siler. Gerçek kayıtlara yalnızca OKUMA yapar.
 * Production endpoint'ine karşı çalışmayı reddeder.
 */
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { SignJWT } from "jose";

neonConfig.webSocketConstructor = ws;

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const cs = process.env.DATABASE_URL;
if (!cs) {
  console.error("DATABASE_URL yok.");
  process.exit(1);
}
const ep = (/@([^/.]+)/.exec(cs)?.[1] ?? "").replace(/-pooler$/, "");
if (ep.startsWith("ep-raspy-brook")) {
  console.error("DURDURULDU: production.");
  process.exit(1);
}
console.log(`Hedef endpoint: ${ep.split("-").slice(0, 3).join("-")}-****  (production degil)\n`);

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

const MARK = "ZZNFTEST";
const PHONE_A = "05559990101";
const PHONE_B = "05559990102";
const PHONE_C = "05559990103";
const FAKE_IDS = ["yok-boyle-bir-id", "cmzzzzzzz000000000000000", "00000000-0000-0000-0000-000000000000"];

let cookie = "";

async function del(id: string, withAuth = true) {
  const res = await fetch(`${BASE}/api/appointments/${id}`, {
    method: "DELETE",
    headers: withAuth ? { Cookie: cookie } : {},
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function merge(body: unknown, withAuth = true, raw = false) {
  const res = await fetch(`${BASE}/api/customers/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(withAuth ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: raw ? (body as string) : JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/** Test kayıtlarını temizler; gerçek kayıtlara dokunmaz. */
async function cleanup() {
  const testCustomers = (await db.customer.findMany({ select: { id: true, fullName: true, phone: true } })).filter(
    (c) =>
      c.fullName.startsWith(MARK) ||
      [PHONE_A, PHONE_B, PHONE_C].some((t) => c.phone === t || c.phone.endsWith(`_${t}`))
  );
  const ids = testCustomers.map((c) => c.id);
  if (ids.length === 0) return { customers: 0, appointments: 0 };
  const appts = await db.appointment.deleteMany({ where: { customerId: { in: ids } } });
  const custs = await db.customer.deleteMany({ where: { id: { in: ids } } });
  return { customers: custs.count, appointments: appts.count };
}

async function main() {
  const admin = await db.user.findFirst({ select: { id: true } });
  if (!admin) throw new Error("Admin yok.");
  const key = new TextEncoder().encode(process.env.SESSION_SECRET);
  cookie = `session=${await new SignJWT({ userId: admin.id, expiresAt: new Date(Date.now() + 7 * 864e5) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key)}`;

  await cleanup();

  const barber = await db.barber.findFirst({ select: { id: true } });
  const service = await db.service.findFirst({ select: { id: true } });
  if (!barber || !service) throw new Error("Berber veya hizmet yok.");

  // Gerçek veri anlık görüntüsü — sonunda karşılaştırılacak.
  const realCustomersBefore = await db.customer.findMany({
    select: { id: true, fullName: true, phone: true, tag: true, mergedIntoCustomerId: true },
  });
  const realAppointmentsBefore = await db.appointment.findMany({
    select: { id: true, customerId: true, status: true, date: true },
  });
  console.log(`  (mevcut gercek veri: ${realCustomersBefore.length} musteri, ${realAppointmentsBefore.length} randevu)\n`);

  try {
    // ── TEST 1 — DELETE: var olmayan randevu ────────────────────────────
    console.log("TEST 1 — DELETE /api/appointments/[id] · var olmayan id");
    for (const fake of FAKE_IDS) {
      const r = await del(fake);
      check(`'${fake.slice(0, 24)}' -> 404 (500 degil)`, r.status === 404, `gelen ${r.status}`);
      check(`  ...anlamli hata mesaji`, typeof r.body.error === "string" && r.body.error.length > 0,
        `govde=${JSON.stringify(r.body).slice(0, 60)}`);
    }

    // ── TEST 2 — DELETE: yetkilendirme ──────────────────────────────────
    console.log("\nTEST 2 — DELETE · yetkilendirme");
    const dNoAuth = await del("yok-boyle-bir-id", false);
    check("Oturumsuz + sahte id -> 401 (varlik bilgisi sizmiyor)", dNoAuth.status === 401, `gelen ${dNoAuth.status}`);

    // ── TEST 3 — DELETE: gerçek akış bozulmadı ──────────────────────────
    console.log("\nTEST 3 — DELETE · gecerli silme akisi");
    const custDel = await db.customer.create({ data: { fullName: `${MARK} Silinecek`, phone: PHONE_A } });
    const appt = await db.appointment.create({
      data: {
        customerId: custDel.id,
        barberId: barber.id,
        serviceId: service.id,
        date: new Date(Date.now() + 90 * 864e5),
        startTime: "23:00",
        endTime: "23:30",
        status: "pending",
        notes: MARK,
      },
    });
    const okDel = await del(appt.id);
    check("Gercek randevu silme -> 200", okDel.status === 200, `gelen ${okDel.status}`);
    check("  ...randevu gercekten silindi", (await db.appointment.findUnique({ where: { id: appt.id } })) === null, "hala duruyor");
    const ikinciDel = await del(appt.id);
    check("Ayni id ikinci kez silinince -> 404", ikinciDel.status === 404, `gelen ${ikinciDel.status}`);
    const musteriDuruyor = await db.customer.findUnique({ where: { id: custDel.id }, select: { id: true } });
    check("  ...musteri kaydi silinmedi (yan etki yok)", musteriDuruyor !== null, "musteri de silindi");

    // ── TEST 4 — merge: var olmayan müşteri ─────────────────────────────
    console.log("\nTEST 4 — POST /api/customers/merge · var olmayan musteri");
    const custA = await db.customer.create({ data: { fullName: `${MARK} Ana`, phone: PHONE_B } });
    const m1 = await merge({ primaryId: "sahte-1", secondaryId: "sahte-2" });
    check("Iki id de sahte -> 404", m1.status === 404, `gelen ${m1.status}`);
    const m2 = await merge({ primaryId: "sahte-1", secondaryId: custA.id });
    check("primaryId sahte -> 404", m2.status === 404, `gelen ${m2.status}`);
    const m3 = await merge({ primaryId: custA.id, secondaryId: "sahte-2" });
    check("secondaryId sahte -> 404", m3.status === 404, `gelen ${m3.status}`);
    check("  ...hata mesajlari ayirt edici",
      m2.body.error !== m3.body.error,
      `ikisi de: ${JSON.stringify(m2.body.error)}`);

    // ── TEST 5 — merge: geçersiz gövde 400 (500 değil) ──────────────────
    console.log("\nTEST 5 — merge · gecersiz govde -> 400");
    const badBodies: [string, unknown, boolean][] = [
      ["eksik alan", { primaryId: "x" }, false],
      ["bos nesne", {}, false],
      ["yanlis tip", { primaryId: 1, secondaryId: 2 }, false],
      ["bos string id", { primaryId: "", secondaryId: "" }, false],
      ["body dizi", ["a", "b"], false],
      ["body null", null, false],
      ["bozuk JSON", "{bozuk-json", true],
    ];
    for (const [label, b, raw] of badBodies) {
      const r = await merge(b, true, raw);
      check(`${label} -> 400`, r.status === 400, `gelen ${r.status}`);
    }
    const govdesiz = await merge(undefined);
    check("govde hic yok -> 400", govdesiz.status === 400, `gelen ${govdesiz.status}`);
    const ayni = await merge({ primaryId: custA.id, secondaryId: custA.id });
    check("ayni musteri -> 400 (mevcut kural)", ayni.status === 400, `gelen ${ayni.status}`);

    // ── TEST 6 — merge: yetkilendirme ───────────────────────────────────
    console.log("\nTEST 6 — merge · yetkilendirme");
    const mNoAuth = await merge({ primaryId: "sahte-1", secondaryId: "sahte-2" }, false);
    check("Oturumsuz -> 401 (404'ten once)", mNoAuth.status === 401, `gelen ${mNoAuth.status}`);

    // ── TEST 7 — merge: geçerli akış aynen çalışıyor ─────────────────────
    console.log("\nTEST 7 — merge · gecerli birlestirme akisi");
    const custB = await db.customer.create({ data: { fullName: `${MARK} Ikincil`, phone: PHONE_C } });
    const apptB = await db.appointment.create({
      data: {
        customerId: custB.id,
        barberId: barber.id,
        serviceId: service.id,
        date: new Date(Date.now() + 91 * 864e5),
        startTime: "23:00",
        endTime: "23:30",
        status: "pending",
        notes: MARK,
      },
    });
    const okMerge = await merge({ primaryId: custA.id, secondaryId: custB.id });
    check("Gecerli birlestirme -> 200", okMerge.status === 200, `gelen ${okMerge.status} ${JSON.stringify(okMerge.body).slice(0, 80)}`);
    check("  ...donen primaryId dogru", okMerge.body.primaryId === custA.id, `gelen ${okMerge.body.primaryId}`);
    const merged = await db.customer.findUnique({ where: { id: custB.id }, select: { mergedIntoCustomerId: true, mergedAt: true, phone: true } });
    check("  ...ikincil musteri isaretlendi", merged?.mergedIntoCustomerId === custA.id, `deger=${merged?.mergedIntoCustomerId}`);
    check("  ...mergedAt yazildi", merged?.mergedAt !== null && merged?.mergedAt !== undefined, "bos");
    check("  ...telefon serbest birakildi", merged?.phone.startsWith("__merged_") === true, `deger=${merged?.phone}`);
    const tasinan = await db.appointment.findUnique({ where: { id: apptB.id }, select: { customerId: true } });
    check("  ...randevu ana musteriye tasindi", tasinan?.customerId === custA.id, `deger=${tasinan?.customerId}`);
    const tekrar = await merge({ primaryId: custA.id, secondaryId: custB.id });
    check("Ayni birlestirme tekrar -> 400 (mevcut kural)", tekrar.status === 400, `gelen ${tekrar.status}`);

    // ── TEST 8 — Gerçek veri bozulmadı ──────────────────────────────────
    console.log("\nTEST 8 — Gercek musteri ve randevu verisi bozulmadi");
    const realCustomersAfter = await db.customer.findMany({
      where: { id: { in: realCustomersBefore.map((c) => c.id) } },
      select: { id: true, fullName: true, phone: true, tag: true, mergedIntoCustomerId: true },
    });
    check("Gercek musteri sayisi ayni", realCustomersAfter.length === realCustomersBefore.length,
      `once=${realCustomersBefore.length} sonra=${realCustomersAfter.length}`);
    const custDegisen = realCustomersAfter.filter((a) => {
      const b = realCustomersBefore.find((x) => x.id === a.id)!;
      return b.fullName !== a.fullName || b.phone !== a.phone || b.tag !== a.tag || b.mergedIntoCustomerId !== a.mergedIntoCustomerId;
    });
    check("Hicbir gercek musteri degismedi", custDegisen.length === 0, custDegisen.map((c) => c.fullName).join(", "));

    const realApptsAfter = await db.appointment.findMany({
      where: { id: { in: realAppointmentsBefore.map((a) => a.id) } },
      select: { id: true, customerId: true, status: true, date: true },
    });
    check("Gercek randevu sayisi ayni", realApptsAfter.length === realAppointmentsBefore.length,
      `once=${realAppointmentsBefore.length} sonra=${realApptsAfter.length}`);
    const apptDegisen = realApptsAfter.filter((a) => {
      const b = realAppointmentsBefore.find((x) => x.id === a.id)!;
      return b.customerId !== a.customerId || b.status !== a.status || b.date.getTime() !== a.date.getTime();
    });
    check("Hicbir gercek randevu degismedi", apptDegisen.length === 0, apptDegisen.map((a) => a.id).join(", "));
  } finally {
    console.log("\nTEMIZLIK...");
    const c = await cleanup();
    console.log(`  silinen test randevusu: ${c.appointments}`);
    console.log(`  silinen test musterisi: ${c.customers}`);
    console.log(`  DB: ${await db.customer.count()} musteri, ${await db.appointment.count()} randevu`);
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

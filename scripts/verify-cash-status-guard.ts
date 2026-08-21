/**
 * Kasa kaydının randevu durum makinesini bypass etmesi (FAZ 2 · Sıra 4).
 *
 * Çalıştırma (dev server ayakta olmalı):
 *   npx dotenv -e .env.local -- tsx scripts/verify-cash-status-guard.ts
 *
 * KURAL: `POST /api/cash` bir randevuyu `completed` yapıyor. Bu, randevu
 * durum makinesinin (`ALLOWED_TRANSITIONS`, app/api/appointments/[id])
 * izin verdiği bir geçiş olmalı. `cancelled` uç durumdur; oradan
 * `completed`'a dönüş yasaktır.
 *
 * UYARI: Dev veritabanına test verisi yazar ve sonunda siler.
 * Production endpoint'ine karşı çalışmayı reddeder.
 */
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { assertWritableTestDatabase } from "../lib/db-guard";
import { SignJWT } from "jose";
import { addIstanbulDays } from "../lib/tz";

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

const MARK = "ZZSTATUSTEST";
const PHONE_PREFIX = "0555999040";
const TUTAR = 250;

let cookie = "";
const post = (u: string, body: unknown) =>
  fetch(`${BASE}${u}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }));

async function cleanup() {
  const custs = (await db.customer.findMany({ select: { id: true, fullName: true, phone: true } })).filter(
    (c) => c.fullName.startsWith(MARK) || c.phone.startsWith(PHONE_PREFIX) || c.phone.includes(`_${PHONE_PREFIX}`)
  );
  const ids = custs.map((c) => c.id);
  const saleIds = (
    await db.sale.findMany({ where: { OR: [{ customerId: { in: ids } }, { note: MARK }] }, select: { id: true } })
  ).map((s) => s.id);
  const n = { odeme: 0, satis: 0, randevu: 0, musteri: 0 };
  if (saleIds.length) {
    n.odeme = (await db.customerPayment.deleteMany({ where: { saleId: { in: saleIds } } })).count;
    await db.saleItem.deleteMany({ where: { saleId: { in: saleIds } } });
    n.satis = (await db.sale.deleteMany({ where: { id: { in: saleIds } } })).count;
  }
  if (ids.length) {
    await db.customerPayment.deleteMany({ where: { customerId: { in: ids } } });
    n.randevu = (await db.appointment.deleteMany({ where: { customerId: { in: ids } } })).count;
    n.musteri = (await db.customer.deleteMany({ where: { id: { in: ids } } })).count;
  }
  return n;
}

/** Test edilen tüm randevu durumları ve beklenen sonuç. */
type Senaryo = {
  status: string;
  /** Kasa kaydı açılabilmeli mi? */
  izinli: boolean;
  aciklama: string;
};

const SENARYOLAR: Senaryo[] = [
  { status: "confirmed", izinli: true, aciklama: "onaylanmis randevu — normal akis" },
  {
    status: "completed",
    izinli: true,
    aciklama: "BILEREK izinli: Dashboard'daki 'kasa kaydi eksik' uzlastirma akisi bunu bekler",
  },
  { status: "cancelled", izinli: false, aciklama: "IPTAL edilmis — uc durum, geri donusu yok" },
  { status: "pending", izinli: false, aciklama: "URUN KARARI: once onaylanmali" },
  { status: "pending_verification", izinli: false, aciklama: "URUN KARARI: e-posta dogrulanmamis" },
];

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

  const barber = await db.barber.findFirst({ select: { id: true, name: true } });
  const service = await db.service.findFirst({ select: { id: true, name: true } });
  if (!barber || !service) throw new Error("Berber veya hizmet yok.");

  const satisOnce = await db.sale.count();
  console.log(`  (mevcut gercek veri: ${satisOnce} satis)\n`);

  try {
    for (let i = 0; i < SENARYOLAR.length; i++) {
      const sen = SENARYOLAR[i];
      console.log(`TEST ${i + 1} — randevu durumu '${sen.status}' (${sen.aciklama})`);

      const phone = `${PHONE_PREFIX}${i}`;
      const cust = await db.customer.create({
        data: {
          fullName: `${MARK} ${sen.status}`,
          phone,
          // Iptal senaryosunda sayacin baslangic degeri bilinsin.
          cancelledCount: sen.status === "cancelled" ? 1 : 0,
        },
      });
      const appt = await db.appointment.create({
        data: {
          customerId: cust.id,
          barberId: barber.id,
          serviceId: service.id,
          date: addIstanbulDays(new Date(), 0),
          startTime: "13:00",
          endTime: "14:00",
          status: sen.status,
          appointmentPrice: TUTAR,
          notes: MARK,
        },
      });

      const oncekiSayac = await db.customer.findUnique({
        where: { id: cust.id },
        select: { completedCount: true, cancelledCount: true },
      });

      const r = await post("/api/cash", {
        appointmentId: appt.id,
        barberId: barber.id,
        customerName: cust.fullName,
        customerPhone: cust.phone,
        serviceName: service.name,
        serviceId: service.id,
        listedPrice: TUTAR,
        saleAmount: TUTAR,
        paidAmount: TUTAR,
        paymentMethod: "CASH",
        note: MARK,
      });

      const sonra = await db.appointment.findUnique({ where: { id: appt.id }, select: { status: true } });
      const satisVar = (await db.sale.count({ where: { appointmentId: appt.id } })) > 0;
      const sonrakiSayac = await db.customer.findUnique({
        where: { id: cust.id },
        select: { completedCount: true, cancelledCount: true },
      });

      if (sen.izinli) {
        check(`  '${sen.status}' -> 201 (kasa kaydi acildi)`, r.status === 201,
          `gelen ${r.status} ${JSON.stringify(r.body).slice(0, 90)}`);
        check(`  ...randevu 'completed' oldu`, sonra?.status === "completed", `durum ${sonra?.status}`);
        check(`  ...satis kaydi olustu`, satisVar, "olusmadi");
        check(`  ...completedCount 1 artti`,
          (sonrakiSayac?.completedCount ?? 0) === (oncekiSayac?.completedCount ?? 0) + 1,
          `${oncekiSayac?.completedCount} -> ${sonrakiSayac?.completedCount}`);
      } else {
        check(`  '${sen.status}' -> reddedildi (2xx DEGIL)`, r.status >= 400,
          `gelen ${r.status} ${JSON.stringify(r.body).slice(0, 90)}`);
        check(`  ...randevu durumu DEGISMEDI ('${sen.status}')`, sonra?.status === sen.status,
          `durum ${sonra?.status}`);
        check(`  ...satis kaydi OLUSMADI`, !satisVar, "olustu");
        check(`  ...completedCount ARTMADI`,
          (sonrakiSayac?.completedCount ?? 0) === (oncekiSayac?.completedCount ?? 0),
          `${oncekiSayac?.completedCount} -> ${sonrakiSayac?.completedCount}`);
        check(`  ...cancelledCount degismedi`,
          (sonrakiSayac?.cancelledCount ?? 0) === (oncekiSayac?.cancelledCount ?? 0),
          `${oncekiSayac?.cancelledCount} -> ${sonrakiSayac?.cancelledCount}`);
        check(`  ...hata mesaji anlamli`, typeof r.body.error === "string" && (r.body.error as string).length > 0,
          `govde ${JSON.stringify(r.body).slice(0, 80)}`);
      }
      console.log("");
    }

    // ── Randevusuz (walk-in) satış etkilenmemeli ──────────────────────────
    console.log("TEST 6 — Randevusuz (walk-in) satis akisi etkilenmiyor");
    const walkCust = await db.customer.create({
      data: { fullName: `${MARK} WalkIn`, phone: `${PHONE_PREFIX}9` },
    });
    const walk = await post("/api/cash", {
      customerId: walkCust.id,
      barberId: barber.id,
      customerName: walkCust.fullName,
      customerPhone: walkCust.phone,
      serviceName: service.name,
      serviceId: service.id,
      listedPrice: TUTAR,
      saleAmount: TUTAR,
      paidAmount: TUTAR,
      paymentMethod: "CASH",
      note: MARK,
    });
    check("Walk-in satis -> 201", walk.status === 201, `gelen ${walk.status}`);
    check("  ...satis kaydi olustu", (await db.sale.count({ where: { customerId: walkCust.id } })) === 1, "olusmadi");

    // ── Var olmayan randevu ───────────────────────────────────────────────
    console.log("\nTEST 7 — Var olmayan randevu id'si");
    const yok = await post("/api/cash", {
      appointmentId: "yok-boyle-bir-randevu",
      barberId: barber.id,
      customerName: "X",
      customerPhone: "",
      serviceName: service.name,
      listedPrice: TUTAR,
      saleAmount: TUTAR,
      paidAmount: TUTAR,
      note: MARK,
    });
    check("Sahte randevu id -> 404", yok.status === 404, `gelen ${yok.status}`);

    // ── Gerçek veri bozulmadı ─────────────────────────────────────────────
    console.log("\nTEST 8 — Gercek veri bozulmadi");
    check("Test disi satis sayisi degismedi",
      (await db.sale.count({ where: { note: { not: MARK } } })) === satisOnce, `once ${satisOnce}`);
  } finally {
    console.log("\nTEMIZLIK...");
    const n = await cleanup();
    console.log(`  silinen: odeme=${n.odeme} satis=${n.satis} randevu=${n.randevu} musteri=${n.musteri}`);
    console.log(`  DB: ${await db.sale.count()} satis, ${await db.appointment.count()} randevu, ${await db.customer.count()} musteri`);
  }

  console.log("\n" + "=".repeat(66));
  console.log(`TOPLAM: ${passed + failed}   GECEN: ${passed}   KALAN: ${failed}`);
  if (failed > 0) {
    console.log("\nBASARISIZ:");
    for (const f of failures) console.log("  - " + f);
  }
  console.log("=".repeat(66));
}

main()
  .then(() => db.$disconnect().then(() => process.exit(failed > 0 ? 1 : 0)))
  .catch(async (e) => {
    console.error("HATA:", e);
    await db.$disconnect();
    process.exit(1);
  });

/**
 * Tahsilat günü testi (FAZ 2 · Sıra 3).
 *
 * Çalıştırma (dev server ayakta olmalı):
 *   npx dotenv -e .env.local -- tsx scripts/verify-collection-day.ts
 *
 * KURAL:
 *   Gerçekleşen Ciro  -> satışın gününe yazılır (saleDate)
 *   Tahsilat          -> paranın ALINDIĞI güne yazılır (paymentDate)
 * Dünkü veresiye satışın bugün yapılan tahsilatı BUGÜNÜN kasasına girmeli;
 * dünün raporu geriye dönük DEĞİŞMEMELİ.
 *
 * UYARI: Dev veritabanına test verisi yazar ve sonunda siler.
 * Production endpoint'ine karşı çalışmayı reddeder.
 */
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { SignJWT } from "jose";
import { istanbulDateString, addIstanbulDays } from "../lib/tz";

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

const MARK = "ZZTAHSTEST";
const PHONE = "05559990301";
const BUGUN = istanbulDateString();
const DUN = istanbulDateString(addIstanbulDays(new Date(), -1));

/** Senaryo: dün 400 TL'lik satış, 100 peşin; bugün 300 TL tahsilat. */
const SATIS = 400;
const PESIN = 100;
const BUGUNKU_TAHSILAT = 300;

let cookie = "";
const get = (u: string) =>
  fetch(`${BASE}${u}`, { headers: { Cookie: cookie }, cache: "no-store" }).then((r) => r.json());
const post = (u: string, body: unknown) =>
  fetch(`${BASE}${u}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

async function cleanup() {
  const custs = (await db.customer.findMany({ select: { id: true, fullName: true, phone: true } })).filter(
    (c) => c.fullName.startsWith(MARK) || c.phone === PHONE || c.phone.endsWith(`_${PHONE}`)
  );
  const ids = custs.map((c) => c.id);
  const saleIds = (
    await db.sale.findMany({ where: { OR: [{ customerId: { in: ids } }, { note: MARK }] }, select: { id: true } })
  ).map((s) => s.id);
  const n = { odeme: 0, satis: 0, musteri: 0 };
  if (saleIds.length) {
    n.odeme = (await db.customerPayment.deleteMany({ where: { saleId: { in: saleIds } } })).count;
    await db.saleItem.deleteMany({ where: { saleId: { in: saleIds } } });
    n.satis = (await db.sale.deleteMany({ where: { id: { in: saleIds } } })).count;
  }
  if (ids.length) {
    await db.customerPayment.deleteMany({ where: { customerId: { in: ids } } });
    await db.appointment.deleteMany({ where: { customerId: { in: ids } } });
    n.musteri = (await db.customer.deleteMany({ where: { id: { in: ids } } })).count;
  }
  return n;
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

  const barber = await db.barber.findFirst({ select: { id: true, name: true } });
  const service = await db.service.findFirst({ select: { id: true, name: true } });
  if (!barber || !service) throw new Error("Berber veya hizmet yok.");

  const satisOnce = await db.sale.count();
  console.log(`  (mevcut gercek veri: ${satisOnce} satis)`);
  console.log(`  DUN=${DUN}  BUGUN=${BUGUN}\n`);

  let saleId = "";
  try {
    // ── Kurulum: DÜNKÜ veresiye satış ─────────────────────────────────────
    console.log("KURULUM — dunku veresiye satis");
    const cust = await db.customer.create({ data: { fullName: `${MARK} Musteri`, phone: PHONE } });
    const created = await post("/api/cash", {
      customerId: cust.id,
      barberId: barber.id,
      customerName: cust.fullName,
      customerPhone: cust.phone,
      serviceName: service.name,
      serviceId: service.id,
      listedPrice: SATIS,
      saleAmount: SATIS,
      paidAmount: PESIN,
      paymentMethod: "CASH",
      note: MARK,
      saleDate: `${DUN}T12:00:00.000Z`,
    });
    check("Dunku satis olusturuldu (201)", created.status === 201, `gelen ${created.status} ${JSON.stringify(created.body).slice(0, 100)}`);
    saleId = (created.body as { sale?: { id: string } }).sale?.id ?? "";
    if (!saleId) throw new Error("Satis id alinamadi.");
    console.log(`   satis ${SATIS} TL, pesin ${PESIN} TL, kalan ${SATIS - PESIN} TL`);

    // ── TEST 1 — Tahsilat öncesi dünün rakamları ──────────────────────────
    console.log("\nTEST 1 — Tahsilat ONCESI dunun rakamlari");
    const dunOnce = await get(`/api/cash/summary?date=${DUN}`);
    check(`Dun ciro = ${SATIS}`, dunOnce.realizedRevenue === SATIS, `gelen ${dunOnce.realizedRevenue}`);
    check(`Dun tahsilat = ${PESIN}`, dunOnce.collected === PESIN, `gelen ${dunOnce.collected}`);
    check(`Dun veresiye kalan = ${SATIS - PESIN}`, dunOnce.credit === SATIS - PESIN, `gelen ${dunOnce.credit}`);

    const bugunOnce = await get(`/api/cash/summary?date=${BUGUN}`);
    check("Bugun ciro = 0 (satis dun)", bugunOnce.realizedRevenue === 0, `gelen ${bugunOnce.realizedRevenue}`);
    check("Bugun tahsilat = 0 (henuz odeme yok)", bugunOnce.collected === 0, `gelen ${bugunOnce.collected}`);

    // ── Bugün tahsilat yapılıyor ──────────────────────────────────────────
    console.log(`\nTAHSILAT — bugun ${BUGUNKU_TAHSILAT} TL alindi`);
    const odeme = await post("/api/debts/payment", {
      saleId,
      customerId: cust.id,
      amount: BUGUNKU_TAHSILAT,
      paymentMethod: "CARD",
      note: MARK,
    });
    check("Tahsilat kaydedildi (201)", odeme.status === 201, `gelen ${odeme.status}`);

    // ── TEST 2 — Dünün raporu DEĞİŞMEMELİ ─────────────────────────────────
    console.log("\nTEST 2 — Dunun raporu geriye donuk DEGISMEMELI");
    const dunSonra = await get(`/api/cash/summary?date=${DUN}`);
    check(`Dun ciro hala ${SATIS}`, dunSonra.realizedRevenue === SATIS, `gelen ${dunSonra.realizedRevenue}`);
    check(`Dun tahsilat hala ${PESIN} (DEGISMEDI)`, dunSonra.collected === PESIN,
      `gelen ${dunSonra.collected} — bugunku tahsilat dune yazilmis`);

    // ── TEST 3 — Bugünün kasasına girmeli ─────────────────────────────────
    console.log("\nTEST 3 — Tahsilat BUGUNUN kasasina girmeli");
    const bugunSonra = await get(`/api/cash/summary?date=${BUGUN}`);
    check(`Bugun tahsilat = ${BUGUNKU_TAHSILAT}`, bugunSonra.collected === BUGUNKU_TAHSILAT,
      `gelen ${bugunSonra.collected}`);
    check("Bugun ciro hala 0 (yeni satis yok)", bugunSonra.realizedRevenue === 0,
      `gelen ${bugunSonra.realizedRevenue}`);

    // ── TEST 4 — Gün Sonu ve Dashboard aynı sonucu vermeli ────────────────
    console.log("\nTEST 4 — Gun Sonu ve Dashboard ayni tahsilati gosteriyor");
    const gunSonuBugun = await get(`/api/day-end?date=${BUGUN}`);
    const dashBugun = await get(`/api/dashboard?range=custom&from=${BUGUN}&to=${BUGUN}`);
    check("day-end bugun tahsilat dogru", gunSonuBugun.collected === BUGUNKU_TAHSILAT, `gelen ${gunSonuBugun.collected}`);
    check("dashboard bugun tahsilat dogru", dashBugun.revenue?.collected === BUGUNKU_TAHSILAT,
      `gelen ${dashBugun.revenue?.collected}`);
    const gunSonuDun = await get(`/api/day-end?date=${DUN}`);
    check("day-end dun tahsilat degismedi", gunSonuDun.collected === PESIN, `gelen ${gunSonuDun.collected}`);

    // ── TEST 5 — Ödeme defteri ile satış tutarlı ──────────────────────────
    console.log("\nTEST 5 — Odeme defteri (CustomerPayment) satisla tutarli");
    const sale = await db.sale.findUnique({ where: { id: saleId }, select: { paidAmount: true, remainingAmount: true, saleStatus: true } });
    const payments = await db.customerPayment.findMany({ where: { saleId }, select: { amount: true, paymentDate: true, paymentMethod: true } });
    const defterToplam = payments.reduce((s, p) => s + p.amount, 0);
    console.log(`      defterde ${payments.length} kayit, toplam ${defterToplam} | sale.paidAmount ${sale?.paidAmount}`);
    for (const p of payments) {
      console.log(`        ${istanbulDateString(p.paymentDate)}  ${p.amount} TL  ${p.paymentMethod}`);
    }
    check("Satis olusturulurken pesin odeme deftere yazildi", payments.length >= 2,
      `defterde ${payments.length} kayit (pesin + tahsilat beklenir)`);
    check("Defter toplami = sale.paidAmount", Math.abs(defterToplam - (sale?.paidAmount ?? 0)) < 0.01,
      `defter ${defterToplam} != satis ${sale?.paidAmount}`);
    check(`sale.paidAmount = ${PESIN + BUGUNKU_TAHSILAT}`, sale?.paidAmount === PESIN + BUGUNKU_TAHSILAT,
      `gelen ${sale?.paidAmount}`);
    check("Kalan tutar dogru", sale?.remainingAmount === SATIS - PESIN - BUGUNKU_TAHSILAT,
      `gelen ${sale?.remainingAmount}`);

    // ── TEST 6 — Ödeme yöntemi kırılımı doğru güne/yönteme yazılıyor ──────
    console.log("\nTEST 6 — Odeme yontemi kirilimi");
    check("Dun NAKIT kiriliminda pesin var", (dunSonra.byMethod?.CASH ?? 0) === PESIN,
      `gelen ${JSON.stringify(dunSonra.byMethod)}`);
    check("Bugun KART kiriliminda tahsilat var", (bugunSonra.byMethod?.CARD ?? 0) === BUGUNKU_TAHSILAT,
      `gelen ${JSON.stringify(bugunSonra.byMethod)}`);

    // ── TEST 7 — Net Kasa tahsilat üzerinden ──────────────────────────────
    console.log("\nTEST 7 — Net Kasa = Tahsilat - Gider");
    check("Bugun net kasa = bugunku tahsilat", bugunSonra.netCash === BUGUNKU_TAHSILAT - (bugunSonra.expenses ?? 0),
      `netCash ${bugunSonra.netCash}`);

    // ── TEST 8 — Gerçek veri bozulmadı ────────────────────────────────────
    console.log("\nTEST 8 — Gercek veri bozulmadi");
    check("Test disi satis sayisi degismedi", (await db.sale.count({ where: { note: { not: MARK } } })) === satisOnce,
      `once ${satisOnce}`);
  } finally {
    console.log("\nTEMIZLIK...");
    const n = await cleanup();
    console.log(`  silinen: odeme=${n.odeme} satis=${n.satis} musteri=${n.musteri}`);
    console.log(`  DB: ${await db.sale.count()} satis, ${await db.customerPayment.count()} odeme, ${await db.customer.count()} musteri`);
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

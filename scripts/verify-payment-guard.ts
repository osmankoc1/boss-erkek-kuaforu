/**
 * Fazla ve mükerrer ödeme koruması (FAZ 2 · Sıra 6).
 *
 * Çalıştırma (dev server ayakta olmalı):
 *   npx dotenv -e .env.local -- tsx scripts/verify-payment-guard.ts
 *
 * HEDEF DAVRANIŞ:
 *   • Kalan borçtan fazla tahsilat SESSİZCE KIRPILMAZ; 400 ile reddedilir ve
 *     hiçbir veri değişmez.
 *   • Aynı ödeme isteğinin tekrarı (çift tıklama) mükerrer kayıt üretmez.
 *   • Eşzamanlı istekler sunucu tarafında serileştirilir; yarış koşulu yok.
 *   • Σ(ödeme defteri) == sale.paidAmount değişmezi her senaryoda korunur.
 *   • Tam ödeme ve kısmi ödeme aynen çalışmaya devam eder.
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
import { istanbulDateString } from "../lib/tz";

/** Prisma artik para alanlarini Decimal doner; testte sayiya cevrilir (Sira 9a). */
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));


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

const MARK = "ZZPAYTEST";
const PHONE_PREFIX = "0555999060";
const BUGUN = istanbulDateString();

let cookie = "";
const post = (u: string, body: unknown) =>
  fetch(`${BASE}${u}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }));
const get = (u: string) =>
  fetch(`${BASE}${u}`, { headers: { Cookie: cookie }, cache: "no-store" }).then((r) => r.json());

async function cleanup() {
  const custs = (await db.customer.findMany({ select: { id: true, fullName: true, phone: true } })).filter(
    (c) => c.fullName.startsWith(MARK) || c.phone.startsWith(PHONE_PREFIX) || c.phone.includes(`_${PHONE_PREFIX}`)
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

let sayac = 0;
/** Yeni bir veresiye satış kurar. Döner: saleId, customerId. */
async function veresiyeSatis(saleAmount: number, paidAmount: number, barberId: string, serviceName: string) {
  sayac += 1;
  const cust = await db.customer.create({
    data: { fullName: `${MARK} ${sayac}`, phone: `${PHONE_PREFIX}${sayac}` },
  });
  const r = await post("/api/cash", {
    customerId: cust.id,
    barberId,
    customerName: cust.fullName,
    customerPhone: cust.phone,
    serviceName,
    listedPrice: saleAmount,
    saleAmount,
    paidAmount,
    paymentMethod: "CASH",
    note: MARK,
  });
  const saleId = (r.body as { sale?: { id: string } }).sale?.id;
  if (!saleId) throw new Error(`Satis olusturulamadi: ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  return { saleId, customerId: cust.id };
}

/** Satış + defter durumunu okur ve değişmezi doğrular. */
async function durum(saleId: string) {
  const sale = await db.sale.findUnique({
    where: { id: saleId },
    select: { saleAmount: true, paidAmount: true, remainingAmount: true, saleStatus: true },
  });
  const odemeler = await db.customerPayment.findMany({ where: { saleId }, select: { amount: true } });
  const defter = Math.round(odemeler.reduce((s, p) => s + n(p.amount), 0) * 100) / 100;
  return { sale, odemeler, defter };
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
  const service = await db.service.findFirst({ select: { name: true } });
  if (!barber || !service) throw new Error("Berber veya hizmet yok.");

  const satisOnce = await db.sale.count();
  console.log(`  (mevcut gercek veri: ${satisOnce} satis)\n`);

  try {
    // ── TEST 1 — Kalan borçtan FAZLA ödeme ────────────────────────────────
    console.log("TEST 1 — Kalan borctan FAZLA odeme reddedilmeli");
    {
      const { saleId, customerId } = await veresiyeSatis(400, 100, barber.id, service.name);
      const once = await durum(saleId);
      console.log(`      satis 400, pesin 100, kalan ${once.sale?.remainingAmount}`);

      const r = await post("/api/debts/payment", { saleId, customerId, amount: 1000, paymentMethod: "CASH", note: MARK });
      const sonra = await durum(saleId);

      check("Fazla odeme (1000 > kalan 300) -> 400", r.status === 400,
        `gelen ${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
      check("  ...hata mesaji kalan tutari soyluyor",
        typeof r.body.error === "string" && /300/.test(r.body.error as string),
        `mesaj: ${String(r.body.error).slice(0, 90)}`);
      check("  ...sale.paidAmount DEGISMEDI (100)", n(sonra.sale?.paidAmount) === 100,
        `gelen ${sonra.sale?.paidAmount}`);
      check("  ...sale.remainingAmount DEGISMEDI (300)", n(sonra.sale?.remainingAmount) === 300,
        `gelen ${sonra.sale?.remainingAmount}`);
      check("  ...defter kaydi EKLENMEDI", sonra.odemeler.length === once.odemeler.length,
        `${once.odemeler.length} -> ${sonra.odemeler.length}`);
      check("  ...defter == paidAmount", Math.abs(sonra.defter - n(sonra.sale?.paidAmount)) < 0.01,
        `defter ${sonra.defter} != ${sonra.sale?.paidAmount}`);
    }

    // ── TEST 2 — Tam kalan borç kadar ödeme çalışmalı ─────────────────────
    console.log("\nTEST 2 — Tam kalan borc kadar odeme (normal akis)");
    {
      const { saleId, customerId } = await veresiyeSatis(400, 100, barber.id, service.name);
      const r = await post("/api/debts/payment", { saleId, customerId, amount: 300, paymentMethod: "CARD", note: MARK });
      const s = await durum(saleId);
      check("Tam kalan borc -> 201", r.status === 201, `gelen ${r.status}`);
      check("  ...paidAmount = 400", n(s.sale?.paidAmount) === 400, `gelen ${s.sale?.paidAmount}`);
      check("  ...remainingAmount = 0", n(s.sale?.remainingAmount) === 0, `gelen ${s.sale?.remainingAmount}`);
      check("  ...saleStatus = PAID", s.sale?.saleStatus === "PAID", `gelen ${s.sale?.saleStatus}`);
      check("  ...defter == paidAmount", Math.abs(s.defter - 400) < 0.01, `defter ${s.defter}`);
    }

    // ── TEST 3 — Kısmi ödeme çalışmalı ────────────────────────────────────
    console.log("\nTEST 3 — Kismi odeme (normal akis)");
    {
      const { saleId, customerId } = await veresiyeSatis(500, 0, barber.id, service.name);
      const r1 = await post("/api/debts/payment", { saleId, customerId, amount: 200, paymentMethod: "CASH", note: MARK });
      const s1 = await durum(saleId);
      check("Ilk kismi odeme -> 201", r1.status === 201, `gelen ${r1.status}`);
      check("  ...paidAmount = 200, kalan 300", n(s1.sale?.paidAmount) === 200 && n(s1.sale?.remainingAmount) === 300,
        `paid ${s1.sale?.paidAmount} kalan ${s1.sale?.remainingAmount}`);
      check("  ...saleStatus = PARTIAL", s1.sale?.saleStatus === "PARTIAL", `gelen ${s1.sale?.saleStatus}`);

      // Farkli tutarda ikinci kismi odeme (mukerrer degil) kabul edilmeli
      const r2 = await post("/api/debts/payment", { saleId, customerId, amount: 150, paymentMethod: "CARD", note: MARK });
      const s2 = await durum(saleId);
      check("Farkli tutarda ikinci kismi odeme -> 201", r2.status === 201, `gelen ${r2.status}`);
      check("  ...paidAmount = 350, kalan 150", n(s2.sale?.paidAmount) === 350 && n(s2.sale?.remainingAmount) === 150,
        `paid ${s2.sale?.paidAmount} kalan ${s2.sale?.remainingAmount}`);
      check("  ...defter == paidAmount", Math.abs(s2.defter - 350) < 0.01, `defter ${s2.defter}`);
    }

    // ── TEST 4 — Borcu kapanmış satışa tekrar ödeme ───────────────────────
    console.log("\nTEST 4 — Borcu kapanmis satisa tekrar odeme");
    {
      const { saleId, customerId } = await veresiyeSatis(200, 200, barber.id, service.name);
      const once = await durum(saleId);
      const r = await post("/api/debts/payment", { saleId, customerId, amount: 50, paymentMethod: "CASH", note: MARK });
      const sonra = await durum(saleId);
      check("Kalan borcu 0 olan satisa odeme -> 400", r.status === 400, `gelen ${r.status}`);
      check("  ...defter kaydi eklenmedi", sonra.odemeler.length === once.odemeler.length,
        `${once.odemeler.length} -> ${sonra.odemeler.length}`);
      check("  ...sifir tutarli cop kayit olusmadi", !sonra.odemeler.some((o) => n(o.amount) === 0), "0 TL kayit var");
    }

    // ── TEST 5 — Çift tıklama (aynı istek arka arkaya) ────────────────────
    console.log("\nTEST 5 — Cift tiklama: ayni istek arka arkaya");
    {
      const { saleId, customerId } = await veresiyeSatis(400, 0, barber.id, service.name);
      const govde = { saleId, customerId, amount: 400, paymentMethod: "CASH", note: MARK };
      const r1 = await post("/api/debts/payment", govde);
      const r2 = await post("/api/debts/payment", govde);
      const s = await durum(saleId);
      check("Ilk istek -> 201", r1.status === 201, `gelen ${r1.status}`);
      check("Ikinci (mukerrer) istek reddedildi", r2.status >= 400, `gelen ${r2.status}`);
      check("  ...paidAmount 400 (iki kez yazilmadi)", n(s.sale?.paidAmount) === 400, `gelen ${s.sale?.paidAmount}`);
      check("  ...defter == paidAmount", Math.abs(s.defter - 400) < 0.01, `defter ${s.defter}`);
      const gercekOdemeler = s.odemeler.filter((o) => n(o.amount) !== 0);
      check("  ...defterde tek tahsilat kaydi var", gercekOdemeler.length === 1,
        `${gercekOdemeler.length} kayit: ${s.odemeler.map((o) => o.amount).join(", ")}`);
    }

    // ── TEST 6 — Eşzamanlı istekler (yarış koşulu) ────────────────────────
    console.log("\nTEST 6 — Eszamanli 5 ayni odeme istegi (yaris kosulu)");
    {
      const { saleId, customerId } = await veresiyeSatis(600, 0, barber.id, service.name);
      const govde = { saleId, customerId, amount: 600, paymentMethod: "CASH", note: MARK };
      const sonuclar = await Promise.all(Array.from({ length: 5 }, () => post("/api/debts/payment", govde)));
      const basarili = sonuclar.filter((r) => r.status === 201).length;
      const s = await durum(saleId);
      console.log(`      sonuclar: ${sonuclar.map((r) => r.status).join(", ")}`);
      console.log(`      defter: ${s.odemeler.map((o) => o.amount).join(", ")} | paidAmount ${s.sale?.paidAmount}`);
      check("Yalnizca 1 istek basarili", basarili === 1, `${basarili} istek 201 dondu`);
      check("  ...paidAmount = 600 (asilmadi)", n(s.sale?.paidAmount) === 600, `gelen ${s.sale?.paidAmount}`);
      check("  ...remainingAmount = 0", n(s.sale?.remainingAmount) === 0, `gelen ${s.sale?.remainingAmount}`);
      check("  ...DEFTER == paidAmount (yaris yok)", Math.abs(s.defter - 600) < 0.01,
        `defter ${s.defter} != 600 — eszamanli istekler cift yazmis`);
    }

    // ── TEST 7 — Eşzamanlı KISMİ ödemeler toplamı borcu aşmamalı ─────────
    console.log("\nTEST 7 — Eszamanli kismi odemeler borcu asmamali");
    {
      const { saleId, customerId } = await veresiyeSatis(300, 0, barber.id, service.name);
      // Her biri 200; ikisi birden gecerse 400 olur ve borc asilir.
      const istekler = [
        post("/api/debts/payment", { saleId, customerId, amount: 200, paymentMethod: "CASH", note: MARK }),
        post("/api/debts/payment", { saleId, customerId, amount: 200, paymentMethod: "CARD", note: MARK }),
      ];
      const sonuclar = await Promise.all(istekler);
      const s = await durum(saleId);
      console.log(`      sonuclar: ${sonuclar.map((r) => r.status).join(", ")} | paidAmount ${s.sale?.paidAmount}`);
      check("paidAmount satis tutarini asmadi", n(s.sale?.paidAmount) <= 300, `gelen ${s.sale?.paidAmount}`);
      check("  ...defter == paidAmount", Math.abs(s.defter - n(s.sale?.paidAmount)) < 0.01,
        `defter ${s.defter} != ${s.sale?.paidAmount}`);
      check("  ...en az bir istek reddedildi", sonuclar.some((r) => r.status >= 400),
        `sonuclar ${sonuclar.map((r) => r.status).join(", ")}`);
    }

    // ── TEST 8 — VOID ters kayıt mekanizması bozulmadı ────────────────────
    console.log("\nTEST 8 — VOID ters kayit mekanizmasi bozulmadi (Sira 5)");
    {
      const { saleId, customerId } = await veresiyeSatis(500, 200, barber.id, service.name);
      await post("/api/debts/payment", { saleId, customerId, amount: 300, paymentMethod: "CARD", note: MARK });
      const oncesi = await durum(saleId);
      check("Odeme sonrasi paidAmount = 500", n(oncesi.sale?.paidAmount) === 500, `gelen ${oncesi.sale?.paidAmount}`);

      const v = await post(`/api/cash/${saleId}/void`, { voidReason: MARK });
      const sonrasi = await durum(saleId);
      check("Void -> 200", v.status === 200, `gelen ${v.status}`);
      check("  ...ters kayit yazildi (negatif)", sonrasi.odemeler.some((o) => n(o.amount) < 0), "ters kayit yok");
      check("  ...defter neti 0", Math.abs(sonrasi.defter) < 0.01, `net ${sonrasi.defter}`);
      const vr = await post("/api/debts/payment", { saleId, customerId, amount: 100, paymentMethod: "CASH", note: MARK });
      check("  ...VOID satisa odeme -> 400", vr.status === 400, `gelen ${vr.status}`);
    }

    // ── TEST 9 — Tahsilat günü mantığı bozulmadı ─────────────────────────
    console.log("\nTEST 9 — Tahsilat gunu mantigi bozulmadi (Sira 3)");
    {
      const ozet = await get(`/api/cash/summary?date=${BUGUN}`);
      check("cash/summary calisiyor", typeof ozet.collected === "number", `gelen ${JSON.stringify(ozet).slice(0, 80)}`);
      const tumOdemeler = await db.customerPayment.findMany({
        where: { note: MARK },
        select: { paymentDate: true },
      });
      check("Test odemeleri bugune yazildi",
        tumOdemeler.every((o) => istanbulDateString(o.paymentDate) === BUGUN),
        "farkli gune yazilan kayit var");
    }

    // ── TEST 10 — Geçersiz girdi ─────────────────────────────────────────
    console.log("\nTEST 10 — Gecersiz girdi");
    {
      const { saleId, customerId } = await veresiyeSatis(200, 0, barber.id, service.name);
      const negatif = await post("/api/debts/payment", { saleId, customerId, amount: -50, note: MARK });
      check("Negatif tutar -> 400", negatif.status === 400, `gelen ${negatif.status}`);
      const sifir = await post("/api/debts/payment", { saleId, customerId, amount: 0, note: MARK });
      check("Sifir tutar -> 400", sifir.status === 400, `gelen ${sifir.status}`);
      const yok = await post("/api/debts/payment", { saleId: "yok-boyle-satis", amount: 50, note: MARK });
      check("Var olmayan satis -> 404", yok.status === 404, `gelen ${yok.status}`);
      const s = await durum(saleId);
      check("  ...gecersiz istekler defteri bozmadi", Math.abs(s.defter - n(s.sale?.paidAmount)) < 0.01,
        `defter ${s.defter} != ${s.sale?.paidAmount}`);
    }

    // ── TEST 11 — Gerçek veri bozulmadı ──────────────────────────────────
    console.log("\nTEST 11 — Gercek veri bozulmadi");
    check("Test disi satis sayisi degismedi",
      (await db.sale.count({ where: { note: { not: MARK } } })) === satisOnce, `once ${satisOnce}`);
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

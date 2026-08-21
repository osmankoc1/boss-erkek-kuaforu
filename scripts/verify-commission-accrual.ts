/**
 * Hakediş (komisyon) davranışı — MEVCUT DURUM KANITI (FAZ 2 · Sıra 8).
 *
 * Çalıştırma (dev server ayakta olmalı):
 *   npx dotenv -e .env.local -- tsx scripts/verify-commission-accrual.ts
 *
 * ÜRÜN KARARI (bu testin dayandığı kural):
 *   • Hakediş, gerçekleşen satış üzerinden TAHAKKUK eder.
 *   • Tahsilat tamamlanmasa da hizmet yapıldıysa hakediş doğar.
 *   • "Tahakkuk eden hakediş" ile "berbere ödenen hakediş" AYRI kavramlardır.
 *
 * Bu test mevcut sistemi bu kurala göre ölçer. Bazı kontrollerin başarısız
 * olması BEKLENİR — kanıt üretmek için yazıldı.
 *
 * UYARI: Dev veritabanına test verisi yazar ve sonunda siler.
 */
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { assertWritableTestDatabase } from "../lib/db-guard";
import { SignJWT } from "jose";
import { istanbulDateString, addIstanbulDays } from "../lib/tz";

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

const MARK = "ZZHAKTEST";
const PHONE_PREFIX = "0555999080";
const BUGUN = istanbulDateString();
const KOMISYON_ORANI = 40; // %40

let cookie = "";
const get = (u: string) =>
  fetch(`${BASE}${u}`, { headers: { Cookie: cookie }, cache: "no-store" }).then((r) => r.json());
const post = (u: string, body: unknown) =>
  fetch(`${BASE}${u}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }));

let testBarberId = "";

async function cleanup() {
  const custs = (await db.customer.findMany({ select: { id: true, fullName: true, phone: true } })).filter(
    (c) => c.fullName.startsWith(MARK) || c.phone.startsWith(PHONE_PREFIX) || c.phone.includes(`_${PHONE_PREFIX}`)
  );
  const ids = custs.map((c) => c.id);
  const barbers = await db.barber.findMany({ where: { name: { startsWith: MARK } }, select: { id: true } });
  const barberIds = barbers.map((b) => b.id);
  const saleIds = (
    await db.sale.findMany({
      where: { OR: [{ customerId: { in: ids } }, { note: MARK }, { barberId: { in: barberIds } }] },
      select: { id: true },
    })
  ).map((s) => s.id);
  const n = { odeme: 0, satis: 0, randevu: 0, musteri: 0, berber: 0 };
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
  if (barberIds.length) {
    await db.appointment.deleteMany({ where: { barberId: { in: barberIds } } });
    await db.workingHour.deleteMany({ where: { barberId: { in: barberIds } } });
    n.berber = (await db.barber.deleteMany({ where: { id: { in: barberIds } } })).count;
  }
  return n;
}

let sira = 0;
async function musteri(ad: string) {
  sira += 1;
  return db.customer.create({ data: { fullName: `${MARK} ${ad}`, phone: `${PHONE_PREFIX}${sira}` } });
}

/** Hakediş API'sinden bu test berberinin satırını çeker. */
async function hakedis(gun = BUGUN) {
  const r = await get(`/api/commissions?range=custom&from=${gun}&to=${gun}`);
  const satir = (r.commissions ?? []).find((c: { barberId: string }) => c.barberId === testBarberId);
  return { satir, totals: r.totals };
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

  const service = await db.service.findFirst({ select: { id: true, name: true } });
  if (!service) throw new Error("Hizmet yok.");

  // Komisyonlu test berberi — gerçek berbere dokunmamak için ayrı kayıt.
  const barber = await db.barber.create({
    data: { name: `${MARK} Kalfa`, workerType: "COMMISSION", commissionRate: KOMISYON_ORANI, isActive: true },
  });
  testBarberId = barber.id;
  console.log(`  test berberi: ${barber.name} | COMMISSION %${KOMISYON_ORANI}\n`);

  const satisOnce = await db.sale.count();

  try {
    // ── TEST 1 — Hakediş hangi kaynaktan hesaplanıyor ─────────────────────
    console.log("TEST 1 — Hakedis kaynagi: satis mi, tahsilat mi");
    {
      const c = await musteri("Tam");
      const r = await post("/api/cash", {
        customerId: c.id, barberId: barber.id,
        customerName: c.fullName, customerPhone: c.phone,
        serviceName: service.name, serviceId: service.id,
        listedPrice: 1000, saleAmount: 1000, paidAmount: 1000,
        paymentMethod: "CASH", note: MARK,
      });
      check("Satis olusturuldu", r.status === 201, `gelen ${r.status}`);
      const sale = await db.sale.findFirst({ where: { customerId: c.id }, select: { barberShare: true, businessShare: true, barberCommissionRate: true } });
      console.log(`      satis 1000 TL | barberShare=${sale?.barberShare} businessShare=${sale?.businessShare} oran=%${sale?.barberCommissionRate}`);
      check("Hakedis satis tutari uzerinden (1000 * %40 = 400)", sale?.barberShare === 400, `gelen ${sale?.barberShare}`);
      check("Oran satis aninda snapshot'landi", sale?.barberCommissionRate === KOMISYON_ORANI, `gelen ${sale?.barberCommissionRate}`);
      const h = await hakedis();
      check("Hakedis API'si 400 raporluyor", h.satir?.barberShare === 400, `gelen ${h.satir?.barberShare}`);
    }

    // ── TEST 2 — Veresiye satışta hakediş (TAHAKKUK kuralı) ──────────────
    console.log("\nTEST 2 — Veresiye satista hakedis TAHAKKUK etmeli");
    {
      const c = await musteri("Veresiye");
      await post("/api/cash", {
        customerId: c.id, barberId: barber.id,
        customerName: c.fullName, customerPhone: c.phone,
        serviceName: service.name, serviceId: service.id,
        listedPrice: 500, saleAmount: 500, paidAmount: 0,
        paymentMethod: "CASH", note: MARK,
      });
      const sale = await db.sale.findFirst({ where: { customerId: c.id }, select: { barberShare: true, saleStatus: true, paidAmount: true } });
      console.log(`      satis 500 TL, tahsilat 0 | durum=${sale?.saleStatus} barberShare=${sale?.barberShare}`);
      check("Tahsilat 0 olsa da hakedis dogdu (500 * %40 = 200)", sale?.barberShare === 200, `gelen ${sale?.barberShare}`);
      const h = await hakedis();
      check("Toplam tahakkuk 600 (400 + 200)", h.satir?.barberShare === 600, `gelen ${h.satir?.barberShare}`);
      check("Veresiyeli satis ayrica raporlaniyor", (h.satir?.creditSale ?? 0) === 500, `gelen ${h.satir?.creditSale}`);
    }

    // ── TEST 3 — Walk-in satışta hakediş ─────────────────────────────────
    console.log("\nTEST 3 — Walk-in (randevusuz) satista hakedis");
    {
      const c = await musteri("WalkIn");
      await post("/api/cash", {
        customerId: c.id, barberId: barber.id,
        customerName: c.fullName, customerPhone: c.phone,
        serviceName: service.name, serviceId: service.id,
        listedPrice: 300, saleAmount: 300, paidAmount: 300,
        paymentMethod: "CARD", note: MARK,
      });
      const sale = await db.sale.findFirst({ where: { customerId: c.id }, select: { barberShare: true, appointmentId: true } });
      check("Walk-in satista da hakedis dogdu (300 * %40 = 120)", sale?.barberShare === 120, `gelen ${sale?.barberShare}`);
      check("  ...randevusuz oldugu dogrulandi", sale?.appointmentId === null, `appointmentId=${sale?.appointmentId}`);
      const h = await hakedis();
      check("Toplam tahakkuk 720 (400+200+120)", h.satir?.barberShare === 720, `gelen ${h.satir?.barberShare}`);
    }

    // ── TEST 4 — VOID satış hakedişi geri alıyor mu ──────────────────────
    console.log("\nTEST 4 — VOID satis hakedisi geri almali");
    {
      const c = await musteri("Void");
      const r = await post("/api/cash", {
        customerId: c.id, barberId: barber.id,
        customerName: c.fullName, customerPhone: c.phone,
        serviceName: service.name, serviceId: service.id,
        listedPrice: 900, saleAmount: 900, paidAmount: 900,
        paymentMethod: "CASH", note: MARK,
      });
      const saleId = (r.body as { sale?: { id: string } }).sale?.id ?? "";
      const oncesi = await hakedis();
      console.log(`      void oncesi tahakkuk: ${oncesi.satir?.barberShare}`);
      check("Void oncesi tahakkuk 1080 (720 + 360)", oncesi.satir?.barberShare === 1080, `gelen ${oncesi.satir?.barberShare}`);

      await post(`/api/cash/${saleId}/void`, { voidReason: MARK });
      const sonrasi = await hakedis();
      console.log(`      void sonrasi tahakkuk: ${sonrasi.satir?.barberShare}`);
      check("VOID sonrasi tahakkuk 720'ye dondu", sonrasi.satir?.barberShare === 720, `gelen ${sonrasi.satir?.barberShare}`);
    }

    // ── TEST 5 — Aynı satış iki kez hakedişe girebilir mi ────────────────
    console.log("\nTEST 5 — Ayni satis iki kez hakedise girmemeli");
    {
      const h1 = await hakedis();
      const h2 = await hakedis();
      check("Ayni donem iki kez sorgulaninca ayni sonuc", h1.satir?.barberShare === h2.satir?.barberShare,
        `${h1.satir?.barberShare} vs ${h2.satir?.barberShare}`);
      const aktifSatislar = await db.sale.findMany({
        where: { barberId: barber.id, saleStatus: { not: "VOIDED" } },
        select: { id: true, barberShare: true },
      });
      const elleToplam = aktifSatislar.reduce((s, x) => s + x.barberShare, 0);
      check("Rapor toplami satislarin toplamiyla birebir", h1.satir?.barberShare === elleToplam,
        `rapor ${h1.satir?.barberShare} != satislar ${elleToplam}`);
      console.log(`      ${aktifSatislar.length} aktif satis, toplam hakedis ${elleToplam}`);
    }

    // ── TEST 6 — Berbere ödeme kaydı var mı ──────────────────────────────
    console.log("\nTEST 6 — Berbere ODENEN hakedis ayri kayitta izleniyor mu");
    {
      const modelVar = Object.keys(db).some((k) => /payout|hakedis|commissionPayment/i.test(k));
      check("Hakedis odeme defteri modeli var", modelVar,
        "Prisma semasinda berbere odeme kaydeden hicbir model yok");

      const h = await hakedis();
      const alanlar = Object.keys(h.satir ?? {});
      console.log(`      hakedis API alanlari: ${alanlar.join(", ")}`);
      check("Hakedis raporunda 'odenen' alani var", alanlar.some((a) => /paid|odenen|payout/i.test(a)),
        `alanlar: ${alanlar.join(", ")}`);
      check("Hakedis raporunda 'kalan' alani var", alanlar.some((a) => /remaining|kalan|balance/i.test(a)),
        `alanlar: ${alanlar.join(", ")}`);
    }

    // ── TEST 7 — Tahakkuk / ödenen ayrımı ────────────────────────────────
    console.log("\nTEST 7 — 'Tahakkuk' ile 'odenen' birbirine karismiyor mu");
    {
      const { readFileSync } = await import("node:fs");
      const ekran = readFileSync("app/(admin)/admin/(protected)/hakedisler/page.tsx", "utf8");
      check("Ekranda 'Odenen Hakedis' basligi var", /Ödenen|Odenen/.test(ekran), "yalnizca tahakkuk gosteriliyor");
      check("Ekranda 'Kalan Hakedis' basligi var", /Kalan Hakediş|Kalan Hakedis/.test(ekran), "kalan gosterilmiyor");
      const belirsiz = /"Toplam Hakediş"/.test(ekran);
      check("'Toplam Hakedis' etiketi tahakkuk/odenen belirsizligi yaratmiyor", !belirsiz,
        "etiket hangisini gosterdigini soylemiyor");
    }

    // ── TEST 8 — Gerçek veri bozulmadı ───────────────────────────────────
    console.log("\nTEST 8 — Gercek veri bozulmadi");
    check("Test disi satis sayisi degismedi",
      (await db.sale.count({ where: { note: { not: MARK } } })) === satisOnce, `once ${satisOnce}`);
  } finally {
    console.log("\nTEMIZLIK...");
    const n = await cleanup();
    console.log(`  silinen: odeme=${n.odeme} satis=${n.satis} randevu=${n.randevu} musteri=${n.musteri} berber=${n.berber}`);
    console.log(`  DB: ${await db.sale.count()} satis, ${await db.barber.count()} berber, ${await db.customer.count()} musteri`);
  }

  console.log("\n" + "=".repeat(66));
  console.log(`TOPLAM: ${passed + failed}   GECEN: ${passed}   KALAN: ${failed}`);
  if (failed > 0) {
    console.log("\nBASARISIZ (mevcut durumun kaniti):");
    for (const f of failures) console.log("  - " + f);
  }
  console.log("=".repeat(66));
}

main()
  .then(() => db.$disconnect().then(() => process.exit(0)))
  .catch(async (e) => {
    console.error("HATA:", e);
    await db.$disconnect();
    process.exit(1);
  });

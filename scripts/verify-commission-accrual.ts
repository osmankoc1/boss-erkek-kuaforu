/**
 * Hakediş: tahakkuk / ödenen / kalan (FAZ 2 · Sıra 8).
 *
 * Çalıştırma (dev server ayakta olmalı):
 *   npx dotenv -e .env.local -- tsx scripts/verify-commission-accrual.ts
 *
 * ─── SINANAN ÜRÜN KURALI ─────────────────────────────────────────────────
 *   Tahakkuk = VOID olmayan satışlardaki Sale.barberShare (tahsilattan bağımsız)
 *   Ödenen   = BarberPayout kayıtları
 *   Kalan    = Tahakkuk − Ödenen
 *
 *   • Veresiye satışta da hakediş doğar (iş yapıldı).
 *   • Walk-in ve randevulu satış aynı kurala tabidir.
 *   • VOID satış tahakkuktan düşer.
 *   • Kalandan fazla ödeme reddedilir; kalan negatife düşmez.
 *   • Ödeme defteri yalnızca COMMISSION içindir (OWNER/FIXED_SALARY reddedilir).
 *   • Dönem zorunludur ve periodStart <= periodEnd olmalıdır.
 *   • payoutDate daima sunucu tarafından atanır; istemciden alınmaz.
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
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));


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

type Yanit = { status: number; body: Record<string, unknown> };

let cookie = "";
const get = (u: string) =>
  fetch(`${BASE}${u}`, { headers: { Cookie: cookie }, cache: "no-store" }).then((r) => r.json());
const post = (u: string, body: unknown): Promise<Yanit> =>
  fetch(`${BASE}${u}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }));

let testBarberId = "";
let ownerBarberId = "";
let maasliBarberId = "";

async function cleanup() {
  const custs = (await db.customer.findMany({ select: { id: true, fullName: true, phone: true } })).filter(
    (c) => c.fullName.startsWith(MARK) || c.phone.startsWith(PHONE_PREFIX) || c.phone.includes(`_${PHONE_PREFIX}`)
  );
  const ids = custs.map((c) => c.id);
  const barbers = await db.barber.findMany({ where: { name: { startsWith: MARK } }, select: { id: true } });
  const barberIds = barbers.map((b) => b.id);
  const saleIds = (
    await db.sale.findMany({
      where: { OR: [{ customerId: { in: ids } }, { note: { startsWith: MARK } }, { barberId: { in: barberIds } }] },
      select: { id: true },
    })
  ).map((s) => s.id);
  const n = { hakedis: 0, odeme: 0, satis: 0, randevu: 0, musteri: 0, berber: 0 };
  if (barberIds.length) {
    n.hakedis = (await db.barberPayout.deleteMany({ where: { barberId: { in: barberIds } } })).count;
  }
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

type HakedisSatir = {
  barberId: string; accrued: number; barberShare: number; paid: number;
  periodRemaining: number; totalAccrued: number; totalPaid: number; totalRemaining: number;
  creditSale: number; eligible: boolean;
};

/** Hakediş API'sinden bir berberin satırını çeker (bugünün aralığı). */
async function hakedis(barberId = testBarberId, gun = BUGUN) {
  const r = await get(`/api/commissions?range=custom&from=${gun}&to=${gun}`);
  const satir = (r.commissions ?? []).find((c: HakedisSatir) => c.barberId === barberId) as HakedisSatir | undefined;
  return { satir, totals: r.totals, payouts: (r.payouts ?? []) as { barberId: string }[] };
}

/** Geçerli bir hakediş ödemesi gövdesi. */
function odeme(barberId: string, amount: number, extra: Record<string, unknown> = {}) {
  return { barberId, amount, paymentMethod: "CASH", periodStart: BUGUN, periodEnd: BUGUN, note: MARK, ...extra };
}

async function satisYap(
  c: { id: string; fullName: string; phone: string },
  barberId: string,
  service: { id: string; name: string },
  saleAmount: number,
  paidAmount: number,
  method = "CASH"
) {
  return post("/api/cash", {
    customerId: c.id,
    barberId,
    customerName: c.fullName,
    customerPhone: c.phone,
    serviceName: service.name,
    serviceId: service.id,
    listedPrice: saleAmount,
    saleAmount,
    paidAmount,
    paymentMethod: method,
    note: MARK,
  });
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

  // Test berberleri — gerçek berberlere dokunmamak için ayrı kayıtlar.
  const barber = await db.barber.create({
    data: { name: `${MARK} Kalfa`, workerType: "COMMISSION", commissionRate: KOMISYON_ORANI, isActive: true },
  });
  testBarberId = barber.id;
  ownerBarberId = (await db.barber.create({ data: { name: `${MARK} Patron`, workerType: "OWNER", isActive: true } })).id;
  maasliBarberId = (await db.barber.create({ data: { name: `${MARK} Maasli`, workerType: "FIXED_SALARY", isActive: true } })).id;
  console.log(`  test berberleri: COMMISSION %${KOMISYON_ORANI} + OWNER + FIXED_SALARY\n`);

  const satisOnce = await db.sale.count();
  let walkInSaleId = "";

  try {
    // ── TEST 1 — Hakediş hangi kaynaktan hesaplanıyor ─────────────────────
    console.log("TEST 1 — Hakedis kaynagi: satis mi, tahsilat mi");
    {
      const c = await musteri("Tam");
      const r = await satisYap(c, barber.id, service, 1000, 1000);
      check("Satis olusturuldu", r.status === 201, `gelen ${r.status}`);
      const sale = await db.sale.findFirst({
        where: { customerId: c.id },
        select: { barberShare: true, businessShare: true, barberCommissionRate: true },
      });
      console.log(`      satis 1000 TL | barberShare=${sale?.barberShare} businessShare=${sale?.businessShare} oran=%${sale?.barberCommissionRate}`);
      check("Hakedis satis tutari uzerinden (1000 * %40 = 400)", num(sale?.barberShare) === 400, `gelen ${sale?.barberShare}`);
      check("Oran satis aninda snapshot'landi", num(sale?.barberCommissionRate) === KOMISYON_ORANI, `gelen ${sale?.barberCommissionRate}`);
      const h = await hakedis();
      check("Rapor tahakkuku 400 gosteriyor", h.satir?.accrued === 400, `gelen ${h.satir?.accrued}`);
    }

    // ── TEST 2 — Veresiye satışta hakediş (TAHAKKUK kuralı) ──────────────
    console.log("\nTEST 2 — Veresiye satista hakedis TAHAKKUK etmeli");
    {
      const c = await musteri("Veresiye");
      await satisYap(c, barber.id, service, 500, 0);
      const sale = await db.sale.findFirst({
        where: { customerId: c.id },
        select: { barberShare: true, saleStatus: true, paidAmount: true },
      });
      console.log(`      satis 500 TL, tahsilat 0 | durum=${sale?.saleStatus} barberShare=${sale?.barberShare}`);
      check("Tahsilat 0 olsa da hakedis dogdu (500 * %40 = 200)", num(sale?.barberShare) === 200, `gelen ${sale?.barberShare}`);
      check("  ...satis gercekten veresiye", num(sale?.paidAmount) === 0 && sale?.saleStatus === "CREDIT", `${sale?.saleStatus}/${sale?.paidAmount}`);
      const h = await hakedis();
      check("Toplam tahakkuk 600 (400 + 200)", h.satir?.accrued === 600, `gelen ${h.satir?.accrued}`);
      check("Veresiyeli satis ayrica raporlaniyor", (h.satir?.creditSale ?? 0) === 500, `gelen ${h.satir?.creditSale}`);
    }

    // ── TEST 3 — Walk-in satışta hakediş ─────────────────────────────────
    console.log("\nTEST 3 — Walk-in (randevusuz) satista hakedis");
    {
      const c = await musteri("WalkIn");
      const r = await satisYap(c, barber.id, service, 300, 300, "CARD");
      walkInSaleId = (r.body as { sale?: { id: string } }).sale?.id ?? "";
      const sale = await db.sale.findFirst({ where: { customerId: c.id }, select: { barberShare: true, appointmentId: true } });
      check("Walk-in satista da hakedis dogdu (300 * %40 = 120)", num(sale?.barberShare) === 120, `gelen ${sale?.barberShare}`);
      check("  ...randevusuz oldugu dogrulandi", sale?.appointmentId === null, `appointmentId=${sale?.appointmentId}`);
      const h = await hakedis();
      check("Toplam tahakkuk 720 (400+200+120)", h.satir?.accrued === 720, `gelen ${h.satir?.accrued}`);
    }

    // ── TEST 4 — VOID satış tahakkuktan düşmeli ──────────────────────────
    console.log("\nTEST 4 — VOID satis tahakkuktan dusmeli");
    {
      const c = await musteri("Void");
      const r = await satisYap(c, barber.id, service, 900, 900);
      const saleId = (r.body as { sale?: { id: string } }).sale?.id ?? "";
      const oncesi = await hakedis();
      check("Void oncesi tahakkuk 1080 (720 + 360)", oncesi.satir?.accrued === 1080, `gelen ${oncesi.satir?.accrued}`);

      await post(`/api/cash/${saleId}/void`, { voidReason: MARK });
      const sonrasi = await hakedis();
      console.log(`      void oncesi ${oncesi.satir?.accrued} -> sonrasi ${sonrasi.satir?.accrued}`);
      check("VOID sonrasi tahakkuk 720'ye dondu", sonrasi.satir?.accrued === 720, `gelen ${sonrasi.satir?.accrued}`);
      check(
        "  ...geri alma icin ayri kayit gerekmedi (turetiliyor)",
        (await db.barberPayout.count({ where: { barberId: barber.id } })) === 0,
        "beklenmedik payout kaydi"
      );
    }

    // ── TEST 5 — Aynı satış iki kez hakedişe girmemeli ───────────────────
    console.log("\nTEST 5 — Ayni satis iki kez hakedise girmemeli");
    {
      const h1 = await hakedis();
      const h2 = await hakedis();
      check("Ayni donem iki kez sorgulaninca ayni sonuc", h1.satir?.accrued === h2.satir?.accrued,
        `${h1.satir?.accrued} vs ${h2.satir?.accrued}`);
      const aktif = await db.sale.findMany({
        where: { barberId: barber.id, saleStatus: { not: "VOIDED" } },
        select: { id: true, barberShare: true },
      });
      const elleToplam = Math.round(aktif.reduce((s, x) => s + num(x.barberShare), 0) * 100) / 100;
      check("Rapor toplami satislarin toplamiyla birebir", h1.satir?.accrued === elleToplam,
        `rapor ${h1.satir?.accrued} != satislar ${elleToplam}`);
      console.log(`      ${aktif.length} aktif satis, toplam tahakkuk ${elleToplam}`);
    }

    // ── TEST 6 — Ödeme defteri ve rapor alanları ─────────────────────────
    console.log("\nTEST 6 — Odeme defteri ve rapor alanlari");
    {
      check("Hakedis odeme defteri modeli var", typeof db.barberPayout?.findMany === "function",
        "Prisma semasinda BarberPayout yok");
      const h = await hakedis();
      const alanlar = Object.keys(h.satir ?? {});
      console.log(`      rapor alanlari: ${alanlar.join(", ")}`);
      check("Raporda 'tahakkuk' alani var", alanlar.includes("accrued"), alanlar.join(", "));
      check("Raporda 'odenen' alani var", alanlar.includes("paid"), alanlar.join(", "));
      check("Raporda 'kalan' alani var", alanlar.includes("totalRemaining"), alanlar.join(", "));
      check("Odeme yokken kalan == tahakkuk", h.satir?.totalRemaining === 720 && h.satir?.totalPaid === 0,
        `kalan=${h.satir?.totalRemaining} odenen=${h.satir?.totalPaid}`);
      check("COMMISSION berber odemeye uygun isaretli", h.satir?.eligible === true, `eligible=${h.satir?.eligible}`);
    }

    // ── TEST 7 — Dönem doğrulaması ───────────────────────────────────────
    console.log("\nTEST 7 — Donem dogrulamasi (zorunlu, baslangic <= bitis)");
    {
      const yok = await post("/api/payouts", { barberId: barber.id, amount: 10, paymentMethod: "CASH" });
      check("Donem verilmeden odeme -> 400", yok.status === 400, `gelen ${yok.status}`);

      const eksikBitis = await post("/api/payouts", { barberId: barber.id, amount: 10, periodStart: BUGUN });
      check("Yalniz baslangic verilince -> 400", eksikBitis.status === 400, `gelen ${eksikBitis.status}`);

      const ters = await post("/api/payouts", odeme(barber.id, 10, { periodStart: "2026-08-20", periodEnd: "2026-08-10" }));
      check("periodStart > periodEnd -> 400", ters.status === 400, `gelen ${ters.status}`);
      check("  ...gerekce INVALID_PERIOD", ters.body.code === "INVALID_PERIOD", `${ters.body.code}`);

      const bozuk = await post("/api/payouts", odeme(barber.id, 10, { periodStart: "20-08-2026", periodEnd: BUGUN }));
      check("Bozuk tarih bicimi -> 400", bozuk.status === 400, `gelen ${bozuk.status}`);

      const esit = await post("/api/payouts", odeme(barber.id, 1, { periodStart: BUGUN, periodEnd: BUGUN }));
      check("periodStart == periodEnd kabul edilir -> 201", esit.status === 201, `gelen ${esit.status}`);

      const gecmis = await post("/api/payouts", odeme(barber.id, 1, { periodStart: "2026-08-01", periodEnd: "2026-08-07" }));
      check("Gecmis doneme odeme yapilabilir -> 201", gecmis.status === 201, `gelen ${gecmis.status}`);

      const kayit = await db.barberPayout.findFirst({
        where: { barberId: barber.id, periodStart: { lt: new Date("2026-08-10") } },
        select: { periodStart: true, periodEnd: true, payoutDate: true },
      });
      check("  ...gecmis donem kaydedildi ama odeme tarihi BUGUN",
        !!kayit && Date.now() - kayit.payoutDate.getTime() < 120_000,
        `payoutDate=${kayit?.payoutDate.toISOString()}`);
      // Buraya kadar odenen: 2 TL
    }

    // ── TEST 8 — OWNER / FIXED_SALARY ödeme alamaz ───────────────────────
    console.log("\nTEST 8 — OWNER ve FIXED_SALARY hakedis odemesi alamaz");
    {
      const o = await post("/api/payouts", odeme(ownerBarberId, 100));
      check("OWNER'a hakedis odemesi -> 400", o.status === 400, `gelen ${o.status}`);
      check("  ...gerekce WORKER_TYPE_NOT_ELIGIBLE", o.body.code === "WORKER_TYPE_NOT_ELIGIBLE", `${o.body.code}`);

      const m = await post("/api/payouts", odeme(maasliBarberId, 100));
      check("FIXED_SALARY'ye hakedis odemesi -> 400", m.status === 400, `gelen ${m.status}`);
      check("  ...gerekce WORKER_TYPE_NOT_ELIGIBLE", m.body.code === "WORKER_TYPE_NOT_ELIGIBLE", `${m.body.code}`);

      const sayi = await db.barberPayout.count({ where: { barberId: { in: [ownerBarberId, maasliBarberId] } } });
      check("  ...hicbir kayit yazilmadi", sayi === 0, `${sayi} kayit olusmus`);

      const yok = await post("/api/payouts", odeme("olmayan-berber-id", 100));
      check("Var olmayan calisan -> 404", yok.status === 404, `gelen ${yok.status}`);
    }

    // ── TEST 9 — Kısmi hakediş ödemesi + payoutDate koruması ─────────────
    console.log("\nTEST 9 — Kismi hakedis odemesi");
    {
      const oncesi = await hakedis();
      const r = await post("/api/payouts", odeme(barber.id, 98, { payoutDate: "2020-01-01T00:00:00.000Z" }));
      check("Kismi odeme kaydedildi -> 201", r.status === 201, `gelen ${r.status}`);

      const h = await hakedis();
      console.log(`      tahakkuk=${h.satir?.totalAccrued} odenen=${h.satir?.totalPaid} kalan=${h.satir?.totalRemaining}`);
      check("Tahakkuk odemeden ETKILENMEDI", h.satir?.totalAccrued === oncesi.satir?.totalAccrued,
        `${oncesi.satir?.totalAccrued} -> ${h.satir?.totalAccrued}`);
      check("Odenen 100'e cikti (1+1+98)", h.satir?.totalPaid === 100, `gelen ${h.satir?.totalPaid}`);
      check("Kalan 620 (720 - 100)", h.satir?.totalRemaining === 620, `gelen ${h.satir?.totalRemaining}`);

      const kayit = await db.barberPayout.findFirst({ where: { barberId: barber.id, amount: 98 }, select: { payoutDate: true } });
      check("Istemciden gelen payoutDate YOK SAYILDI (sunucu tarihi kullanildi)",
        !!kayit && kayit.payoutDate.getFullYear() > 2020, `payoutDate=${kayit?.payoutDate.toISOString()}`);

      const kendi = h.payouts.filter((p) => p.barberId === barber.id).length;
      check("Odeme gecmisi raporda gorunuyor", kendi === 3, `${kendi} kayit`);
    }

    // ── TEST 10 — Fazla ödeme reddedilir ─────────────────────────────────
    console.log("\nTEST 10 — Kalandan fazla odeme reddedilmeli");
    {
      const r = await post("/api/payouts", odeme(barber.id, 700)); // kalan 620
      check("Kalandan fazla odeme -> 400", r.status === 400, `gelen ${r.status}`);
      check("  ...gerekce EXCEEDS_REMAINING_PAYOUT", r.body.code === "EXCEEDS_REMAINING_PAYOUT", `${r.body.code}`);
      check("  ...kalan tutar mesajda bildirildi", r.body.remaining === 620, `${r.body.remaining}`);

      const h = await hakedis();
      check("  ...reddedilen istek hicbir sey yazmadi", h.satir?.totalPaid === 100, `odenen ${h.satir?.totalPaid}`);

      const sifir = await post("/api/payouts", odeme(barber.id, 0));
      check("Sifir tutarli odeme -> 400", sifir.status === 400, `gelen ${sifir.status}`);
      const negatif = await post("/api/payouts", odeme(barber.id, -50));
      check("Negatif tutarli odeme -> 400", negatif.status === 400, `gelen ${negatif.status}`);
      const h2 = await hakedis();
      check("  ...sifir/negatif istekler kalani degistirmedi", h2.satir?.totalPaid === 100, `odenen ${h2.satir?.totalPaid}`);
    }

    // ── TEST 11 — Çift tıklama ───────────────────────────────────────────
    console.log("\nTEST 11 — Cift tiklama (ayni istek 5 kez es zamanli)");
    {
      const oncesi = await hakedis();
      const sonuclar = await Promise.all(Array.from({ length: 5 }, () => post("/api/payouts", odeme(barber.id, 50))));
      const olusan = sonuclar.filter((r) => r.status === 201).length;
      const mukerrer = sonuclar.filter((r) => r.status === 409).length;
      console.log(`      201=${olusan} 409=${mukerrer} diger=${5 - olusan - mukerrer}`);
      check("Tam olarak 1 odeme kaydedildi", olusan === 1, `${olusan} kayit olustu`);
      check("Digerleri mukerrer olarak reddedildi", mukerrer === 4, `${mukerrer} adet 409`);

      const h = await hakedis();
      check("Odenen yalnizca 50 artti", h.satir!.totalPaid === oncesi.satir!.totalPaid + 50,
        `${oncesi.satir?.totalPaid} -> ${h.satir?.totalPaid}`);
      const defter = await db.barberPayout.count({ where: { barberId: barber.id, amount: 50 } });
      check("Defterde tek 50 TL kaydi var", defter === 1, `${defter} kayit`);
      // Odenen: 150, kalan: 570
    }

    // ── TEST 12 — Eşzamanlı farklı ödemeler kalanı aşamaz ────────────────
    console.log("\nTEST 12 — Es zamanli farkli odemeler kalani asamamali");
    {
      const oncesi = await hakedis();
      const kalanOnce = oncesi.satir!.totalRemaining; // 570
      // Toplami kalandan BUYUK, tek tek kalandan kucuk tutarlar.
      const tutarlar = [100, 110, 120, 130, 140, 150]; // toplam 750 > 570
      const sonuclar = await Promise.all(tutarlar.map((t) => post("/api/payouts", odeme(barber.id, t))));
      const olusan = sonuclar.filter((r) => r.status === 201);
      const reddedilen = sonuclar.filter((r) => r.status === 400);
      const kabulToplam = olusan.reduce((s, r) => s + ((r.body.payout as { amount: number } | undefined)?.amount ?? 0), 0);
      console.log(`      kalan ${kalanOnce} | istenen ${tutarlar.reduce((a, b) => a + b, 0)} | kabul ${kabulToplam} (${olusan.length} adet), red ${reddedilen.length}`);

      check("En az bir istek reddedildi (hepsi gecmedi)", reddedilen.length > 0, `red ${reddedilen.length}`);
      check("Kabul edilen toplam kalani asmadi", kabulToplam <= kalanOnce, `${kabulToplam} > ${kalanOnce}`);

      const h = await hakedis();
      console.log(`      son durum: tahakkuk=${h.satir?.totalAccrued} odenen=${h.satir?.totalPaid} kalan=${h.satir?.totalRemaining}`);
      check("Kalan hakedis NEGATIFE dusmedi", h.satir!.totalRemaining >= 0, `kalan ${h.satir?.totalRemaining}`);
      check("Odenen tahakkuku asmadi", h.satir!.totalPaid <= h.satir!.totalAccrued,
        `odenen ${h.satir?.totalPaid} > tahakkuk ${h.satir?.totalAccrued}`);

      const defterToplam = (await db.barberPayout.aggregate({ where: { barberId: barber.id }, _sum: { amount: true } }))._sum.amount ?? 0;
      check("Defter toplami rapordaki odenen ile ayni", Math.round(num(defterToplam) * 100) / 100 === h.satir!.totalPaid,
        `defter ${defterToplam} vs rapor ${h.satir?.totalPaid}`);
    }

    // ── TEST 13 — Tam ödeme ve sonrası ───────────────────────────────────
    console.log("\nTEST 13 — Tam odeme sonrasi kalan sifir olmali");
    {
      const oncesi = await hakedis();
      const kalan = oncesi.satir!.totalRemaining;
      if (kalan > 0) {
        // AYRI bir dönem etiketiyle: TEST 12'deki yarış nondeterministik
        // olduğu için kalan, oradaki tutarlardan birine eşit çıkabilir.
        // Aynı berber + aynı tutar + aynı dönem mükerrer sayılacağından
        // (10 sn penceresi) kapanış ödemesi farklı bir döneme yazılır.
        const r = await post("/api/payouts", odeme(barber.id, kalan, {
          periodStart: "2026-07-01", periodEnd: "2026-07-31", note: `${MARK} kapanis`,
        }));
        check(`Kalanin tamami (${kalan}) odendi -> 201`, r.status === 201, `gelen ${r.status}`);
      } else {
        check("Kalan zaten sifir", true);
      }
      const h = await hakedis();
      check("Kalan hakedis 0", h.satir?.totalRemaining === 0, `gelen ${h.satir?.totalRemaining}`);
      check("Odenen == tahakkuk (720)", h.satir?.totalPaid === h.satir?.totalAccrued && h.satir?.totalPaid === 720,
        `odenen ${h.satir?.totalPaid} tahakkuk ${h.satir?.totalAccrued}`);

      const fazla = await post("/api/payouts", odeme(barber.id, 10));
      check("Kalan yokken yeni odeme -> 400", fazla.status === 400, `gelen ${fazla.status}`);
      check("  ...gerekce NO_REMAINING_PAYOUT", fazla.body.code === "NO_REMAINING_PAYOUT", `${fazla.body.code}`);
    }

    // ── TEST 14 — Tahakkuk / ödenen / kalan denklemi ─────────────────────
    console.log("\nTEST 14 — tahakkuk - odenen = kalan denklemi");
    {
      const h = await hakedis();
      const s = h.satir!;
      const aktif = await db.sale.aggregate({
        where: { barberId: barber.id, saleStatus: { not: "VOIDED" } },
        _sum: { barberShare: true },
      });
      const defter = await db.barberPayout.aggregate({ where: { barberId: barber.id }, _sum: { amount: true } });
      const gercekTahakkuk = Math.round(num(aktif._sum.barberShare) * 100) / 100;
      const gercekOdenen = Math.round(num(defter._sum.amount) * 100) / 100;

      check("Rapor tahakkuku = satislardan hesaplanan", s.totalAccrued === gercekTahakkuk, `${s.totalAccrued} vs ${gercekTahakkuk}`);
      check("Rapor odeneni = defterden hesaplanan", s.totalPaid === gercekOdenen, `${s.totalPaid} vs ${gercekOdenen}`);
      check("kalan == tahakkuk - odenen", s.totalRemaining === Math.round((gercekTahakkuk - gercekOdenen) * 100) / 100,
        `${s.totalRemaining} != ${gercekTahakkuk - gercekOdenen}`);
      check("Donem ekseninde de denklem tutuyor", s.periodRemaining === Math.round((s.accrued - s.paid) * 100) / 100,
        `${s.periodRemaining} != ${s.accrued} - ${s.paid}`);
    }

    // ── TEST 15 — Ödeme sonrası VOID ─────────────────────────────────────
    console.log("\nTEST 15 — Odeme yapildiktan sonra satis VOID edilirse");
    {
      const oncesi = await hakedis();
      await post(`/api/cash/${walkInSaleId}/void`, { voidReason: MARK });
      const h = await hakedis();
      console.log(`      tahakkuk ${oncesi.satir?.totalAccrued} -> ${h.satir?.totalAccrued} | odenen ${h.satir?.totalPaid} | kalan ${h.satir?.totalRemaining}`);
      check("VOID tahakkuku dusurdu (720 -> 600)", h.satir?.totalAccrued === 600, `gelen ${h.satir?.totalAccrued}`);
      check("Odenen degismedi (para geri gelmez)", h.satir?.totalPaid === 720, `gelen ${h.satir?.totalPaid}`);
      check("Kalan -120 olarak GORUNUYOR (fazla odenmis, gizlenmiyor)", h.satir?.totalRemaining === -120, `gelen ${h.satir?.totalRemaining}`);

      const yeni = await post("/api/payouts", odeme(barber.id, 10));
      check("Fazla odenmisken yeni odeme -> 400", yeni.status === 400, `gelen ${yeni.status}`);
      check("  ...gerekce NO_REMAINING_PAYOUT", yeni.body.code === "NO_REMAINING_PAYOUT", `${yeni.body.code}`);
    }

    // ── TEST 16 — Rapor ve ekran tutarlılığı ─────────────────────────────
    console.log("\nTEST 16 — Rapor ile ekran ayni kaynagi kullaniyor mu");
    {
      const { readFileSync } = await import("node:fs");
      const ekran = readFileSync("app/(admin)/admin/(protected)/hakedisler/page.tsx", "utf8");
      const tablo = readFileSync("app/(admin)/admin/(protected)/hakedisler/HakedisTable.tsx", "utf8");
      const api = readFileSync("app/api/commissions/route.ts", "utf8");

      check("Ekran hesabi buildCommissionReport'tan aliyor", /buildCommissionReport/.test(ekran), "ekran kendi sorgusunu yapiyor");
      check("API hesabi buildCommissionReport'tan aliyor", /buildCommissionReport/.test(api), "API kendi sorgusunu yapiyor");
      check("Ekranda ayri bir db.sale.findMany sorgusu KALMADI", !/db\.sale\.findMany/.test(ekran), "ikinci hesap kaynagi var");

      check("Ekranda 'Tahakkuk Eden Hakedis' basligi var", /Tahakkuk Eden Hakediş/.test(ekran), "eksik");
      check("Ekranda 'Odenen Hakedis' basligi var", /Ödenen Hakediş/.test(ekran) && /Ödenen Hakediş/.test(tablo), "eksik");
      check("Ekranda 'Kalan Hakedis' basligi var", /Kalan Hakediş/.test(ekran) && /Kalan Hakediş/.test(tablo), "eksik");
      check("Belirsiz 'Toplam Hakedis' etiketi kalkti", !/Toplam Hakediş/.test(ekran) && !/Toplam Hakediş/.test(tablo), "belirsiz etiket duruyor");
      check("Odeme gecmisi ekranda var (tarih/donem/tutar/yontem/not)",
        /Ödeme Tarihi/.test(tablo) && /Ait Olduğu Dönem/.test(tablo) && /Yöntem/.test(tablo) && /Not/.test(tablo),
        "gecmis tablosu eksik");

      // Aynı aralığı hem API hem ekran için hesaplayan tek fonksiyon olduğundan
      // rakamlar tanım gereği aynı; yine de API iki kez sorgulanıp doğrulanır.
      const a = await hakedis();
      const b = await hakedis();
      check("Rapor iki cagrida ayni rakami veriyor",
        a.satir?.totalAccrued === b.satir?.totalAccrued && a.satir?.totalPaid === b.satir?.totalPaid,
        "rakamlar oynak");
    }

    // ── TEST 17 — Yetkisiz erişim ────────────────────────────────────────
    console.log("\nTEST 17 — Yetkisiz erisim");
    {
      const eski = cookie;
      cookie = "";
      const r = await post("/api/payouts", odeme(barber.id, 10));
      check("Oturumsuz odeme istegi reddedildi", r.status === 401 || r.status === 403, `gelen ${r.status}`);
      const g = await fetch(`${BASE}/api/payouts?range=today`, { cache: "no-store" });
      check("Oturumsuz okuma reddedildi", g.status === 401 || g.status === 403, `gelen ${g.status}`);
      cookie = eski;
    }

    // ── TEST 18 — Gerçek veri bozulmadı ──────────────────────────────────
    console.log("\nTEST 18 — Gercek veri bozulmadi");
    check("Test disi satis sayisi degismedi",
      (await db.sale.count({ where: { NOT: { note: { startsWith: MARK } } } })) === satisOnce, `once ${satisOnce}`);
    check("Test disi berbere hakedis odemesi yazilmadi",
      (await db.barberPayout.count({ where: { barberId: { notIn: [testBarberId, ownerBarberId, maasliBarberId] } } })) === 0,
      "baska berbere odeme kaydi olusmus");
  } finally {
    console.log("\nTEMIZLIK...");
    const n = await cleanup();
    console.log(`  silinen: hakedis=${n.hakedis} odeme=${n.odeme} satis=${n.satis} randevu=${n.randevu} musteri=${n.musteri} berber=${n.berber}`);
    console.log(`  DB: ${await db.sale.count()} satis, ${await db.barber.count()} berber, ${await db.customer.count()} musteri, ${await db.barberPayout.count()} hakedis odemesi`);
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

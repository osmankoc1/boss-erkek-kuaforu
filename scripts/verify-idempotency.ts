/**
 * Kesin idempotency (FAZ 2 · Sıra 9b).
 *
 * Çalıştırma (dev server ayakta olmalı):
 *   npx dotenv -e .env.local -- tsx scripts/verify-idempotency.ts
 *
 * ─── SINANAN KURALLAR ────────────────────────────────────────────────────
 *   • Aynı `idempotencyKey` ile gelen ikinci istek YENİ KAYIT OLUŞTURMAZ;
 *     var olan kayıt 200 + `idempotent: true` ile döner.
 *   • Bu garanti SÜRE SINIRSIZDIR — 10 sn'lik mükerrer penceresinin
 *     dışında da geçerlidir. (Asıl kazanç budur.)
 *   • Farklı anahtar = farklı istek: aynı tutar bile olsa yeni kayıt oluşur.
 *   • Anahtar göndermeyen istemciler bozulmaz; 10 sn'lik pencere yerinde.
 *   • Eş zamanlı aynı-anahtarlı istekler tek kayıt üretir.
 *   • İdempotent tekrar para hareketi YARATMAZ: paidAmount/kalan değişmez.
 *   • Geçersiz anahtar (çok kısa/uzun) 400 ile reddedilir.
 *   • Unique index gerçekten DB'de var ve NULL'lar çakışmıyor.
 *
 * UYARI: Dev veritabanına test verisi yazar ve sonunda siler.
 * Production endpoint'ine karşı çalışmayı reddeder.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { assertWritableTestDatabase } from "../lib/db-guard";
import { SignJWT } from "jose";
import { istanbulDateString } from "../lib/tz";

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

const MARK = "ZZIDEMTEST";
const PHONE_PREFIX = "0555999100";
const BUGUN = istanbulDateString();

/** Sunucudaki mükerrer penceresi (lib: MUKERRER_PENCERE_MS). */
const PENCERE_MS = 10_000;

type Yanit = { status: number; body: Record<string, unknown> };

let cookie = "";
const post = (u: string, body: unknown): Promise<Yanit> =>
  fetch(`${BASE}${u}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }));

const uyu = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cleanup() {
  const custs = (await db.customer.findMany({ select: { id: true, fullName: true, phone: true } })).filter(
    (c) => c.fullName.startsWith(MARK) || c.phone.startsWith(PHONE_PREFIX)
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
  const say = { hakedis: 0, odeme: 0, satis: 0, musteri: 0, berber: 0 };
  if (barberIds.length) {
    say.hakedis = (await db.barberPayout.deleteMany({ where: { barberId: { in: barberIds } } })).count;
  }
  if (saleIds.length) {
    say.odeme = (await db.customerPayment.deleteMany({ where: { saleId: { in: saleIds } } })).count;
    await db.saleItem.deleteMany({ where: { saleId: { in: saleIds } } });
    say.satis = (await db.sale.deleteMany({ where: { id: { in: saleIds } } })).count;
  }
  if (ids.length) {
    await db.customerPayment.deleteMany({ where: { customerId: { in: ids } } });
    await db.appointment.deleteMany({ where: { customerId: { in: ids } } });
    say.musteri = (await db.customer.deleteMany({ where: { id: { in: ids } } })).count;
  }
  if (barberIds.length) {
    await db.appointment.deleteMany({ where: { barberId: { in: barberIds } } });
    say.berber = (await db.barber.deleteMany({ where: { id: { in: barberIds } } })).count;
  }
  return say;
}

let sira = 0;
async function musteri(ad: string) {
  sira += 1;
  return db.customer.create({ data: { fullName: `${MARK} ${ad}`, phone: `${PHONE_PREFIX}${sira}` } });
}

async function satisYap(
  c: { id: string; fullName: string; phone: string },
  barberId: string,
  service: { id: string; name: string },
  saleAmount: number,
  paidAmount: number
) {
  const r = await post("/api/cash", {
    customerId: c.id, barberId,
    customerName: c.fullName, customerPhone: c.phone,
    serviceName: service.name, serviceId: service.id,
    listedPrice: saleAmount, saleAmount, paidAmount,
    paymentMethod: "CASH", note: MARK,
  });
  return (r.body as { sale?: { id: string } }).sale?.id ?? "";
}

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

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

  const barber = await db.barber.create({
    data: { name: `${MARK} Kalfa`, workerType: "COMMISSION", commissionRate: 40, isActive: true },
  });

  try {
    // ── TEST 1 — Şema ve unique index gerçekten var mı ────────────────────
    console.log("TEST 1 — Sema ve unique index");
    {
      const idx = await db.$queryRawUnsafe<{ tablo: string; indeks: string }[]>(`
        SELECT tablename::text AS tablo, indexname::text AS indeks
        FROM pg_indexes
        WHERE schemaname = 'public' AND indexdef ILIKE '%idempotencyKey%'
        ORDER BY tablename`);
      console.log(`      bulunan indeks: ${idx.map((i) => `${i.tablo}.${i.indeks}`).join(", ")}`);
      check("CustomerPayment icin unique index var",
        idx.some((i) => i.tablo === "CustomerPayment"), idx.map((i) => i.tablo).join(","));
      check("BarberPayout icin unique index var",
        idx.some((i) => i.tablo === "BarberPayout"), idx.map((i) => i.tablo).join(","));

      const benzersiz = await db.$queryRawUnsafe<{ n: number }[]>(`
        SELECT count(*)::int AS n FROM pg_indexes
        WHERE schemaname='public' AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%idempotencyKey%'`);
      check("Indeksler UNIQUE", n(benzersiz[0]?.n) === 2, `${benzersiz[0]?.n} adet`);

      const kolon = await db.$queryRawUnsafe<{ tablo: string; nullable: string }[]>(`
        SELECT table_name::text AS tablo, is_nullable::text AS nullable
        FROM information_schema.columns
        WHERE table_schema='public' AND column_name='idempotencyKey' ORDER BY table_name`);
      check("Kolonlar NULLABLE (mevcut satirlar bozulmaz)",
        kolon.length === 2 && kolon.every((k) => k.nullable === "YES"),
        kolon.map((k) => `${k.tablo}=${k.nullable}`).join(", "));
    }

    // ── TEST 2 — Tahsilat: aynı anahtar tek kayıt üretir ──────────────────
    console.log("\nTEST 2 — Tahsilat: ayni anahtar tek kayit");
    {
      const c = await musteri("Tahsilat");
      const saleId = await satisYap(c, barber.id, service, 300, 0);
      const anahtar = randomUUID();
      const govde = { saleId, customerId: c.id, amount: 100, paymentMethod: "CASH", idempotencyKey: anahtar };

      const ilk = await post("/api/debts/payment", govde);
      check("Ilk istek -> 201", ilk.status === 201, `gelen ${ilk.status}`);
      check("  ...idempotent bayragi YOK (yeni kayit)", ilk.body.idempotent === undefined, `${ilk.body.idempotent}`);

      const ikinci = await post("/api/debts/payment", govde);
      check("Ayni anahtarla ikinci istek -> 200 (hata degil)", ikinci.status === 200, `gelen ${ikinci.status}`);
      check("  ...idempotent: true", ikinci.body.idempotent === true, `${ikinci.body.idempotent}`);

      const ilkId = (ilk.body.payment as { id: string } | undefined)?.id;
      const ikinciId = (ikinci.body.payment as { id: string } | undefined)?.id;
      check("  ...ayni kayit dondu", !!ilkId && ilkId === ikinciId, `${ilkId} vs ${ikinciId}`);

      const adet = await db.customerPayment.count({ where: { saleId, idempotencyKey: anahtar } });
      check("Defterde TEK kayit var", adet === 1, `${adet} kayit`);

      const sale = await db.sale.findUnique({ where: { id: saleId } });
      console.log(`      paidAmount=${sale?.paidAmount} remaining=${sale?.remainingAmount}`);
      check("Tekrar PARA HAREKETI yaratmadi (paidAmount 100)", n(sale?.paidAmount) === 100, `${sale?.paidAmount}`);
      check("  ...kalan 200", n(sale?.remainingAmount) === 200, `${sale?.remainingAmount}`);
    }

    // ── TEST 3 — Pencere DIŞINDA da garanti sürüyor ───────────────────────
    console.log("\nTEST 3 — 10 sn'lik pencere DISINDA da tek kayit (asil kazanc)");
    {
      const c = await musteri("Pencere");
      const saleId = await satisYap(c, barber.id, service, 500, 0);
      const anahtar = randomUUID();
      const govde = { saleId, customerId: c.id, amount: 50, paymentMethod: "CASH", idempotencyKey: anahtar };

      const ilk = await post("/api/debts/payment", govde);
      check("Ilk istek -> 201", ilk.status === 201, `gelen ${ilk.status}`);

      console.log(`      ${PENCERE_MS / 1000} sn bekleniyor (mukerrer penceresi kapansin diye)...`);
      await uyu(PENCERE_MS + 1500);

      const gec = await post("/api/debts/payment", govde);
      check("Pencere kapandiktan SONRA ayni anahtar -> 200", gec.status === 200, `gelen ${gec.status}`);
      check("  ...idempotent: true", gec.body.idempotent === true, `${gec.body.idempotent}`);

      const adet = await db.customerPayment.count({ where: { saleId } });
      check("Hala TEK kayit (eski pencere korumasi burada CALISMAZDI)", adet === 1, `${adet} kayit`);

      const sale = await db.sale.findUnique({ where: { id: saleId } });
      check("paidAmount 50 (iki kez yazilmadi)", n(sale?.paidAmount) === 50, `${sale?.paidAmount}`);
    }

    // ── TEST 4 — Farklı anahtar = gerçek ikinci tahsilat ──────────────────
    console.log("\nTEST 4 — Farkli anahtar: ayni tutar olsa da yeni kayit");
    {
      const c = await musteri("Farkli");
      const saleId = await satisYap(c, barber.id, service, 400, 0);
      const ortak = { saleId, customerId: c.id, amount: 75, paymentMethod: "CASH" };

      const a = await post("/api/debts/payment", { ...ortak, idempotencyKey: randomUUID() });
      const b = await post("/api/debts/payment", { ...ortak, idempotencyKey: randomUUID() });
      check("1. tahsilat -> 201", a.status === 201, `gelen ${a.status}`);
      check("2. tahsilat (farkli anahtar, ayni tutar) -> 201", b.status === 201, `gelen ${b.status}`);

      const adet = await db.customerPayment.count({ where: { saleId } });
      check("Iki ayri kayit olustu", adet === 2, `${adet} kayit`);

      const sale = await db.sale.findUnique({ where: { id: saleId } });
      check("paidAmount 150 (75 + 75)", n(sale?.paidAmount) === 150, `${sale?.paidAmount}`);
      console.log("      (anahtar sayesinde mesru ikinci tahsilat artik reddedilmiyor)");
    }

    // ── TEST 5 — Anahtarsız istemci bozulmadı ────────────────────────────
    console.log("\nTEST 5 — Anahtar gondermeyen istemci eskisi gibi calisir");
    {
      const c = await musteri("Anahtarsiz");
      const saleId = await satisYap(c, barber.id, service, 300, 0);
      const govde = { saleId, customerId: c.id, amount: 60, paymentMethod: "CASH" };

      const ilk = await post("/api/debts/payment", govde);
      check("Anahtarsiz ilk istek -> 201", ilk.status === 201, `gelen ${ilk.status}`);

      const ikinci = await post("/api/debts/payment", govde);
      check("Anahtarsiz tekrar -> 409 (10 sn penceresi hala yerinde)", ikinci.status === 409, `gelen ${ikinci.status}`);
      check("  ...gerekce DUPLICATE_PAYMENT", ikinci.body.code === "DUPLICATE_PAYMENT", `${ikinci.body.code}`);

      const adet = await db.customerPayment.count({ where: { saleId } });
      check("Tek kayit", adet === 1, `${adet} kayit`);
      const nullAnahtar = await db.customerPayment.count({ where: { saleId, idempotencyKey: null } });
      check("Anahtar NULL kaydedildi", nullAnahtar === 1, `${nullAnahtar}`);
    }

    // ── TEST 6 — Eş zamanlı aynı anahtar ─────────────────────────────────
    console.log("\nTEST 6 — Es zamanli 6 istek, ayni anahtar");
    {
      const c = await musteri("Yaris");
      const saleId = await satisYap(c, barber.id, service, 600, 0);
      const anahtar = randomUUID();
      const govde = { saleId, customerId: c.id, amount: 90, paymentMethod: "CASH", idempotencyKey: anahtar };

      const sonuclar = await Promise.all(Array.from({ length: 6 }, () => post("/api/debts/payment", govde)));
      const olusan = sonuclar.filter((r) => r.status === 201).length;
      const tekrar = sonuclar.filter((r) => r.status === 200).length;
      const hata = sonuclar.filter((r) => r.status >= 400).length;
      console.log(`      201=${olusan} 200=${tekrar} 4xx/5xx=${hata}`);

      check("Tam olarak 1 kayit olusturuldu", olusan === 1, `${olusan}`);
      check("Digerleri idempotent tekrar olarak dondu", tekrar === 5, `${tekrar}`);
      check("Hicbiri hata dondurmedi", hata === 0, `${hata} hata`);

      const adet = await db.customerPayment.count({ where: { saleId } });
      check("Defterde tek kayit", adet === 1, `${adet}`);
      const sale = await db.sale.findUnique({ where: { id: saleId } });
      check("paidAmount 90 (bir kez)", n(sale?.paidAmount) === 90, `${sale?.paidAmount}`);
    }

    // ── TEST 7 — Hakediş ödemesi: aynı anahtar ───────────────────────────
    console.log("\nTEST 7 — Hakedis odemesi: ayni anahtar tek kayit");
    {
      // Bu berberin tahakkuku onceki testlerdeki satislardan doguyor.
      const tahakkuk = await db.sale.aggregate({
        where: { barberId: barber.id, saleStatus: { not: "VOIDED" } },
        _sum: { barberShare: true },
      });
      console.log(`      berberin tahakkuku: ${tahakkuk._sum.barberShare}`);

      const anahtar = randomUUID();
      const govde = {
        barberId: barber.id, amount: 40, paymentMethod: "CASH",
        periodStart: BUGUN, periodEnd: BUGUN, note: MARK, idempotencyKey: anahtar,
      };

      const ilk = await post("/api/payouts", govde);
      check("Ilk hakedis odemesi -> 201", ilk.status === 201, `gelen ${ilk.status}`);

      const ikinci = await post("/api/payouts", govde);
      check("Ayni anahtarla ikinci -> 200", ikinci.status === 200, `gelen ${ikinci.status}`);
      check("  ...idempotent: true", ikinci.body.idempotent === true, `${ikinci.body.idempotent}`);

      const ilkId = (ilk.body.payout as { id: string } | undefined)?.id;
      const ikinciId = (ikinci.body.payout as { id: string } | undefined)?.id;
      check("  ...ayni kayit dondu", !!ilkId && ilkId === ikinciId, `${ilkId} vs ${ikinciId}`);

      const adet = await db.barberPayout.count({ where: { barberId: barber.id, idempotencyKey: anahtar } });
      check("Defterde TEK hakedis odemesi", adet === 1, `${adet}`);

      const toplam = await db.barberPayout.aggregate({ where: { barberId: barber.id }, _sum: { amount: true } });
      check("Odenen toplam 40 (iki kez yazilmadi)", n(toplam._sum.amount) === 40, `${toplam._sum.amount}`);
    }

    // ── TEST 8 — Hakediş: pencere dışı + eş zamanlı ──────────────────────
    console.log("\nTEST 8 — Hakedis: pencere disi ve es zamanli");
    {
      const anahtar = randomUUID();
      const govde = {
        barberId: barber.id, amount: 30, paymentMethod: "CARD",
        periodStart: BUGUN, periodEnd: BUGUN, note: MARK, idempotencyKey: anahtar,
      };
      const ilk = await post("/api/payouts", govde);
      check("Ilk odeme -> 201", ilk.status === 201, `gelen ${ilk.status}`);

      console.log(`      ${PENCERE_MS / 1000} sn bekleniyor...`);
      await uyu(PENCERE_MS + 1500);

      const gec = await post("/api/payouts", govde);
      check("Pencere disinda ayni anahtar -> 200", gec.status === 200, `gelen ${gec.status}`);

      const esZamanli = await Promise.all(Array.from({ length: 5 }, () => post("/api/payouts", govde)));
      check("Es zamanli 5 tekrar da 200", esZamanli.every((r) => r.status === 200),
        esZamanli.map((r) => r.status).join(","));

      const adet = await db.barberPayout.count({ where: { barberId: barber.id, idempotencyKey: anahtar } });
      check("Tek kayit", adet === 1, `${adet}`);
      const toplam = await db.barberPayout.aggregate({ where: { barberId: barber.id }, _sum: { amount: true } });
      check("Odenen toplam 70 (40 + 30)", n(toplam._sum.amount) === 70, `${toplam._sum.amount}`);
    }

    // ── TEST 9 — Geçersiz anahtar reddedilir ─────────────────────────────
    console.log("\nTEST 9 — Gecersiz anahtar dogrulamasi");
    {
      const c = await musteri("Gecersiz");
      const saleId = await satisYap(c, barber.id, service, 200, 0);
      const temel = { saleId, customerId: c.id, amount: 10, paymentMethod: "CASH" };

      const kisa = await post("/api/debts/payment", { ...temel, idempotencyKey: "abc" });
      check("Cok kisa anahtar -> 400", kisa.status === 400, `gelen ${kisa.status}`);

      const uzun = await post("/api/debts/payment", { ...temel, idempotencyKey: "x".repeat(200) });
      check("Cok uzun anahtar -> 400", uzun.status === 400, `gelen ${uzun.status}`);

      const bos = await post("/api/debts/payment", { ...temel, idempotencyKey: "" });
      check("Bos anahtar -> 400", bos.status === 400, `gelen ${bos.status}`);

      const adet = await db.customerPayment.count({ where: { saleId } });
      check("Gecersiz istekler hicbir sey yazmadi", adet === 0, `${adet} kayit`);

      const gecerli = await post("/api/debts/payment", { ...temel, idempotencyKey: randomUUID() });
      check("Gecerli anahtar -> 201", gecerli.status === 201, `gelen ${gecerli.status}`);
    }

    // ── TEST 10 — Anahtar iki tablo arasinda karismiyor ──────────────────
    console.log("\nTEST 10 — Anahtar alanlari tablo bazinda bagimsiz");
    {
      const ortakAnahtar = randomUUID();
      const c = await musteri("Capraz");
      const saleId = await satisYap(c, barber.id, service, 200, 0);

      const tahsilat = await post("/api/debts/payment", {
        saleId, customerId: c.id, amount: 20, paymentMethod: "CASH", idempotencyKey: ortakAnahtar,
      });
      check("Tahsilat -> 201", tahsilat.status === 201, `gelen ${tahsilat.status}`);

      // AYNI anahtar hakedis defterinde serbest olmali: ayri tablo, ayri index.
      const hakedis = await post("/api/payouts", {
        barberId: barber.id, amount: 15, paymentMethod: "CASH",
        periodStart: BUGUN, periodEnd: BUGUN, note: MARK, idempotencyKey: ortakAnahtar,
      });
      check("Ayni anahtarla hakedis odemesi -> 201 (tablolar bagimsiz)", hakedis.status === 201, `gelen ${hakedis.status}`);
    }

    // ── TEST 11 — Birden fazla NULL anahtar çakışmıyor ───────────────────
    console.log("\nTEST 11 — Coklu NULL anahtar unique index'i bozmuyor");
    {
      // Rastlantisal veriye guvenmek yerine NULL catismama ozelligi DOGRUDAN
      // sinanir: iki ayri satisa anahtarsiz tahsilat yazilir. Unique index
      // NULL'lari catistirsaydi ikincisi P2002 ile patlardi.
      const c1 = await musteri("Null1");
      const c2 = await musteri("Null2");
      const s1 = await satisYap(c1, barber.id, service, 100, 0);
      const s2 = await satisYap(c2, barber.id, service, 100, 0);

      const a1 = await post("/api/debts/payment", { saleId: s1, customerId: c1.id, amount: 11, paymentMethod: "CASH" });
      const a2 = await post("/api/debts/payment", { saleId: s2, customerId: c2.id, amount: 11, paymentMethod: "CASH" });
      check("1. anahtarsiz tahsilat -> 201", a1.status === 201, `gelen ${a1.status}`);
      check("2. anahtarsiz tahsilat (farkli satis) -> 201", a2.status === 201, `gelen ${a2.status}`);

      const nullSayisi = await db.customerPayment.count({
        where: { idempotencyKey: null, saleId: { in: [s1, s2] } },
      });
      check("Iki NULL anahtarli kayit bir arada duruyor", nullSayisi === 2, `${nullSayisi} kayit`);
      console.log("      (Postgres unique index'inde NULL'lar catismaz; mevcut veri korunur)");
    }
  } finally {
    console.log("\nTEMIZLIK...");
    const s = await cleanup();
    console.log(`  silinen: hakedis=${s.hakedis} odeme=${s.odeme} satis=${s.satis} musteri=${s.musteri} berber=${s.berber}`);
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

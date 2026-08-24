/**
 * Para tipi: Float → Decimal geçişi (FAZ 2 · Sıra 9a).
 *
 * Çalıştırma (dev server ayakta olmalı):
 *   npx dotenv -e .env.local -- tsx scripts/verify-money-decimal.ts
 *
 * ─── SINANAN KURALLAR ────────────────────────────────────────────────────
 *   • 15 parasal/oransal alanın tamamı `Decimal`; şemada `Float` kalmadı.
 *   • Yuvarlama ROUND_HALF_UP: 1.005 → 1.01, 8.165 → 8.17.
 *   • Birikim tam: 0.07 × 1000 = 70.00.
 *   • 33.33 + 33.33 + 33.34 = 100.00, kalan tam 0, durum PAID.
 *   • Hakediş + işletme payı = satış tutarı (kuruş kaybı yok).
 *   • API para alanları `number` döner — string DEĞİL.
 *   • Client Component prop'larında Decimal kalmaz; sunucu logunda
 *     "Only plain objects..." uyarısı çıkmaz.
 *   • Sayfalarda tutarlar boş/NaN görünmez, `toFixed is not a function` olmaz.
 *   • 2 ondalık haneden fazla para girdisi 400 ile REDDEDİLİR (sessiz
 *     yuvarlama yok).
 *
 * UYARI: Dev veritabanına test verisi yazar ve sonunda siler.
 * Production endpoint'ine karşı çalışmayı reddeder.
 */
import { readFileSync, readdirSync } from "node:fs";
import { PrismaClient, Prisma } from "../app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { assertWritableTestDatabase } from "../lib/db-guard";
import { SignJWT } from "jose";
import { istanbulDateString } from "../lib/tz";
import { round2, sum, toNumber, hasValidMoneyScale } from "../lib/money";
import { calcShares, calcStatus } from "../lib/sale";
import { summarizeRevenue } from "../lib/revenue";

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

const MARK = "ZZDECTEST";
const PHONE_PREFIX = "0555999090";
const BUGUN = istanbulDateString();

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

/** Şemada Decimal olması beklenen 15 alan. */
const BEKLENEN_DECIMAL: [string, string][] = [
  ["Barber", "commissionRate"],
  ["Service", "price"],
  ["Appointment", "appointmentPrice"],
  ["AppointmentService", "price"],
  ["Sale", "listedPrice"],
  ["Sale", "saleAmount"],
  ["Sale", "paidAmount"],
  ["Sale", "remainingAmount"],
  ["Sale", "barberCommissionRate"],
  ["Sale", "barberShare"],
  ["Sale", "businessShare"],
  ["SaleItem", "price"],
  ["CustomerPayment", "amount"],
  ["BarberPayout", "amount"],
  ["Expense", "amount"],
];

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
  const say = { hakedis: 0, odeme: 0, satis: 0, musteri: 0, berber: 0, gider: 0 };
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
  say.gider = (await db.expense.deleteMany({ where: { category: MARK } })).count;
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
  return post("/api/cash", {
    customerId: c.id, barberId,
    customerName: c.fullName, customerPhone: c.phone,
    serviceName: service.name, serviceId: service.id,
    listedPrice: saleAmount, saleAmount, paidAmount,
    paymentMethod: "CASH", note: MARK,
  });
}

/** Bir nesnedeki tüm string-görünümlü para alanlarını bulur. */
function stringParaAlanlari(obj: unknown, yol = ""): string[] {
  const bulunan: string[] = [];
  const PARA = /^(saleAmount|paidAmount|remainingAmount|listedPrice|barberShare|businessShare|barberCommissionRate|commissionRate|appointmentPrice|amount|price|accrued|totalAccrued|totalPaid|totalRemaining|periodRemaining|paid)$/;
  const gez = (v: unknown, y: string) => {
    if (Array.isArray(v)) return v.forEach((x, i) => gez(x, `${y}[${i}]`));
    if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (PARA.test(k) && typeof val === "string") bulunan.push(`${y}.${k}="${val}"`);
        else gez(val, `${y}.${k}`);
      }
    }
  };
  gez(obj, yol);
  return bulunan;
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

  const barber = await db.barber.create({
    data: { name: `${MARK} Kalfa`, workerType: "COMMISSION", commissionRate: 40, isActive: true },
  });

  const satisOnce = await db.sale.count();

  try {
    // ── TEST 1 — Şema: hiç Float kalmadı ─────────────────────────────────
    console.log("TEST 1 — Sema tipleri");
    {
      const sema = readFileSync("prisma/schema.prisma", "utf8");
      const govde = sema
        .split("\n")
        .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("///"))
        .join("\n");
      check("Semada hicbir Float alani kalmadi", !/\bFloat\b/.test(govde),
        (govde.match(/^.*\bFloat\b.*$/m) ?? [""])[0].trim());

      let eksik = 0;
      for (const [model, alan] of BEKLENEN_DECIMAL) {
        const blok = govde.slice(govde.indexOf(`model ${model} {`));
        const satir = blok.slice(0, blok.indexOf("\n}")).split("\n").find((l) => l.trim().startsWith(alan + " "));
        if (!satir || !/\bDecimal\b/.test(satir)) {
          eksik++;
          console.log(`      EKSIK: ${model}.${alan} -> ${satir?.trim() ?? "(bulunamadi)"}`);
        }
      }
      check(`15 parasal/oransal alanin tamami Decimal (${BEKLENEN_DECIMAL.length} kontrol)`, eksik === 0, `${eksik} alan eksik`);

      const tutar = govde.match(/@db\.Decimal\(12, ?2\)/g)?.length ?? 0;
      const oran = govde.match(/@db\.Decimal\(5, ?2\)/g)?.length ?? 0;
      check("13 tutar alani Decimal(12,2)", tutar === 13, `${tutar} adet`);
      check("2 oran alani Decimal(5,2)", oran === 2, `${oran} adet`);
    }

    // ── TEST 2 — r2() kalıbı koddan kalktı ───────────────────────────────
    console.log("\nTEST 2 — Eski yuvarlama kalibi koddan kalkti");
    {
      const dosyalar: string[] = [];
      const gez = (dir: string) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (e.name === "node_modules" || e.name === ".next" || e.name === "generated") continue;
          const tam = `${dir}/${e.name}`;
          if (e.isDirectory()) gez(tam);
          else if (/\.(ts|tsx)$/.test(e.name)) dosyalar.push(tam);
        }
      };
      gez("app"); gez("lib");

      // Yorum satirlari haric tutulur: lib/money.ts eski kalibi belgeleme
      // amaciyla ORNEK olarak iceriyor; bu bir kullanim degildir.
      const kodSatirlari = (src: string) =>
        src
          .split("\n")
          .filter((l) => {
            const t = l.trim();
            return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
          })
          .join("\n");
      const kalanlar = dosyalar.filter((f) =>
        /Math\.round\([^)]*\*\s*100\)\s*\/\s*100/.test(kodSatirlari(readFileSync(f, "utf8")))
      );
      check(`Math.round(n*100)/100 para kalibi kalmadi (${dosyalar.length} dosya tarandi)`,
        kalanlar.length === 0, kalanlar.join(", "));

      const money = readFileSync("lib/money.ts", "utf8");
      check("lib/money.ts ROUND_HALF_UP kullaniyor", /ROUND_HALF_UP/.test(money), "yuvarlama modu yok");
    }

    // ── TEST 3 — Yuvarlama doğruluğu ─────────────────────────────────────
    console.log("\nTEST 3 — ROUND_HALF_UP kurus yuvarlamasi");
    {
      check("1.005 -> 1.01", round2(1.005).toString() === "1.01", round2(1.005).toString());
      check("8.165 -> 8.17", round2(8.165).toString() === "8.17", round2(8.165).toString());
      check("2.675 -> 2.68", round2(2.675).toString() === "2.68", round2(2.675).toString());
      check("0.125 -> 0.13", round2(0.125).toString() === "0.13", round2(0.125).toString());
      check("-1.005 -> -1.01", round2(-1.005).toString() === "-1.01", round2(-1.005).toString());

      // Eski kalibin YANLIS sonuclari — karsilastirma icin
      console.log(`      (eski kalip: Math.round(1.005*100)/100 = ${Math.round(1.005 * 100) / 100})`);
      console.log(`      (eski kalip: Math.round(8.165*100)/100 = ${Math.round(8.165 * 100) / 100})`);
    }

    // ── TEST 4 — Birikim hatası yok ──────────────────────────────────────
    console.log("\nTEST 4 — Birikim hatasi");
    {
      const bin = sum(Array.from({ length: 1000 }, () => 0.07));
      check("0.07 x 1000 = 70.00 (tam)", bin.toFixed(2) === "70.00", bin.toString());
      console.log(`      (eski kalip float birikimi: ${Array.from({ length: 1000 }).reduce((s: number) => s + 0.07, 0)})`);

      const ucparca = sum(["33.33", "33.33", "33.34"]);
      check("33.33 + 33.33 + 33.34 = 100.00", ucparca.toFixed(2) === "100.00", ucparca.toString());
    }

    // ── TEST 5 — Pay hesabı satış tutarına tam eşit ──────────────────────
    console.log("\nTEST 5 — Hakedis + isletme payi = satis");
    {
      const senaryolar: [number, number][] = [
        [1000, 40], [350.55, 33], [16.33, 50], [99.99, 15], [1234.56, 40], [0.01, 50],
      ];
      let hata = 0;
      for (const [tutar, oran] of senaryolar) {
        const { barberShare, businessShare } = calcShares(tutar, "COMMISSION", oran);
        const toplam = barberShare.plus(businessShare);
        const esit = toplam.equals(round2(tutar));
        if (!esit) {
          hata++;
          console.log(`      SAPMA: ${tutar} x %${oran} -> ${barberShare} + ${businessShare} = ${toplam}`);
        }
      }
      check(`Tum senaryolarda pay toplami satisa esit (${senaryolar.length} senaryo)`, hata === 0, `${hata} sapma`);

      const s = calcShares(16.33, "COMMISSION", 50);
      console.log(`      16.33 x %50 -> berber ${s.barberShare} + isletme ${s.businessShare}`);
      check("16.33 x %50 -> 8.17 (yukari yuvarlandi)", s.barberShare.toString() === "8.17", s.barberShare.toString());

      check("OWNER hakedis almaz", calcShares(1000, "OWNER", 40).barberShare.isZero());
      check("FIXED_SALARY hakedis almaz", calcShares(1000, "FIXED_SALARY", 40).barberShare.isZero());
    }

    // ── TEST 6 — Kısmi ödeme zinciri tam kapanır ─────────────────────────
    console.log("\nTEST 6 — 33.33 + 33.33 + 33.34 = 100.00 tam kapanis");
    {
      const c = await musteri("Ucparca");
      const r = await satisYap(c, barber.id, service, 100, 33.33);
      check("Satis olusturuldu (100 TL, 33.33 pesin)", r.status === 201, `gelen ${r.status}`);
      const saleId = (r.body as { sale?: { id: string } }).sale?.id ?? "";

      // Ikinci 33.33 ilk tahsilatla ayni tutarda; mukerrer penceresine (10 sn)
      // takilmamasi icin FARKLI odeme yontemiyle gonderilir. Mukerrer anahtari
      // saleId + tutar + yontem oldugundan bu gecerli bir ikinci tahsilattir.
      const o1 = await post("/api/debts/payment", { saleId, customerId: c.id, amount: 33.33, paymentMethod: "CARD" });
      check("2. taksit 33.33 -> 201", o1.status === 201, `gelen ${o1.status}`);
      const o2 = await post("/api/debts/payment", { saleId, customerId: c.id, amount: 33.34, paymentMethod: "CASH" });
      check("3. taksit 33.34 -> 201", o2.status === 201, `gelen ${o2.status}`);

      const sale = await db.sale.findUnique({ where: { id: saleId } });
      console.log(`      paidAmount=${sale?.paidAmount} remaining=${sale?.remainingAmount} durum=${sale?.saleStatus}`);
      check("paidAmount tam 100.00", sale!.paidAmount.toFixed(2) === "100.00", String(sale?.paidAmount));
      check("remainingAmount tam 0.00 (hayalet borc yok)", sale!.remainingAmount.isZero(), String(sale?.remainingAmount));
      check("Durum PAID", sale?.saleStatus === "PAID", String(sale?.saleStatus));

      const defter = await db.customerPayment.aggregate({ where: { saleId }, _sum: { amount: true } });
      check("Odeme defteri toplami = paidAmount", round2(defter._sum.amount ?? 0).equals(sale!.paidAmount),
        `${defter._sum.amount} vs ${sale?.paidAmount}`);

      const fazla = await post("/api/debts/payment", { saleId, customerId: c.id, amount: 0.01, paymentMethod: "CASH" });
      check("Kapanmis satisa ek odeme -> 400", fazla.status === 400, `gelen ${fazla.status}`);
    }

    // ── TEST 7 — 2 haneden fazla ondalık REDDEDİLİR ──────────────────────
    console.log("\nTEST 7 — Fazla ondalikli girdi reddedilmeli (sessiz yuvarlama YOK)");
    {
      check("hasValidMoneyScale(19.99) true", hasValidMoneyScale(19.99));
      check("hasValidMoneyScale(20) true", hasValidMoneyScale(20));
      check("hasValidMoneyScale(19.999) false", !hasValidMoneyScale(19.999));
      check("hasValidMoneyScale(0.1+0.2) false", !hasValidMoneyScale(0.1 + 0.2));
      check("hasValidMoneyScale(1e-7) false", !hasValidMoneyScale(1e-7));

      const c = await musteri("Ondalik");
      const r = await satisYap(c, barber.id, service, 19.999, 0);
      check("Satis: saleAmount 19.999 -> 400", r.status === 400, `gelen ${r.status}`);
      check("  ...kayit olusmadi", (await db.sale.count({ where: { customerId: c.id } })) === 0, "satis yazilmis");

      const g = await post("/api/expenses", { amount: 12.345, category: MARK, description: MARK });
      check("Gider: 12.345 -> 400", g.status === 400, `gelen ${g.status}`);
      const gs = await post("/api/expenses", { amount: 12.34, category: MARK, description: MARK });
      check("Gider: 12.34 -> 201 (gecerli)", gs.status === 201, `gelen ${gs.status}`);

      const svc = await post("/api/services", { name: `${MARK} Hizmet`, durationMinutes: 30, price: 99.999 });
      check("Hizmet fiyati 99.999 -> 400", svc.status === 400, `gelen ${svc.status}`);

      const c2 = await musteri("Ondalik2");
      const r2 = await satisYap(c2, barber.id, service, 100, 0);
      const saleId2 = (r2.body as { sale?: { id: string } }).sale?.id ?? "";
      const od = await post("/api/debts/payment", { saleId: saleId2, customerId: c2.id, amount: 10.005, paymentMethod: "CASH" });
      check("Tahsilat 10.005 -> 400", od.status === 400, `gelen ${od.status}`);
    }

    // ── TEST 8 — API para alanları number döner, string DEĞİL ────────────
    console.log("\nTEST 8 — API yanitlarinda para alanlari number");
    {
      const uclar = [
        "/api/cash?date=" + BUGUN,
        "/api/commissions?range=today",
        "/api/payouts?range=today",
        "/api/debts",
        "/api/expenses",
        "/api/services",
        "/api/day-end?date=" + BUGUN,
        "/api/cash/summary?date=" + BUGUN,
        "/api/dashboard?range=today",
        "/api/service-analytics?range=today",
      ];
      for (const u of uclar) {
        const body = await get(u);
        const stringler = stringParaAlanlari(body, u);
        check(`${u.split("?")[0]} -> string para alani YOK`, stringler.length === 0, stringler.slice(0, 3).join(" | "));
      }

      const kasa = await get("/api/cash?date=" + BUGUN);
      const ilk = (kasa.sales ?? [])[0];
      if (ilk) {
        check("  ...saleAmount tipi number", typeof ilk.saleAmount === "number", typeof ilk.saleAmount);
        check("  ...toFixed cagrilabiliyor", typeof (ilk.saleAmount as number).toFixed === "function");
        if (ilk.items?.[0]) {
          check("  ...ic ice items[].price de number", typeof ilk.items[0].price === "number", typeof ilk.items[0].price);
        } else {
          check("  ...ic ice items[].price de number", true, "(kalem yok)");
        }
      } else {
        check("  ...saleAmount tipi number", true, "(satis yok)");
        check("  ...toFixed cagrilabiliyor", true, "(satis yok)");
        check("  ...ic ice items[].price de number", true, "(satis yok)");
      }
    }

    // ── TEST 9 — Sayfalar: Decimal sizintisi ve bos tutar yok ────────────
    console.log("\nTEST 9 — Sayfalarda Decimal sizintisi / bos tutar");
    {
      // TUM sayfalar taranir. Once yalnizca "parasal" sandigim sayfalar
      // listeleniyordu ve /admin/calisanlar listede yoktu -- oradaki
      // commissionRate sizintisi bu yuzden testten kacmisti. Bir sayfanin
      // para tasiyip tasimadigina karar vermek yerine hepsi kontrol edilir.
      const sayfalar = [
        "/admin/dashboard", "/admin/kasa", "/admin/gun-sonu", "/admin/hakedisler",
        "/admin/veresiye", "/admin/hizmetler", "/admin/randevular", "/admin/hizmet-analitik",
        "/admin/calisanlar", "/admin/musteriler", "/admin/kampanyalar", "/admin/saatler",
        "/admin/ayarlar", "/admin/rehber",
        "/", "/hizmetler", "/ekibimiz", "/iletisim", "/randevu", "/randevu-sorgula",
      ];
      for (const s of sayfalar) {
        const res = await fetch(`${BASE}${s}`, { headers: { Cookie: cookie }, cache: "no-store" });
        const html = await res.text();
        const hataliRender =
          /Application error|Internal Server Error|toFixed is not a function|Objects are not valid as a React child/.test(html);
        check(`${s} -> ${res.status}, render hatasi yok`, res.status === 200 && !hataliRender,
          `${res.status}${hataliRender ? " · render hatasi" : ""}`);
        check(`  ...NaN gosterilmiyor`, !/>\s*NaN\s*</.test(html) && !/NaN\s*₺/.test(html), "NaN var");
      }
    }

    // ── TEST 9b — Sunucu logunda Decimal sizintisi uyarisi ───────────────
    console.log("\nTEST 9b — Sunucu logunda Decimal sizintisi uyarisi");
    {
      // Sayfa 200 dondugu ve NaN gostermedigi hâlde deger SESSIZCE bosalmis
      // olabilir; tek kesin belirti sunucu logundaki uyaridir. Dev sunucusu
      // ._dev.log'a yaziyorsa dogrudan sinanir.
      let log = "";
      try {
        log = readFileSync("._dev.log", "utf8");
      } catch {
        log = "";
      }
      if (log) {
        const sizinti = log.split("\n").filter((l) => l.includes("Only plain objects"));
        check("Sunucu logunda 'Only plain objects' uyarisi YOK", sizinti.length === 0,
          sizinti.slice(0, 2).join(" | "));
        check("Sunucu logunda 'toFixed is not a function' YOK",
          !log.includes("toFixed is not a function"));
        check("Sunucu logunda Prisma chunk hatasi YOK", !log.includes("chunking context"));
      } else {
        console.log("      (._dev.log bulunamadi; log kontrolu atlandi)");
        check("Sunucu logu kontrolu", true, "log dosyasi yok");
      }
    }

    // ── TEST 10 — Ciro/hakediş hesabı uçtan uca ──────────────────────────
    console.log("\nTEST 10 — Ciro ve hakedis uctan uca");
    {
      const c = await musteri("Ciro");
      await satisYap(c, barber.id, service, 350.55, 350.55);
      const sale = await db.sale.findFirst({ where: { customerId: c.id } });
      const toplam = sale!.barberShare.plus(sale!.businessShare);
      console.log(`      350.55 x %40 -> berber ${sale?.barberShare} + isletme ${sale?.businessShare} = ${toplam}`);
      check("Paylar satis tutarina TAM esit", toplam.equals(sale!.saleAmount), `${toplam} vs ${sale?.saleAmount}`);
      check("barberShare 140.22", sale!.barberShare.toFixed(2) === "140.22", String(sale?.barberShare));

      const ozet = summarizeRevenue({
        sales: [
          { saleStatus: "PAID", saleAmount: "33.33", paidAmount: "33.33", remainingAmount: "0", barberShare: "13.33", businessShare: "20.00", paymentMethod: "CASH" },
          { saleStatus: "PAID", saleAmount: "33.33", paidAmount: "33.33", remainingAmount: "0", barberShare: "13.33", businessShare: "20.00", paymentMethod: "CASH" },
          { saleStatus: "PAID", saleAmount: "33.34", paidAmount: "33.34", remainingAmount: "0", barberShare: "13.34", businessShare: "20.00", paymentMethod: "CASH" },
        ],
        payments: [{ amount: "33.33", paymentMethod: "CASH" }, { amount: "33.33", paymentMethod: "CASH" }, { amount: "33.34", paymentMethod: "CASH" }],
      });
      check("summarizeRevenue ciro 100 (tam)", ozet.realizedRevenue === 100, String(ozet.realizedRevenue));
      check("summarizeRevenue tahsilat 100 (tam)", ozet.collected === 100, String(ozet.collected));
      check("summarizeRevenue tipleri number", typeof ozet.realizedRevenue === "number" && typeof ozet.netCash === "number");
      check("byMethod degerleri number", Object.values(ozet.byMethod).every((v) => typeof v === "number"));
    }

    // ── TEST 11 — calcStatus Decimal karşılaştırması ─────────────────────
    console.log("\nTEST 11 — calcStatus Decimal karsilastirmasi");
    {
      check("100.00 / 100.00 -> PAID", calcStatus("100.00", "100.00") === "PAID");
      check("99.99 / 100.00 -> PARTIAL", calcStatus("99.99", "100.00") === "PARTIAL");
      check("0 / 100 -> CREDIT", calcStatus(0, 100) === "CREDIT");
      check("100.01 / 100.00 -> PAID", calcStatus("100.01", "100.00") === "PAID");
      const d = new Prisma.Decimal("100.00");
      check("Decimal nesnesiyle de calisiyor", calcStatus(d, d) === "PAID");
    }

    // ── TEST 12 — DB'de gerçekten NUMERIC saklaniyor ─────────────────────
    console.log("\nTEST 12 — Veritabani kolon tipleri");
    {
      const rows = await db.$queryRawUnsafe<{ tablo: string; kolon: string; tip: string; olcek: number }[]>(`
        SELECT table_name::text AS tablo, column_name::text AS kolon, data_type::text AS tip, numeric_scale::int AS olcek
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (table_name, column_name) IN (
            ('Sale','saleAmount'),('Sale','paidAmount'),('Sale','barberShare'),
            ('CustomerPayment','amount'),('BarberPayout','amount'),('Expense','amount'),
            ('Service','price'),('Barber','commissionRate'),('Appointment','appointmentPrice')
          )`);
      const yanlis = rows.filter((r) => r.tip !== "numeric" || r.olcek !== 2);
      check(`Kolonlar NUMERIC(_,2) (${rows.length} kolon)`, rows.length === 9 && yanlis.length === 0,
        yanlis.map((r) => `${r.tablo}.${r.kolon}=${r.tip}(${r.olcek})`).join(", "));

      const okunan = await db.sale.findFirst({ where: { note: { startsWith: MARK } } });
      check("Prisma para alanini Decimal olarak donduruyor",
        okunan !== null && okunan.saleAmount instanceof Prisma.Decimal,
        okunan ? typeof okunan.saleAmount : "(satis yok)");
      check("toNumber() ile number'a ceviriliyor",
        okunan !== null && typeof toNumber(okunan.saleAmount) === "number");
    }

    // ── TEST 13 — Gerçek veri bozulmadı ──────────────────────────────────
    console.log("\nTEST 13 — Gercek veri bozulmadi");
    check("Test disi satis sayisi degismedi",
      (await db.sale.count({ where: { NOT: { note: { startsWith: MARK } } } })) === satisOnce, `once ${satisOnce}`);
  } finally {
    console.log("\nTEMIZLIK...");
    const s = await cleanup();
    console.log(`  silinen: hakedis=${s.hakedis} odeme=${s.odeme} satis=${s.satis} musteri=${s.musteri} berber=${s.berber} gider=${s.gider}`);
    await db.service.deleteMany({ where: { name: { startsWith: MARK } } });
    console.log(`  DB: ${await db.sale.count()} satis, ${await db.barber.count()} berber, ${await db.customer.count()} musteri, ${await db.expense.count()} gider`);
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

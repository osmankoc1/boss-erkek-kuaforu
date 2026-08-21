/**
 * Ciro için tek doğruluk kaynağı testi (FAZ 2 · Sıra 2).
 *
 * Çalıştırma (dev server ayakta olmalı):
 *   npx dotenv -e .env.local -- tsx scripts/verify-revenue-source.ts
 *
 * ÜRÜN KARARI (bu testin dayandığı kural):
 *   Gerçekleşen Ciro = Σ Sale.saleAmount   (VOID hariç, randevulu + walk-in)
 *   Tahsilat         = Σ Sale.paidAmount   (VOID hariç)
 *   Beklenen Gelir   = Σ Appointment.appointmentPrice — AYRI bir metrik,
 *                      "ciro" değildir.
 *
 * UYARI: Dev veritabanına test satışı/randevusu/müşterisi yazar ve sonunda
 * hepsini siler. Gerçek kayıtlara yalnızca OKUMA yapar.
 * Production endpoint'ine karşı çalışmayı reddeder.
 */
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { assertWritableTestDatabase } from "../lib/db-guard";
import { SignJWT } from "jose";
import { istanbulDateString, startOfIstanbulDay } from "../lib/tz";

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

const MARK = "ZZREVTEST";
const PHONES = ["05559990201", "05559990202", "05559990203", "05559990204"];
const GUN = istanbulDateString();

/** Senaryo tutarları — beklenen sonuçlar bunlardan türetilir. */
const RANDEVULU = { sale: 500, paid: 500 };
const WALKIN = { sale: 300, paid: 300 };
const VOID = { sale: 1000, paid: 1000 };
const VERESIYE = { sale: 400, paid: 150 };

const BEKLENEN_CIRO = RANDEVULU.sale + WALKIN.sale + VERESIYE.sale; // 1200
const BEKLENEN_TAHSILAT = RANDEVULU.paid + WALKIN.paid + VERESIYE.paid; // 950
const BEKLENEN_VERESIYE = VERESIYE.sale - VERESIYE.paid; // 250

let cookie = "";
const g = (u: string) => fetch(`${BASE}${u}`, { headers: { Cookie: cookie }, cache: "no-store" }).then((r) => r.json());

/**
 * Satış anında alınan para ödeme defterine de yazılır (FAZ 2 · Sıra 3).
 * Ürün kodu (`POST /api/cash`) bunu yapıyor; test doğrudan DB'ye yazdığı için
 * aynı kaydı burada da oluşturmak zorunda.
 */
async function defterYaz(saleId: string, customerId: string, amount: number, method: string, tarih: Date) {
  if (amount <= 0) return;
  await db.customerPayment.create({
    data: { customerId, saleId, amount, paymentMethod: method, paymentDate: tarih, note: "Satış anında tahsilat" },
  });
}

async function cleanup() {
  const custs = (await db.customer.findMany({ select: { id: true, fullName: true, phone: true } })).filter(
    (c) => c.fullName.startsWith(MARK) || PHONES.some((p) => c.phone === p || c.phone.endsWith(`_${p}`))
  );
  const ids = custs.map((c) => c.id);
  const saleIds = (await db.sale.findMany({ where: { OR: [{ customerId: { in: ids } }, { note: MARK }] }, select: { id: true } })).map((s) => s.id);
  const n = { satis: 0, kalem: 0, randevu: 0, musteri: 0 };
  if (saleIds.length) {
    await db.customerPayment.deleteMany({ where: { saleId: { in: saleIds } } });
    n.kalem = (await db.saleItem.deleteMany({ where: { saleId: { in: saleIds } } })).count;
    n.satis = (await db.sale.deleteMany({ where: { id: { in: saleIds } } })).count;
  }
  if (ids.length) {
    n.randevu = (await db.appointment.deleteMany({ where: { customerId: { in: ids } } })).count;
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

  const barber = await db.barber.findFirst({ select: { id: true, name: true, workerType: true, commissionRate: true } });
  const service = await db.service.findFirst({ select: { id: true, name: true } });
  if (!barber || !service) throw new Error("Berber veya hizmet yok.");

  // Gerçek veri anlık görüntüsü
  const gercekSatisOnce = await db.sale.count();
  const gercekRandevuOnce = await db.appointment.count();
  const gercekMusteriOnce = await db.customer.count();
  console.log(`  (mevcut gercek veri: ${gercekSatisOnce} satis, ${gercekRandevuOnce} randevu, ${gercekMusteriOnce} musteri)`);
  console.log(`  Test gunu: ${GUN}\n`);

  const saleDate = new Date();
  const apptDate = startOfIstanbulDay(GUN);

  try {
    // ── Senaryo verisi ────────────────────────────────────────────────────
    console.log("SENARYO KURULUMU");
    const ortak = {
      barberId: barber.id,
      barberName: barber.name,
      barberWorkerType: barber.workerType,
      barberCommissionRate: barber.commissionRate,
      serviceName: service.name,
      note: MARK,
      saleDate,
    };

    // 1) Randevulu satış
    const c1 = await db.customer.create({ data: { fullName: `${MARK} Randevulu`, phone: PHONES[0] } });
    const a1 = await db.appointment.create({
      data: {
        customerId: c1.id, barberId: barber.id, serviceId: service.id,
        date: apptDate, startTime: "09:00", endTime: "10:00",
        status: "completed", appointmentPrice: RANDEVULU.sale, notes: MARK,
      },
    });
    await db.sale.create({
      data: {
        ...ortak, appointmentId: a1.id, customerId: c1.id,
        customerName: c1.fullName, customerPhone: c1.phone,
        listedPrice: RANDEVULU.sale, saleAmount: RANDEVULU.sale, paidAmount: RANDEVULU.paid,
        remainingAmount: 0, saleStatus: "PAID", paymentMethod: "CASH",
        barberShare: 0, businessShare: RANDEVULU.sale,
      },
    });
    const s1 = await db.sale.findFirst({ where: { appointmentId: a1.id }, select: { id: true } });
    await defterYaz(s1!.id, c1.id, RANDEVULU.paid, "CASH", saleDate);
    console.log(`   randevulu satis   : ${RANDEVULU.sale} TL (tahsil ${RANDEVULU.paid})`);

    // 2) Walk-in (randevusuz) satış
    const c2 = await db.customer.create({ data: { fullName: `${MARK} WalkIn`, phone: PHONES[1] } });
    await db.sale.create({
      data: {
        ...ortak, customerId: c2.id,
        customerName: c2.fullName, customerPhone: c2.phone,
        listedPrice: WALKIN.sale, saleAmount: WALKIN.sale, paidAmount: WALKIN.paid,
        remainingAmount: 0, saleStatus: "PAID", paymentMethod: "CARD",
        barberShare: 0, businessShare: WALKIN.sale,
      },
    });
    const s2 = await db.sale.findFirst({ where: { customerId: c2.id }, select: { id: true } });
    await defterYaz(s2!.id, c2.id, WALKIN.paid, "CARD", saleDate);
    console.log(`   walk-in satis     : ${WALKIN.sale} TL (randevusuz)`);

    // 3) VOID satış — randevusu 'completed' KALIYOR (mevcut davranis)
    const c3 = await db.customer.create({ data: { fullName: `${MARK} Void`, phone: PHONES[2] } });
    const a3 = await db.appointment.create({
      data: {
        customerId: c3.id, barberId: barber.id, serviceId: service.id,
        date: apptDate, startTime: "11:00", endTime: "12:00",
        status: "completed", appointmentPrice: VOID.sale, notes: MARK,
      },
    });
    await db.sale.create({
      data: {
        ...ortak, appointmentId: a3.id, customerId: c3.id,
        customerName: c3.fullName, customerPhone: c3.phone,
        listedPrice: VOID.sale, saleAmount: VOID.sale, paidAmount: VOID.paid,
        remainingAmount: 0, saleStatus: "VOIDED", voidedAt: new Date(), voidReason: MARK,
        paymentMethod: "CASH", barberShare: 0, businessShare: VOID.sale,
      },
    });
    const s3 = await db.sale.findFirst({ where: { appointmentId: a3.id }, select: { id: true } });
    await defterYaz(s3!.id, c3.id, VOID.paid, "CASH", saleDate);
    console.log(`   VOID satis        : ${VOID.sale} TL (ciroya ve tahsilata girmemeli)`);

    // 4) Kısmi / veresiye satış
    const c4 = await db.customer.create({ data: { fullName: `${MARK} Veresiye`, phone: PHONES[3] } });
    await db.sale.create({
      data: {
        ...ortak, customerId: c4.id,
        customerName: c4.fullName, customerPhone: c4.phone,
        listedPrice: VERESIYE.sale, saleAmount: VERESIYE.sale, paidAmount: VERESIYE.paid,
        remainingAmount: BEKLENEN_VERESIYE, saleStatus: "PARTIAL", paymentMethod: "CASH",
        barberShare: 0, businessShare: VERESIYE.sale,
      },
    });
    const s4 = await db.sale.findFirst({ where: { customerId: c4.id }, select: { id: true } });
    await defterYaz(s4!.id, c4.id, VERESIYE.paid, "CASH", saleDate);
    console.log(`   veresiye satis    : ${VERESIYE.sale} TL (tahsil ${VERESIYE.paid}, kalan ${BEKLENEN_VERESIYE})`);
    console.log(`\n   BEKLENEN Gerceklesen Ciro : ${BEKLENEN_CIRO}`);
    console.log(`   BEKLENEN Tahsilat         : ${BEKLENEN_TAHSILAT}`);
    console.log(`   BEKLENEN Veresiye (kalan) : ${BEKLENEN_VERESIYE}`);

    // ── TEST 1 — Uçların Gerçekleşen Ciro değeri ──────────────────────────
    console.log("\nTEST 1 — Gerceklesen Ciro (tum uclar ayni olmali)");
    const summary = await g(`/api/cash/summary?date=${GUN}`);
    const dayEnd = await g(`/api/day-end?date=${GUN}`);
    const dash = await g(`/api/dashboard?range=custom&from=${GUN}&to=${GUN}`);

    const ciroSummary = summary.realizedRevenue ?? summary.totalSales;
    const ciroDayEnd = dayEnd.realizedRevenue ?? dayEnd.totalSales;
    const ciroDash = dash.revenue?.realized ?? dash.kasa?.todaySales ?? dash.revenue?.range;

    console.log(`      /api/cash/summary -> ${ciroSummary}`);
    console.log(`      /api/day-end      -> ${ciroDayEnd}`);
    console.log(`      /api/dashboard    -> ${ciroDash}`);

    check("cash/summary Gerceklesen Ciro dogru", ciroSummary === BEKLENEN_CIRO, `gelen ${ciroSummary}, beklenen ${BEKLENEN_CIRO}`);
    check("day-end Gerceklesen Ciro dogru", ciroDayEnd === BEKLENEN_CIRO, `gelen ${ciroDayEnd}, beklenen ${BEKLENEN_CIRO}`);
    check("dashboard Gerceklesen Ciro dogru", ciroDash === BEKLENEN_CIRO, `gelen ${ciroDash}, beklenen ${BEKLENEN_CIRO}`);
    check("UCU DE BIREBIR AYNI", ciroSummary === ciroDayEnd && ciroDayEnd === ciroDash,
      `${ciroSummary} / ${ciroDayEnd} / ${ciroDash}`);

    // ── TEST 2 — Tahsilat ─────────────────────────────────────────────────
    console.log("\nTEST 2 — Tahsilat (alinan para) tum uclarda ayni");
    const tahSummary = summary.collected ?? summary.totalPaid;
    const tahDayEnd = dayEnd.collected ?? dayEnd.totalPaid;
    const tahDash = dash.revenue?.collected ?? dash.kasa?.todayCollection;
    console.log(`      /api/cash/summary -> ${tahSummary}`);
    console.log(`      /api/day-end      -> ${tahDayEnd}`);
    console.log(`      /api/dashboard    -> ${tahDash}`);
    check("cash/summary Tahsilat dogru", tahSummary === BEKLENEN_TAHSILAT, `gelen ${tahSummary}`);
    check("day-end Tahsilat dogru", tahDayEnd === BEKLENEN_TAHSILAT, `gelen ${tahDayEnd}`);
    check("dashboard Tahsilat dogru", tahDash === BEKLENEN_TAHSILAT, `gelen ${tahDash}`);
    check("UCU DE BIREBIR AYNI", tahSummary === tahDayEnd && tahDayEnd === tahDash,
      `${tahSummary} / ${tahDayEnd} / ${tahDash}`);

    // ── TEST 3 — Ciro ve Tahsilat karışmıyor ──────────────────────────────
    console.log("\nTEST 3 — Ciro ile Tahsilat birbirine karismiyor");
    check("Ciro != Tahsilat (veresiye var)", ciroSummary !== tahSummary, `ikisi de ${ciroSummary}`);
    check("Ciro - Tahsilat = veresiye kalani", ciroSummary - tahSummary === BEKLENEN_VERESIYE,
      `fark ${ciroSummary - tahSummary}`);
    const veresiyeSummary = summary.credit ?? summary.totalCredit;
    check("cash/summary veresiye kalani dogru", veresiyeSummary === BEKLENEN_VERESIYE, `gelen ${veresiyeSummary}`);

    // ── TEST 4 — VOID satış ciroya girmiyor ───────────────────────────────
    console.log("\nTEST 4 — VOID satis gerceklesen ciroya girmiyor");
    check(`VOID tutari (${VOID.sale}) ciroya EKLENMEMIS`, ciroSummary === BEKLENEN_CIRO,
      `ciro ${ciroSummary} (VOID dahil olsaydi ${BEKLENEN_CIRO + VOID.sale})`);
    check("dashboard'da da VOID haric", ciroDash === BEKLENEN_CIRO,
      `dashboard ${ciroDash}`);
    check("voidedCount raporlaniyor", (summary.voidedCount ?? 0) >= 1, `gelen ${summary.voidedCount}`);

    // ── TEST 5 — Walk-in satış ciroya giriyor ─────────────────────────────
    console.log("\nTEST 5 — Walk-in (randevusuz) satis ciroya giriyor");
    check(`Walk-in tutari (${WALKIN.sale}) ciroda`, ciroSummary >= WALKIN.sale && ciroSummary === BEKLENEN_CIRO,
      `ciro ${ciroSummary} (walk-in haric olsaydi ${BEKLENEN_CIRO - WALKIN.sale})`);
    check("dashboard walk-in'i goruyor", ciroDash === BEKLENEN_CIRO,
      `dashboard ${ciroDash} (randevu tabanli olsaydi walk-in gorunmezdi)`);

    // ── TEST 6 — Beklenen Gelir ayrı metrik ───────────────────────────────
    console.log("\nTEST 6 — 'Beklenen Gelir' ayri metrik olarak var");
    const beklenenGelir = dash.expected?.range ?? dash.expectedRevenue?.range;
    console.log(`      dashboard Beklenen Gelir -> ${beklenenGelir}`);
    check("Beklenen Gelir alani mevcut", beklenenGelir !== undefined && beklenenGelir !== null,
      "dashboard yanitinda yok");
    check("Beklenen Gelir randevu tabanli (VOID randevusu dahil)",
      beklenenGelir === RANDEVULU.sale + VOID.sale,
      `gelen ${beklenenGelir}, beklenen ${RANDEVULU.sale + VOID.sale}`);
    check("Beklenen Gelir != Gerceklesen Ciro (kavramlar ayri)",
      beklenenGelir !== ciroDash, `ikisi de ${beklenenGelir}`);
    check("dashboard yanitinda 'revenue.total' (tum zamanlar randevu) ciro adiyla YOK",
      dash.revenue?.total === undefined, "hala 'Toplam Ciro' olarak duruyor");

    // ── TEST 7 — Berber payı ve gider tutarlılığı ─────────────────────────
    console.log("\nTEST 7 — Berber payi / isletme payi tum uclarda ayni");
    const bsSummary = summary.barberShare ?? summary.totalBarberShare;
    const bsDayEnd = dayEnd.barberShare ?? dayEnd.totalBarberShare;
    check("Berber payi ayni", bsSummary === bsDayEnd, `${bsSummary} / ${bsDayEnd}`);
    const isSummary = summary.businessShare ?? summary.totalBusinessShare;
    const isDayEnd = dayEnd.businessShare ?? dayEnd.totalBusinessShare;
    check("Isletme payi ayni", isSummary === isDayEnd, `${isSummary} / ${isDayEnd}`);
    check("Berber + isletme payi = ciro", Math.abs((bsSummary + isSummary) - ciroSummary) < 0.01,
      `${bsSummary} + ${isSummary} != ${ciroSummary}`);

    // ── TEST 8 — İşlem sayısı ─────────────────────────────────────────────
    console.log("\nTEST 8 — Islem sayisi (VOID haric) tum uclarda ayni");
    check("cash/summary islem sayisi >= 3", (summary.count ?? 0) >= 3, `gelen ${summary.count}`);
    check("day-end ile ayni", summary.count === dayEnd.count, `${summary.count} / ${dayEnd.count}`);

    // ── TEST 9 — EKRANLAR da ayni rakami gosteriyor ───────────────────────
    console.log("\nTEST 9 — Ekranlar (Kasa / Gun Sonu / Dashboard) ayni rakami gosteriyor");
    const html = async (u: string) => {
      const r = await fetch(`${BASE}${u}`, { headers: { Cookie: cookie }, cache: "no-store" });
      return { status: r.status, text: await r.text() };
    };
    const tutar = (n: number) => n.toFixed(2);
    const kasa = await html(`/admin/kasa?date=${GUN}`);
    const gunSonu = await html(`/admin/gun-sonu?date=${GUN}`);
    const dashboard = await html(`/admin/dashboard?range=today`);
    check("Kasa ekrani 200", kasa.status === 200, `gelen ${kasa.status}`);
    check("Gun Sonu ekrani 200", gunSonu.status === 200, `gelen ${gunSonu.status}`);
    check("Dashboard ekrani 200", dashboard.status === 200, `gelen ${dashboard.status}`);
    check(`Kasa ekraninda ciro ${tutar(BEKLENEN_CIRO)} gorunuyor`, kasa.text.includes(tutar(BEKLENEN_CIRO)),
      "bulunamadi");
    check(`Gun Sonu ekraninda ciro ${tutar(BEKLENEN_CIRO)} gorunuyor`, gunSonu.text.includes(tutar(BEKLENEN_CIRO)),
      "bulunamadi");
    check(`Kasa ekraninda tahsilat ${tutar(BEKLENEN_TAHSILAT)} gorunuyor`, kasa.text.includes(tutar(BEKLENEN_TAHSILAT)),
      "bulunamadi");
    check("Kasa ekraninda VOID tutari ciro olarak GORUNMUYOR",
      !kasa.text.includes(tutar(BEKLENEN_CIRO + VOID.sale)), "VOID dahil edilmis");
    check("Ekranlarda 'Gerceklesen Ciro' basligi var",
      kasa.text.includes("Gerçekleşen Ciro") && gunSonu.text.includes("Gerçekleşen Ciro"),
      "baslik yok");
    check("Dashboard'da 'Beklenen Gelir' bolumu var", dashboard.text.includes("Beklenen Gelir"), "yok");
    check("Dashboard'da 'Toplam Ciro' (randevu tabanli) etiketi YOK",
      !dashboard.text.includes("Toplam Ciro"), "hala duruyor");

    // ── TEST 10 — Gerçek veri bozulmadı ───────────────────────────────────
    console.log("\nTEST 10 — Gercek veri bozulmadi");
    const gercekDisiSatis = await db.sale.count({ where: { note: { not: MARK } } });
    check("Test disi satis sayisi degismedi", gercekDisiSatis === gercekSatisOnce, `once ${gercekSatisOnce}, simdi ${gercekDisiSatis}`);
  } finally {
    console.log("\nTEMIZLIK...");
    const n = await cleanup();
    console.log(`  silinen: satis=${n.satis} kalem=${n.kalem} randevu=${n.randevu} musteri=${n.musteri}`);
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

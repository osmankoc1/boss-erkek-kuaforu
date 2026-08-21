/**
 * VOID satışın yan etkilerini geri alması (FAZ 2 · Sıra 5).
 *
 * Çalıştırma (dev server ayakta olmalı):
 *   npx dotenv -e .env.local -- tsx scripts/verify-void-reversal.ts
 *
 * Satış oluşturulurken şu yan etkiler doğuyor:
 *   appointment.status = "completed"
 *   customer.completedCount += 1
 *   customer.lastVisitAt = saleDate
 *   CustomerPayment kaydı (peşin tahsilat)
 * VOID bunların hiçbirini geri almıyordu. Bu test her birini ayrı ayrı ölçer.
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

const MARK = "ZZVOIDTEST";
const PHONE_PREFIX = "0555999050";
const YANLIS_TUTAR = 900;
const DOGRU_TUTAR = 400;

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

const BUGUN = istanbulDateString();

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
    // ── Kurulum: randevulu satış ──────────────────────────────────────────
    console.log("KURULUM — randevulu satis (yanlis tutar girildi)");
    const cust = await db.customer.create({
      // Sayaclar artik gercek kayitlardan hesaplaniyor (FAZ 2 · Sira 7);
      // yapay baslangic degeri vermek anlamsiz olurdu.
      data: { fullName: `${MARK} Musteri`, phone: `${PHONE_PREFIX}1` },
    });
    const appt = await db.appointment.create({
      data: {
        customerId: cust.id, barberId: barber.id, serviceId: service.id,
        date: addIstanbulDays(new Date(), 0), startTime: "15:00", endTime: "16:00",
        status: "confirmed", appointmentPrice: YANLIS_TUTAR, notes: MARK,
      },
    });

    const created = await post("/api/cash", {
      appointmentId: appt.id, barberId: barber.id,
      customerName: cust.fullName, customerPhone: cust.phone,
      serviceName: service.name, serviceId: service.id,
      listedPrice: YANLIS_TUTAR, saleAmount: YANLIS_TUTAR, paidAmount: YANLIS_TUTAR,
      paymentMethod: "CASH", note: MARK,
    });
    const saleId = (created.body as { sale?: { id: string } }).sale?.id ?? "";
    check("Satis olusturuldu (201)", created.status === 201, `gelen ${created.status}`);
    if (!saleId) throw new Error("Satis id alinamadi.");

    const satisSonrasi = await db.customer.findUnique({
      where: { id: cust.id }, select: { completedCount: true, cancelledCount: true, lastVisitAt: true },
    });
    console.log(`   satis ${YANLIS_TUTAR} TL | completedCount 0 -> ${satisSonrasi?.completedCount}`);
    const ciroOnce = await get(`/api/cash/summary?date=${BUGUN}`);
    console.log(`   bugun ciro ${ciroOnce.realizedRevenue}, tahsilat ${ciroOnce.collected}`);

    // ── VOID ──────────────────────────────────────────────────────────────
    console.log("\nVOID — satis iptal ediliyor");
    const voided = await post(`/api/cash/${saleId}/void`, { voidReason: `${MARK} yanlis tutar` });
    check("Void istegi basarili (200)", voided.status === 200, `gelen ${voided.status}`);

    const voidSonrasi = await db.customer.findUnique({
      where: { id: cust.id }, select: { completedCount: true, cancelledCount: true, lastVisitAt: true },
    });
    const apptSonrasi = await db.appointment.findUnique({ where: { id: appt.id }, select: { status: true } });
    const odemeler = await db.customerPayment.findMany({ where: { saleId }, select: { amount: true, note: true } });
    const ciroSonra = await get(`/api/cash/summary?date=${BUGUN}`);

    // ── TEST 1 — Ciro ve tahsilat geri alındı mı ─────────────────────────
    console.log("\nTEST 1 — Ciro ve tahsilat");
    check("Ciro 0'a dondu", ciroSonra.realizedRevenue === 0, `gelen ${ciroSonra.realizedRevenue}`);
    check("Tahsilat 0'a dondu", ciroSonra.collected === 0, `gelen ${ciroSonra.collected}`);
    check("voidedCount 1", ciroSonra.voidedCount === 1, `gelen ${ciroSonra.voidedCount}`);

    // ── TEST 2 — Randevu durumu geri alındı mı ───────────────────────────
    console.log("\nTEST 2 — Randevu durumu");
    check("Randevu 'completed' DEGIL (yan etki geri alindi)", apptSonrasi?.status !== "completed",
      `durum hala '${apptSonrasi?.status}'`);

    // ── TEST 3 — Müşteri sayaçları geri alındı mı ────────────────────────
    console.log("\nTEST 3 — Musteri sayaclari");
    // Satistan once 0, satis sonrasi 1, void sonrasi tekrar 0 olmali:
    // randevu 'confirmed'a dondugu icin tamamlanmis randevu kalmiyor.
    check("Satis sonrasi completedCount 1 idi", satisSonrasi?.completedCount === 1,
      `gelen ${satisSonrasi?.completedCount}`);
    check("Void sonrasi completedCount 0'a dondu", voidSonrasi?.completedCount === 0,
      `gelen ${voidSonrasi?.completedCount}`);
    check("cancelledCount 0 (iptal edilmis randevu yok)", voidSonrasi?.cancelledCount === 0,
      `gelen ${voidSonrasi?.cancelledCount}`);
    const gercekCompleted = await db.appointment.count({
      where: { customerId: cust.id, status: "completed" },
    });
    check("I1 · completedCount == gercek completed randevu adedi",
      voidSonrasi?.completedCount === gercekCompleted,
      `sayac ${voidSonrasi?.completedCount} != gercek ${gercekCompleted}`);

    // ── TEST 4 — lastVisitAt geri alındı mı ──────────────────────────────
    console.log("\nTEST 4 — Son ziyaret tarihi");
    // Önceki değer saklanmadığı için "geri alma" ancak yeniden hesaplamayla
    // mümkün: kalan iptal edilmemiş satışlar + tamamlanmış randevular.
    // Bu müşterinin başkası yok → sonuç null olmalı. Kritik olan, void edilen
    // satışın tarihini artık GÖSTERMEMESİ.
    check("lastVisitAt artik void edilen satisin tarihini gostermiyor",
      voidSonrasi?.lastVisitAt?.getTime() !== satisSonrasi?.lastVisitAt?.getTime(),
      `hala ${voidSonrasi?.lastVisitAt?.toISOString()}`);
    check("lastVisitAt kalan kayitlardan yeniden hesaplandi (kayit yok -> null)",
      voidSonrasi?.lastVisitAt === null,
      `gelen ${voidSonrasi?.lastVisitAt?.toISOString() ?? String(voidSonrasi?.lastVisitAt)}`);

    // ── TEST 5 — Ödeme kayıtları ─────────────────────────────────────────
    console.log("\nTEST 5 — Odeme kayitlari (tahsil edilmis para)");
    const netOdeme = odemeler.reduce((s, p) => s + p.amount, 0);
    console.log(`      defterde ${odemeler.length} kayit, net ${netOdeme} TL`);
    for (const o of odemeler) console.log(`        ${o.amount} TL — ${o.note ?? "-"}`);
    check("Orijinal tahsilat kaydi denetim icin duruyor", odemeler.length >= 2,
      `defterde ${odemeler.length} kayit (orijinal + ters kayit beklenir)`);
    check("Ters kayit yazildi (negatif tutar)", odemeler.some((o) => o.amount < 0), "ters kayit yok");
    check("Defter neti 0 (para iade edildi)", Math.abs(netOdeme) < 0.01,
      `net ${netOdeme} — iptal edilen satisin parasi defterde duruyor`);
    const tersKayit = await db.customerPayment.findFirst({
      where: { saleId, amount: { lt: 0 } },
      select: { paymentDate: true },
    });
    check("Ters kayit VOID gunune yazildi (gecmis gun bozulmaz)",
      tersKayit !== null && istanbulDateString(tersKayit.paymentDate) === BUGUN,
      `tarih ${tersKayit ? istanbulDateString(tersKayit.paymentDate) : "yok"}`);

    // ── TEST 6 — Beklenen Gelir'den düştü mü ─────────────────────────────
    console.log("\nTEST 6 — Beklenen Gelir (randevu tabanli)");
    const dash = await get(`/api/dashboard?range=custom&from=${BUGUN}&to=${BUGUN}`);
    check("Beklenen Gelir'e void randevu dahil DEGIL", (dash.expected?.range ?? 0) === 0,
      `gelen ${dash.expected?.range}`);

    // ── TEST 7 — Void sonrası yeniden satış akışı ────────────────────────
    console.log("\nTEST 7 — Void sonrasi DOGRU tutarla yeniden satis");
    const yeniden = await post("/api/cash", {
      appointmentId: appt.id, barberId: barber.id,
      customerName: cust.fullName, customerPhone: cust.phone,
      serviceName: service.name, serviceId: service.id,
      listedPrice: DOGRU_TUTAR, saleAmount: DOGRU_TUTAR, paidAmount: DOGRU_TUTAR,
      paymentMethod: "CASH", note: MARK,
    });
    check("Yeniden satis kabul edildi (201)", yeniden.status === 201,
      `gelen ${yeniden.status} ${JSON.stringify(yeniden.body).slice(0, 90)}`);
    const sonSayac = await db.customer.findUnique({ where: { id: cust.id }, select: { completedCount: true } });
    check("completedCount net 1 (0 -> 1), cift saymadi", sonSayac?.completedCount === 1,
      `gelen ${sonSayac?.completedCount}`);
    const gercekSon = await db.appointment.count({
      where: { customerId: cust.id, status: "completed" },
    });
    check("  ...I1 hala gecerli", sonSayac?.completedCount === gercekSon,
      `sayac ${sonSayac?.completedCount} != gercek ${gercekSon}`);
    const ciroSon = await get(`/api/cash/summary?date=${BUGUN}`);
    check(`Ciro dogru tutara esit (${DOGRU_TUTAR})`, ciroSon.realizedRevenue === DOGRU_TUTAR,
      `gelen ${ciroSon.realizedRevenue}`);
    check(`Tahsilat dogru tutara esit (${DOGRU_TUTAR})`, ciroSon.collected === DOGRU_TUTAR,
      `gelen ${ciroSon.collected}`);

    // ── TEST 8 — İki kez void ────────────────────────────────────────────
    console.log("\nTEST 8 — Ayni satis iki kez void edilemez");
    const tekrar = await post(`/api/cash/${saleId}/void`, {});
    check("Ikinci void -> 400", tekrar.status === 400, `gelen ${tekrar.status}`);

    // ── TEST 9 — Gerçek veri bozulmadı ───────────────────────────────────
    console.log("\nTEST 9 — Gercek veri bozulmadi");
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

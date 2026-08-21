/**
 * Müşteri randevu sayaçlarının bütünlüğü (FAZ 2 · Sıra 7).
 *
 * Çalıştırma (dev server ayakta olmalı):
 *   npx dotenv -e .env.local -- tsx scripts/verify-customer-counters.ts
 *
 * ─── DEĞİŞMEZLER (invariants) ────────────────────────────────────────────
 * Bunlar ürün davranışından türetildi, varsayılmadı:
 *
 *   I1  completedCount  == o müşterinin status='completed' randevu adedi
 *   I2  cancelledCount  == o müşterinin status='cancelled' randevu adedi
 *   I3  totalAppointments == o müşteriye ait MEVCUT randevu adedi
 *   I4  lastVisitAt == max(tamamlanmış randevu tarihi, iptal edilmemiş
 *                          satış tarihi); hiçbiri yoksa null
 *
 * I1/I2 için sayaç, gerçek randevu sayımıyla birebir eşleşmeli: sayaç bir
 * hızlandırma önbelleğidir, ayrı bir gerçek değil.
 *
 * I3 ürün davranışıyla ayrıca sınanır: randevu silindiğinde sayaç düşüyor mu,
 * iptal edilen randevu sayılıyor mu — TEST 3 bunu ölçer ve kanıtlar.
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

const MARK = "ZZCOUNTTEST";
const PHONE_PREFIX = "0555999070";
const TUTAR = 300;

let cookie = "";
const post = (u: string, body: unknown) =>
  fetch(`${BASE}${u}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }));
const patch = (u: string, body: unknown) =>
  fetch(`${BASE}${u}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }));
const del = (u: string) =>
  fetch(`${BASE}${u}`, { method: "DELETE", headers: { Cookie: cookie } }).then(async (r) => ({
    status: r.status,
  }));

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
    await db.appointmentService.deleteMany({ where: { appointment: { customerId: { in: ids } } } });
    await db.notification.deleteMany({ where: { appointment: { customerId: { in: ids } } } });
    n.randevu = (await db.appointment.deleteMany({ where: { customerId: { in: ids } } })).count;
    n.musteri = (await db.customer.deleteMany({ where: { id: { in: ids } } })).count;
  }
  return n;
}

/** Sayaçları ve gerçek veriden hesaplanan değerleri yan yana getirir. */
async function olc(customerId: string) {
  const c = await db.customer.findUnique({
    where: { id: customerId },
    select: { totalAppointments: true, completedCount: true, cancelledCount: true, lastVisitAt: true },
  });
  const appts = await db.appointment.findMany({
    where: { customerId },
    select: { status: true, date: true },
  });
  const sales = await db.sale.findMany({
    where: { customerId, saleStatus: { not: "VOIDED" } },
    select: { saleDate: true },
  });
  const gercekCompleted = appts.filter((a) => a.status === "completed").length;
  const gercekCancelled = appts.filter((a) => a.status === "cancelled").length;
  const ziyaretAdaylari = [
    ...appts.filter((a) => a.status === "completed").map((a) => a.date.getTime()),
    ...sales.map((s) => s.saleDate.getTime()),
  ];
  return {
    sayac: c!,
    gercek: {
      total: appts.length,
      completed: gercekCompleted,
      cancelled: gercekCancelled,
      lastVisit: ziyaretAdaylari.length ? new Date(Math.max(...ziyaretAdaylari)) : null,
    },
  };
}

/** I1 + I2 değişmezlerini doğrular. */
async function degismezler(customerId: string, etiket: string) {
  const { sayac, gercek } = await olc(customerId);
  check(`${etiket} · I1 completedCount == gercek completed (${gercek.completed})`,
    sayac.completedCount === gercek.completed, `sayac ${sayac.completedCount}`);
  check(`${etiket} · I2 cancelledCount == gercek cancelled (${gercek.cancelled})`,
    sayac.cancelledCount === gercek.cancelled, `sayac ${sayac.cancelledCount}`);
  return { sayac, gercek };
}

let sira = 0;
async function musteriOlustur(ad: string) {
  sira += 1;
  return db.customer.create({ data: { fullName: `${MARK} ${ad}`, phone: `${PHONE_PREFIX}${sira}` } });
}

async function randevuOlustur(customerId: string, barberId: string, serviceId: string, status: string, gunOfset = 0, saat = "13:00") {
  return db.appointment.create({
    data: {
      customerId, barberId, serviceId,
      date: addIstanbulDays(new Date(), gunOfset),
      startTime: saat, endTime: "14:00",
      status, appointmentPrice: TUTAR, notes: MARK,
    },
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

  const barber = await db.barber.findFirst({ select: { id: true, name: true } });
  const service = await db.service.findFirst({ select: { id: true, name: true } });
  if (!barber || !service) throw new Error("Berber veya hizmet yok.");

  const satisOnce = await db.sale.count();
  console.log(`  (mevcut gercek veri: ${satisOnce} satis)\n`);

  try {
    // ── TEST 1 — Onaylama → tamamlama (PATCH yolu) ────────────────────────
    console.log("TEST 1 — Randevu onaylama ve tamamlama (PATCH)");
    {
      const c = await musteriOlustur("Patch");
      const a = await randevuOlustur(c.id, barber.id, service.id, "pending");
      await db.customer.update({ where: { id: c.id }, data: { totalAppointments: 1 } });

      const onay = await patch(`/api/appointments/${a.id}`, { status: "confirmed" });
      check("Onaylama -> 200", onay.status === 200, `gelen ${onay.status}`);
      await degismezler(c.id, "onay sonrasi");

      const tamam = await patch(`/api/appointments/${a.id}`, { status: "completed" });
      check("Tamamlama -> 200", tamam.status === 200, `gelen ${tamam.status}`);
      await degismezler(c.id, "tamamlama sonrasi");
    }

    // ── TEST 2 — İptal (PATCH yolu) ───────────────────────────────────────
    console.log("\nTEST 2 — Randevu iptali (PATCH)");
    {
      const c = await musteriOlustur("Iptal");
      const a = await randevuOlustur(c.id, barber.id, service.id, "confirmed");
      await db.customer.update({ where: { id: c.id }, data: { totalAppointments: 1 } });

      const r = await patch(`/api/appointments/${a.id}`, { status: "cancelled" });
      check("Iptal -> 200", r.status === 200, `gelen ${r.status}`);
      await degismezler(c.id, "iptal sonrasi");

      // Ayni gecisi tekrar gonder — idempotent olmali
      const tekrar = await patch(`/api/appointments/${a.id}`, { status: "cancelled" });
      check("Ayni gecis tekrar -> 409 (uc durum)", tekrar.status === 409, `gelen ${tekrar.status}`);
      await degismezler(c.id, "tekrar iptal sonrasi");
    }

    // ── TEST 3 — totalAppointments ürün davranışı (KANIT) ─────────────────
    console.log("\nTEST 3 — totalAppointments urun davranisi (I3 kanit)");
    {
      const c = await musteriOlustur("Total");
      const a1 = await randevuOlustur(c.id, barber.id, service.id, "confirmed", 1, "09:00");
      const a2 = await randevuOlustur(c.id, barber.id, service.id, "confirmed", 2, "10:00");
      await db.customer.update({ where: { id: c.id }, data: { totalAppointments: 2 } });

      const o1 = await olc(c.id);
      check(`Iki randevu -> total 2, gercek ${o1.gercek.total}`,
        o1.sayac.totalAppointments === o1.gercek.total, `sayac ${o1.sayac.totalAppointments}`);

      // Iptal edilince total dusuyor mu?
      await patch(`/api/appointments/${a1.id}`, { status: "cancelled" });
      const o2 = await olc(c.id);
      console.log(`      iptal sonrasi: sayac total=${o2.sayac.totalAppointments}, gercek kayit=${o2.gercek.total}`);
      check("Iptal edilen randevu kayitta duruyor (total degismemeli)",
        o2.sayac.totalAppointments === o2.gercek.total,
        `sayac ${o2.sayac.totalAppointments} != gercek ${o2.gercek.total}`);

      // Silinince total dusuyor mu?
      const silme = await del(`/api/appointments/${a2.id}`);
      check("Randevu silme -> 200", silme.status === 200, `gelen ${silme.status}`);
      const o3 = await olc(c.id);
      console.log(`      silme sonrasi: sayac total=${o3.sayac.totalAppointments}, gercek kayit=${o3.gercek.total}`);
      check("I3 · Silme sonrasi total gercek kayit sayisina esit",
        o3.sayac.totalAppointments === o3.gercek.total,
        `sayac ${o3.sayac.totalAppointments} != gercek ${o3.gercek.total}`);
      check("Silinen randevunun sayaclari da geri alindi",
        o3.sayac.cancelledCount === o3.gercek.cancelled,
        `cancelled sayac ${o3.sayac.cancelledCount} != gercek ${o3.gercek.cancelled}`);
    }

    // ── TEST 4 — Kasa satışı (cash POST yolu) ─────────────────────────────
    console.log("\nTEST 4 — Kasa satisi ile tamamlama");
    {
      const c = await musteriOlustur("Kasa");
      const a = await randevuOlustur(c.id, barber.id, service.id, "confirmed");
      await db.customer.update({ where: { id: c.id }, data: { totalAppointments: 1 } });

      const r = await post("/api/cash", {
        appointmentId: a.id, barberId: barber.id,
        customerName: c.fullName, customerPhone: c.phone,
        serviceName: service.name, serviceId: service.id,
        listedPrice: TUTAR, saleAmount: TUTAR, paidAmount: TUTAR,
        paymentMethod: "CASH", note: MARK,
      });
      check("Kasa kaydi -> 201", r.status === 201, `gelen ${r.status}`);
      await degismezler(c.id, "kasa sonrasi");
    }

    // ── TEST 5 — Önce PATCH completed, SONRA kasa kaydı (çift sayım riski) ─
    console.log("\nTEST 5 — PATCH ile tamamla, SONRA kasa kaydi gir (uzlastirma akisi)");
    {
      const c = await musteriOlustur("CiftSayim");
      const a = await randevuOlustur(c.id, barber.id, service.id, "confirmed");
      await db.customer.update({ where: { id: c.id }, data: { totalAppointments: 1 } });

      await patch(`/api/appointments/${a.id}`, { status: "completed" });
      const ara = await olc(c.id);
      console.log(`      PATCH sonrasi completedCount=${ara.sayac.completedCount}`);

      // Dashboard'daki "kasa kaydi eksik" akisi: completed randevuya kasa girilir
      const r = await post("/api/cash", {
        appointmentId: a.id, barberId: barber.id,
        customerName: c.fullName, customerPhone: c.phone,
        serviceName: service.name, serviceId: service.id,
        listedPrice: TUTAR, saleAmount: TUTAR, paidAmount: TUTAR,
        paymentMethod: "CASH", note: MARK,
      });
      check("Kasa kaydi -> 201 (Sira 4: completed izinli)", r.status === 201, `gelen ${r.status}`);
      const son = await olc(c.id);
      console.log(`      kasa sonrasi completedCount=${son.sayac.completedCount}, gercek completed=${son.gercek.completed}`);
      await degismezler(c.id, "cift sayim kontrolu");
    }

    // ── TEST 6 — Cron ile pending_verification iptali ─────────────────────
    console.log("\nTEST 6 — Cron 'pending_verification' iptali");
    {
      const c = await musteriOlustur("Cron");
      const a = await randevuOlustur(c.id, barber.id, service.id, "pending_verification");
      await db.appointment.update({
        where: { id: a.id },
        data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
      });
      await db.customer.update({ where: { id: c.id }, data: { totalAppointments: 1 } });

      const secret = process.env.CRON_SECRET ?? "";
      const r = await fetch(`${BASE}/api/cron/expire-unverified-appointments`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      const gelen = await r.json().catch(() => ({}));
      check("Cron calisti", r.status === 200, `gelen ${r.status} ${JSON.stringify(gelen).slice(0, 60)}`);
      const durum = await db.appointment.findUnique({ where: { id: a.id }, select: { status: true } });
      check("  ...randevu iptal edildi", durum?.status === "cancelled", `durum ${durum?.status}`);
      await degismezler(c.id, "cron iptali sonrasi");
    }

    // ── TEST 7 — VOID ve yeniden satış (Sıra 5 korunuyor mu) ──────────────
    console.log("\nTEST 7 — VOID ve yeniden satis (Sira 5 davranisi)");
    {
      const c = await musteriOlustur("Void");
      const a = await randevuOlustur(c.id, barber.id, service.id, "confirmed");
      await db.customer.update({ where: { id: c.id }, data: { totalAppointments: 1 } });

      const s1 = await post("/api/cash", {
        appointmentId: a.id, barberId: barber.id,
        customerName: c.fullName, customerPhone: c.phone,
        serviceName: service.name, serviceId: service.id,
        listedPrice: 900, saleAmount: 900, paidAmount: 900,
        paymentMethod: "CASH", note: MARK,
      });
      const saleId = (s1.body as { sale?: { id: string } }).sale?.id ?? "";
      await degismezler(c.id, "satis sonrasi");

      await post(`/api/cash/${saleId}/void`, { voidReason: MARK });
      const vd = await db.appointment.findUnique({ where: { id: a.id }, select: { status: true } });
      check("VOID sonrasi randevu 'confirmed' (Sira 5)", vd?.status === "confirmed", `durum ${vd?.status}`);
      await degismezler(c.id, "void sonrasi");

      const s2 = await post("/api/cash", {
        appointmentId: a.id, barberId: barber.id,
        customerName: c.fullName, customerPhone: c.phone,
        serviceName: service.name, serviceId: service.id,
        listedPrice: 400, saleAmount: 400, paidAmount: 400,
        paymentMethod: "CASH", note: MARK,
      });
      check("Yeniden satis -> 201", s2.status === 201, `gelen ${s2.status}`);
      await degismezler(c.id, "yeniden satis sonrasi");
      const son = await olc(c.id);
      check("VOID+yeniden satis sonrasi completedCount = 1 (cift saymadi)",
        son.sayac.completedCount === 1, `gelen ${son.sayac.completedCount}`);
    }

    // ── TEST 8 — Eşzamanlı durum geçişi ───────────────────────────────────
    console.log("\nTEST 8 — Eszamanli ayni durum gecisi (sayac cift artmamali)");
    {
      const c = await musteriOlustur("Eszaman");
      const a = await randevuOlustur(c.id, barber.id, service.id, "confirmed");
      await db.customer.update({ where: { id: c.id }, data: { totalAppointments: 1 } });

      const sonuclar = await Promise.all(
        Array.from({ length: 5 }, () => patch(`/api/appointments/${a.id}`, { status: "completed" }))
      );
      const basarili = sonuclar.filter((r) => r.status === 200).length;
      console.log(`      sonuclar: ${sonuclar.map((r) => r.status).join(", ")}`);
      check("Yalnizca 1 gecis basarili", basarili === 1, `${basarili} istek 200 dondu`);
      await degismezler(c.id, "eszamanli gecis sonrasi");
    }

    // ── TEST 9 — Müşteri birleştirme ──────────────────────────────────────
    console.log("\nTEST 9 — Musteri birlestirme (merge) sayaclari tasiyor mu");
    {
      const ana = await musteriOlustur("MergeAna");
      const ikincil = await musteriOlustur("MergeIkincil");
      const a1 = await randevuOlustur(ana.id, barber.id, service.id, "completed", 3, "09:00");
      const a2 = await randevuOlustur(ikincil.id, barber.id, service.id, "completed", 4, "10:00");
      const a3 = await randevuOlustur(ikincil.id, barber.id, service.id, "cancelled", 5, "11:00");
      void a1; void a2; void a3;
      await db.customer.update({ where: { id: ana.id }, data: { totalAppointments: 1, completedCount: 1 } });
      await db.customer.update({ where: { id: ikincil.id }, data: { totalAppointments: 2, completedCount: 1, cancelledCount: 1 } });

      const r = await post("/api/customers/merge", { primaryId: ana.id, secondaryId: ikincil.id });
      check("Birlestirme -> 200", r.status === 200, `gelen ${r.status}`);
      const o = await olc(ana.id);
      console.log(`      ana musteri: sayac(c=${o.sayac.completedCount}, x=${o.sayac.cancelledCount}, t=${o.sayac.totalAppointments})`);
      console.log(`                   gercek(c=${o.gercek.completed}, x=${o.gercek.cancelled}, t=${o.gercek.total})`);
      await degismezler(ana.id, "birlestirme sonrasi");
      check("I3 · birlestirme sonrasi total dogru",
        o.sayac.totalAppointments === o.gercek.total,
        `sayac ${o.sayac.totalAppointments} != gercek ${o.gercek.total}`);
    }

    // ── TEST 10 — lastVisitAt değişmezi (I4) ──────────────────────────────
    console.log("\nTEST 10 — I4 lastVisitAt degismezi");
    {
      const hepsi = await db.customer.findMany({
        where: { fullName: { startsWith: MARK } },
        select: { id: true, fullName: true },
      });
      let uyumsuz = 0;
      for (const c of hepsi) {
        const o = await olc(c.id);
        const s = o.sayac.lastVisitAt?.getTime() ?? null;
        const g = o.gercek.lastVisit?.getTime() ?? null;
        if (s !== g) {
          uyumsuz += 1;
          console.log(`      ${c.fullName}: sayac=${o.sayac.lastVisitAt?.toISOString() ?? "null"} gercek=${o.gercek.lastVisit?.toISOString() ?? "null"}`);
        }
      }
      check(`I4 · tum test musterilerinde lastVisitAt tutarli (${hepsi.length} musteri)`,
        uyumsuz === 0, `${uyumsuz} musteride sapma`);
    }

    // ── TEST 11 — Gerçek veri bozulmadı ───────────────────────────────────
    console.log("\nTEST 11 — Gercek veri bozulmadi");
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

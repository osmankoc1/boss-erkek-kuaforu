/**
 * Denetim izi ve para atfı — MEVCUT DURUM KANITI (FAZ 2 · Sıra 10).
 *
 * Çalıştırma (dev server ayakta olmalı):
 *   npx dotenv -e .env.local -- tsx scripts/verify-audit-trail.ts
 *
 * Bu test bir ÖLÇÜM aracıdır: Sıra 10 kapsamındaki beş konuyu mevcut sistem
 * üzerinde sınar. BAZI KONTROLLERİN BAŞARISIZ OLMASI BEKLENİR — açıkları
 * kanıtlamak için yazıldı, ürünü doğrulamak için değil.
 *
 *   1. Denetim izi        — bir kaydı KİMİN değiştirdiği yazılıyor mu
 *   2. Satış düzenleme    — eski tutar geri getirilebiliyor mu
 *   3. byMethod atfı      — ödeme yöntemi kırılımı doğru mu
 *   4. pendingKasa + VOID — iptalden sonra "kasa kaydı eksik" uyarısı doğru mu
 *   5. İndirim izleme     — listedPrice ile saleAmount farkı raporlanıyor mu
 *
 * UYARI: Dev veritabanına test verisi yazar ve sonunda siler.
 * Production endpoint'ine karşı çalışmayı reddeder.
 */
import { readFileSync, readdirSync } from "node:fs";
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

const MARK = "ZZAUDITTEST";
const PHONE_PREFIX = "0555999110";
const BUGUN = istanbulDateString();
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

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
const patch = (u: string, body: unknown): Promise<Yanit> =>
  fetch(`${BASE}${u}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }));

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
  const say = { odeme: 0, satis: 0, randevu: 0, musteri: 0, berber: 0 };
  if (saleIds.length) {
    say.odeme = (await db.customerPayment.deleteMany({ where: { saleId: { in: saleIds } } })).count;
    await db.saleItem.deleteMany({ where: { saleId: { in: saleIds } } });
    say.satis = (await db.sale.deleteMany({ where: { id: { in: saleIds } } })).count;
  }
  if (ids.length) {
    await db.customerPayment.deleteMany({ where: { customerId: { in: ids } } });
    await db.appointmentService.deleteMany({ where: { appointment: { customerId: { in: ids } } } });
    await db.notification.deleteMany({ where: { appointment: { customerId: { in: ids } } } });
    say.randevu = (await db.appointment.deleteMany({ where: { customerId: { in: ids } } })).count;
    say.musteri = (await db.customer.deleteMany({ where: { id: { in: ids } } })).count;
  }
  if (barberIds.length) {
    await db.barberPayout.deleteMany({ where: { barberId: { in: barberIds } } });
    await db.appointment.deleteMany({ where: { barberId: { in: barberIds } } });
    await db.workingHour.deleteMany({ where: { barberId: { in: barberIds } } });
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
  paidAmount: number,
  extra: Record<string, unknown> = {}
) {
  const r = await post("/api/cash", {
    customerId: c.id, barberId,
    customerName: c.fullName, customerPhone: c.phone,
    serviceName: service.name, serviceId: service.id,
    listedPrice: saleAmount, saleAmount, paidAmount,
    paymentMethod: "CASH", note: MARK, ...extra,
  });
  return { saleId: (r.body as { sale?: { id: string } }).sale?.id ?? "", status: r.status };
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

  try {
    // ── KONU 1 — Denetim izi: kaydı KİM değiştirdi ───────────────────────
    console.log("KONU 1 — Denetim izi (kim yapti?)");
    {
      const sema = readFileSync("prisma/schema.prisma", "utf8");
      const govde = sema.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("///")).join("\n");

      check("Ayri bir denetim/gecmis tablosu var", /model\s+(Audit|AuditLog|ChangeLog|History)/i.test(govde),
        "boyle bir model yok");

      const paraModelleri = ["Sale", "CustomerPayment", "BarberPayout", "Expense"];
      const aktorsuz: string[] = [];
      for (const m of paraModelleri) {
        const blok = govde.slice(govde.indexOf(`model ${m} {`));
        const govdeBlok = blok.slice(0, blok.indexOf("\n}"));
        if (!/\b(userId|createdBy|updatedBy|performedBy|actorId)\b/.test(govdeBlok)) aktorsuz.push(m);
      }
      check(`Para modellerinde aktor alani var (${paraModelleri.join(", ")})`,
        aktorsuz.length === 0, `aktor alani YOK: ${aktorsuz.join(", ")}`);

      check("User modeline referans veren baska model var",
        /User\s+@relation|user\s+User/.test(govde), "User modeline hicbir model baglanmiyor");

      // Gercek bir islem yapip iz araniyor.
      const c = await musteri("Aktor");
      const { saleId } = await satisYap(c, barber.id, service, 500, 500);
      const sale = await db.sale.findUnique({ where: { id: saleId } });
      const alanlar = sale ? Object.keys(sale) : [];
      const izAlani = alanlar.filter((a) => /user|by|actor|admin/i.test(a));
      console.log(`      Sale alanlari: ${alanlar.join(", ")}`);
      check("Olusturulan satista islemi yapan kisi kayitli",
        izAlani.length > 0, "hicbir alan islemi yapani gostermiyor");
    }

    // ── KONU 2 — Satış düzenleme geçmişi ─────────────────────────────────
    console.log("\nKONU 2 — Satis duzenleme gecmisi");
    {
      const c = await musteri("Duzenleme");
      // Tutarlar bilerek AYRI secildi: eski saleAmount (1000) baska bir
      // alanda tesadufen gorunmesin, arama yaniltici olmasin.
      const { saleId } = await satisYap(c, barber.id, service, 1000, 300);
      const once = await db.sale.findUnique({ where: { id: saleId } });
      console.log(`      duzenleme oncesi: saleAmount=${once?.saleAmount} barberShare=${once?.barberShare} note="${once?.note}"`);

      const r = await patch(`/api/cash/${saleId}`, { saleAmount: 700, note: "duzeltildi" });
      check("Satis duzenlenebiliyor -> 200", r.status === 200, `gelen ${r.status}`);

      const sonra = await db.sale.findUnique({ where: { id: saleId } });
      console.log(`      duzenleme sonrasi: saleAmount=${sonra?.saleAmount} barberShare=${sonra?.barberShare} note="${sonra?.note}"`);

      // YAPISAL kontrol: onceki degeri saklayabilecek bir yer var mi?
      // (Metin icinde sayi aramak yaniltici: "400" remainingAmount'ta,
      //  "1000" bir tarih ya da cuid icinde tesadufen gorunebiliyor.)
      const semaGovde = readFileSync("prisma/schema.prisma", "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("///"))
        .join("\n");
      const saleBlok = semaGovde.slice(semaGovde.indexOf("model Sale {"));
      const saleAlanlari = saleBlok.slice(0, saleBlok.indexOf("\n}"));
      const oncekiDegerAlani = /(previous|former|old|onceki|eski)\w*/i.test(saleAlanlari);
      const gecmisTablosu = /model\s+\w*(History|Revision|Version|Audit)\w*\s*\{/i.test(semaGovde);

      check("Onceki satis tutarini saklayan bir alan ya da tablo var",
        oncekiDegerAlani || gecmisTablosu,
        `Sale'de onceki-deger alani yok, gecmis tablosu yok — 1000 -> ${sonra?.saleAmount} degisimi geri getirilemez`);

      check("Hakedis geriye donuk degisti; eski degeri saklayan yer var",
        oncekiDegerAlani || gecmisTablosu,
        `hakedis ${once?.barberShare} -> ${sonra?.barberShare} sessizce degisti, eski deger hicbir yerde yok`);

      check("Kullanicinin notu duzenlemede korundu",
        (sonra?.note ?? "").includes(MARK), `note "${sonra?.note}" — orijinal not ezildi`);

      // AYRI senaryo: satis tutari, tahsil edilmis paranin ALTINA cekilirse.
      const c3 = await musteri("Negatif");
      const s3 = await satisYap(c3, barber.id, service, 1000, 1000);
      await patch(`/api/cash/${s3.saleId}`, { saleAmount: 400 });
      const neg = await db.sale.findUnique({ where: { id: s3.saleId } });
      console.log(`      1000 tahsil edilmis satis 400'e cekildi -> remainingAmount=${neg?.remainingAmount} saleStatus=${neg?.saleStatus}`);
      check("Satis tutari tahsilatin ALTINA cekilince kalan negatife dusmuyor",
        n(neg?.remainingAmount) >= 0,
        `remainingAmount=${neg?.remainingAmount} — musteri ${Math.abs(n(neg?.remainingAmount))} TL fazla odemis, iade izi yok`);

      const izler = await db.customerPayment.findMany({ where: { saleId }, orderBy: { createdAt: "asc" } });
      console.log(`      odeme defteri: ${izler.map((p) => `${p.amount}(${p.note})`).join(", ")}`);
      const defterToplam = izler.reduce((t, p) => t + n(p.amount), 0);
      check("Odeme defteri toplami = sale.paidAmount",
        defterToplam === n(sonra?.paidAmount), `defter ${defterToplam} vs paidAmount ${sonra?.paidAmount}`);

      // AYRI durum: paidAmount degistiginde duzeltme satiri yaziliyor mu
      const c2 = await musteri("Duzenleme2");
      const s2 = await satisYap(c2, barber.id, service, 200, 200);
      await patch(`/api/cash/${s2.saleId}`, { paidAmount: 150 });
      const izler2 = await db.customerPayment.findMany({ where: { saleId: s2.saleId } });
      console.log(`      paidAmount duzenlemesi defteri: ${izler2.map((p) => `${p.amount}(${p.note})`).join(", ")}`);
      check("Tahsilat farki icin duzeltme satiri yazildi (bu CALISIYOR)",
        izler2.some((p) => (p.note ?? "").includes("düzenlemesi")), "duzeltme satiri yok");
    }

    // ── KONU 3 — byMethod atfı ───────────────────────────────────────────
    console.log("\nKONU 3 — Odeme yontemi (byMethod) atfi");
    {
      const c = await musteri("Yontem");
      // Satis 300: 100'u NAKIT pesin
      const { saleId } = await satisYap(c, barber.id, service, 300, 100);
      // Kalan 200 KART ile tahsil ediliyor
      const od = await post("/api/debts/payment", {
        saleId, customerId: c.id, amount: 200, paymentMethod: "CARD",
      });
      check("Kalan 200 KART ile tahsil edildi", od.status === 201, `gelen ${od.status}`);

      // Gun ozeti ayni gunun diger test satislarini da icerir; olcum
      // kirlenmesin diye YALNIZCA bu satisin defter satirlari toplanir.
      const yontemKirilimi = async () => {
        const rows = await db.customerPayment.findMany({ where: { saleId }, select: { amount: true, paymentMethod: true } });
        const m: Record<string, number> = {};
        for (const r of rows) m[r.paymentMethod] = Math.round(((m[r.paymentMethod] ?? 0) + n(r.amount)) * 100) / 100;
        return m;
      };

      const oncesi = await yontemKirilimi();
      console.log(`      VOID oncesi byMethod (bu satis): ${JSON.stringify(oncesi)}`);
      check("VOID oncesi CASH=100", n(oncesi.CASH) === 100, `${oncesi.CASH}`);
      check("VOID oncesi CARD=200", n(oncesi.CARD) === 200, `${oncesi.CARD}`);

      await post(`/api/cash/${saleId}/void`, { voidReason: MARK });

      const sonrasi = await yontemKirilimi();
      const toplam = Object.values(sonrasi).reduce((a, b) => a + b, 0);
      console.log(`      VOID sonrasi byMethod (bu satis): ${JSON.stringify(sonrasi)}`);
      console.log(`      VOID sonrasi toplam: ${toplam}`);

      check("VOID sonrasi TOPLAM tahsilat 0 (bu CALISIYOR)", toplam === 0, `${toplam}`);
      check("VOID sonrasi CASH 0'a dondu", n(sonrasi.CASH) === 0, `${sonrasi.CASH}`);
      check("VOID sonrasi CARD 0'a dondu", n(sonrasi.CARD) === 0, `${sonrasi.CARD}`);

      const ters = await db.customerPayment.findFirst({
        where: { saleId, amount: { lt: 0 } },
        select: { amount: true, paymentMethod: true },
      });
      console.log(`      ters kayit: ${ters?.amount} (${ters?.paymentMethod})`);
      check("Ters kayit yontemlere DAGITILDI (tek yonteme yuklenmedi)",
        n(ters?.amount) === 0 || ters === null,
        `tek satirda ${ters?.amount} ${ters?.paymentMethod} — orijinal yontem kirilimi korunmuyor`);
    }

    // ── KONU 4 — pendingKasa ve VOID ─────────────────────────────────────
    console.log("\nKONU 4 — pendingKasa uyarisi ve VOID");
    {
      const c = await musteri("Pending");
      const appt = await db.appointment.create({
        data: {
          customerId: c.id, barberId: barber.id, serviceId: service.id,
          date: addIstanbulDays(new Date(), 0), startTime: "14:00", endTime: "15:00",
          status: "confirmed", appointmentPrice: 400, notes: MARK,
        },
      });

      const pendingSayisi = () => db.appointment.count({ where: { status: "completed", sales: { none: {} } } });
      const gercekEksik = () =>
        db.appointment.count({ where: { status: "completed", sales: { none: { saleStatus: { not: "VOIDED" } } } } });

      const r = await post("/api/cash", {
        appointmentId: appt.id, barberId: barber.id,
        customerName: c.fullName, customerPhone: c.phone,
        serviceName: service.name, serviceId: service.id,
        listedPrice: 400, saleAmount: 400, paidAmount: 400,
        paymentMethod: "CASH", note: MARK,
      });
      const saleId = (r.body as { sale?: { id: string } }).sale?.id ?? "";
      check("Randevudan satis olustu -> 201", r.status === 201, `gelen ${r.status}`);

      await post(`/api/cash/${saleId}/void`, { voidReason: MARK });
      const voidSonrasi = await db.appointment.findUnique({ where: { id: appt.id }, select: { status: true } });
      check("VOID sonrasi randevu 'confirmed'a dondu (Sira 5 — CALISIYOR)",
        voidSonrasi?.status === "confirmed", `${voidSonrasi?.status}`);

      // Operator randevuyu yeniden 'completed' yapiyor (mesru akis).
      await patch(`/api/appointments/${appt.id}`, { status: "completed" });
      const yeniden = await db.appointment.findUnique({ where: { id: appt.id }, select: { status: true } });
      check("Randevu yeniden 'completed' yapilabildi", yeniden?.status === "completed", `${yeniden?.status}`);

      const mevcutSorgu = await pendingSayisi();
      const dogruSorgu = await gercekEksik();
      console.log(`      mevcut pendingKasa sorgusu : ${mevcutSorgu}`);
      console.log(`      VOID'i dislayan dogru sorgu: ${dogruSorgu}`);
      check("pendingKasa bu randevuyu 'kasa kaydi eksik' olarak sayiyor",
        mevcutSorgu >= 1, `sayilmadi — VOIDED satis 'sales: none' kosulunu bozuyor`);

      const yeniden2 = await post("/api/cash", {
        appointmentId: appt.id, barberId: barber.id,
        customerName: c.fullName, customerPhone: c.phone,
        serviceName: service.name, serviceId: service.id,
        listedPrice: 400, saleAmount: 400, paidAmount: 400,
        paymentMethod: "CASH", note: MARK,
      });
      check("VOID sonrasi yeniden kasa kaydi girilebiliyor (CALISIYOR)",
        yeniden2.status === 201, `gelen ${yeniden2.status}`);
    }

    // ── KONU 5 — İndirim izleme ──────────────────────────────────────────
    console.log("\nKONU 5 — Indirim izleme (listedPrice - saleAmount)");
    {
      const c = await musteri("Indirim");
      // Liste 500, satis 400 -> 100 TL indirim
      const { saleId, status } = await satisYap(c, barber.id, service, 400, 400, { listedPrice: 500 });
      check("Indirimli satis olustu -> 201", status === 201, `gelen ${status}`);

      const sale = await db.sale.findUnique({ where: { id: saleId } });
      console.log(`      listedPrice=${sale?.listedPrice} saleAmount=${sale?.saleAmount} -> indirim ${n(sale?.listedPrice) - n(sale?.saleAmount)}`);
      check("Indirim verisi DB'de saklandi (bu CALISIYOR)",
        n(sale?.listedPrice) === 500 && n(sale?.saleAmount) === 400,
        `listedPrice=${sale?.listedPrice}`);

      // Raporlarda indirim var mi
      const uclar = [`/api/cash/summary?date=${BUGUN}`, `/api/day-end?date=${BUGUN}`, "/api/commissions?range=today"];
      const bulunanlar: string[] = [];
      for (const u of uclar) {
        const body = JSON.stringify(await get(u));
        if (/discount|indirim|listedPrice|iskonto/i.test(body)) bulunanlar.push(u);
      }
      check("Raporlarda indirim alani var", bulunanlar.length > 0,
        `hicbir rapor ucunda indirim yok (${uclar.length} uc tarandi)`);

      // Ekranlarda
      const tsx: string[] = [];
      const gez = (dir: string) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (e.name === "node_modules" || e.name === ".next" || e.name === "generated") continue;
          const tam = `${dir}/${e.name}`;
          if (e.isDirectory()) gez(tam);
          else if (e.name.endsWith(".tsx")) tsx.push(tam);
        }
      };
      gez("app");
      // "Indirim" kelimesi kampanya basligi ORNEGINDE ve yardim metninde de
      // geciyor; bunlar veri gostermez. Gercek gosterim icin `listedPrice`
      // alanina erisim aranir.
      const ekranlar = tsx.filter((f) => /listedPrice/.test(readFileSync(f, "utf8")));
      check(`Herhangi bir ekranda indirim GOSTERILIYOR (${tsx.length} tsx tarandi)`,
        ekranlar.length > 0, "hicbir ekran listedPrice okumuyor — indirim gorunmez");
    }
  } finally {
    console.log("\nTEMIZLIK...");
    const s = await cleanup();
    console.log(`  silinen: odeme=${s.odeme} satis=${s.satis} randevu=${s.randevu} musteri=${s.musteri} berber=${s.berber}`);
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

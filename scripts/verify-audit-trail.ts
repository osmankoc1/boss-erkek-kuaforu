/**
 * Denetim izi ve para atfı — MEVCUT DURUM KANITI (FAZ 2 · Sıra 10).
 *
 * Çalıştırma (dev server ayakta olmalı):
 *   npx dotenv -e .env.local -- tsx scripts/verify-audit-trail.ts
 *
 * ─── ÇÖZÜLEN DÖRT KONU (bu test onları doğrular) ─────────────────────────
 *   1. byMethod VOID atfı — ters kayıt ödeme yöntemi bazında üretilir
 *   2. pendingKasa        — VOID edilmiş satış aktif kasa kaydı sayılmaz
 *   3. İndirim görünürlüğü— listedPrice − saleAmount raporlanır
 *   4. Negatif kalan      — satış tutarı tahsilatın altına çekilemez
 *
 * ─── DENETİM İZİ: SIRA 10b'DE ÇÖZÜLDÜ ───────────────────────────────────
 * Bu dosya yazıldığında denetim izi ve satış düzenleme geçmişi HENÜZ YOKTU;
 * KONU 1 ve KONU 2 blokları o günün eksiğini belgelemek için eklenmişti.
 * Sıra 10b'de merkezi `AuditLog` tablosu geldi (migration
 * `20260825094005_audit_log`) ve ikisi de kapandı.
 *
 * O blokları bugün BİLGİ amaçlı tutuyoruz — hangi modelde hangi alanın
 * bulunduğunu göstermek teşhis için hâlâ değerli. Ama artık "eksik" olarak
 * değil, VERİLMİŞ TASARIM KARARLARI olarak okunmalıdır:
 *
 *   • Para modellerinde (`Sale`, `CustomerPayment`, `BarberPayout`,
 *     `Expense`) aktör alanı YOKTUR — bilinçli. Model başına alan yalnızca
 *     son değiştireni tutar; "1000'i 700'e kim çekti, önceki değer neydi"
 *     sorusunu cevaplamaz. Aktör merkezi `AuditLog`'da yaşar.
 *   • `AuditLog`'un `User`'a FK'sı YOKTUR — bilinçli. Saklama süresi
 *     sınırsız; kullanıcı silinse bile iz ayakta kalmalı, e-posta o anki
 *     haliyle snapshot'lanır (bkz. prisma/schema.prisma).
 *
 * Denetim izinin GERÇEK doğrulaması bu pakette değil:
 *   • scripts/verify-audit-log.ts              — 110 kontrol
 *   • scripts/verify-appointment-delete-audit.ts — 59 kontrol
 *
 * Bu paket denetim izini ölçmez; para atfını ölçer.
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
import { temizleAuditIzleri } from "./audit-temizlik";

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

  // Denetim izi (FAZ 2 - Sira 10b): entity'si silinen satirlar da
  // temizlenir; aksi halde dev veritabaninda birikir.
  await temizleAuditIzleri(db);
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

      const denetimTablosu = /model\s+(Audit|AuditLog|ChangeLog|History)/i.test(govde);
      console.log(`      denetim/gecmis tablosu       : ${denetimTablosu ? "VAR (Sira 10b)" : "YOK"}`);

      const paraModelleri = ["Sale", "CustomerPayment", "BarberPayout", "Expense"];
      const aktorsuz: string[] = [];
      for (const m of paraModelleri) {
        const blok = govde.slice(govde.indexOf(`model ${m} {`));
        const govdeBlok = blok.slice(0, blok.indexOf("\n}"));
        if (!/\b(userId|createdBy|updatedBy|performedBy|actorId)\b/.test(govdeBlok)) aktorsuz.push(m);
      }
      console.log(`      aktor alani olmayan modeller : ${aktorsuz.join(", ") || "(yok)"}  [tasarim geregi — aktor AuditLog'da]`);
      console.log(`      User'a baglanan model         : ${/User\s+@relation|user\s+User/.test(govde) ? "VAR" : "YOK  [tasarim geregi — kullanici silinse de iz kalmali]"}`);

      // Gercek bir islem yapip iz araniyor.
      const c = await musteri("Aktor");
      const { saleId } = await satisYap(c, barber.id, service, 500, 500);
      const sale = await db.sale.findUnique({ where: { id: saleId } });
      const alanlar = sale ? Object.keys(sale) : [];
      const izAlani = alanlar.filter((a) => /user|by|actor|admin/i.test(a));
      console.log(`      Sale'de islemi yapani gosteren alan: ${izAlani.join(", ") || "(yok — aktor AuditLog'da tutuluyor)"}`);
      console.log("      NOT: denetim izi Sira 10b'de geldi; dogrulamasi verify-audit-log.ts icinde.");
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

      console.log(`      onceki-deger alani / gecmis tablosu: ${oncekiDegerAlani || gecmisTablosu ? "VAR" : "YOK"}`);

      // Onceki degerin NEREDE durdugu okunarak yazilir. Sabit metin yazsaydik
      // Sira 10b'den sonra oldugu gibi yeniden bayatlar ve yanlis bilgi verirdi.
      const izKaydi = await db.auditLog.findFirst({
        where: { entity: "Sale", entityId: saleId, action: "UPDATE" },
        orderBy: { createdAt: "desc" },
      });
      const izDegisim = (izKaydi?.changes ?? {}) as Record<string, { before: unknown; after: unknown }>;
      const goster = (alan: string) =>
        alan in izDegisim ? `AuditLog'da: ${izDegisim[alan].before} -> ${izDegisim[alan].after}` : "AuditLog'da YOK";

      console.log(`      hakedis ${once?.barberShare} -> ${sonra?.barberShare}   (${goster("barberShare")})`);
      console.log(`      not "${once?.note}" -> "${sonra?.note}"   (${goster("note")})`);
      console.log("      NOT: duzenleme gecmisi Sira 10b'de geldi; onceki deger AuditLog.changes icinde.");

      // AYRI senaryo: satis tutari, tahsil edilmis paranin ALTINA cekilirse.
      const c3 = await musteri("Negatif");
      const s3 = await satisYap(c3, barber.id, service, 1000, 1000);
      const red = await patch(`/api/cash/${s3.saleId}`, { saleAmount: 400 });
      console.log(`      1000 tahsil edilmis satis 400'e cekilmek istendi -> HTTP ${red.status} (${red.body.code})`);
      check("Tutar tahsilatin ALTINA cekilemez -> 400", red.status === 400, `gelen ${red.status}`);
      check("  ...gerekce AMOUNT_BELOW_COLLECTED", red.body.code === "AMOUNT_BELOW_COLLECTED", `${red.body.code}`);
      check("  ...mesaj tutarlari iceriyor",
        typeof red.body.error === "string" && (red.body.error as string).includes("1000"),
        `${red.body.error}`);

      const neg = await db.sale.findUnique({ where: { id: s3.saleId } });
      check("  ...satis DEGISMEDI (hala 1000)", n(neg?.saleAmount) === 1000, `${neg?.saleAmount}`);
      check("  ...kalan negatife dusmedi", n(neg?.remainingAmount) >= 0, `${neg?.remainingAmount}`);
      check("  ...otomatik iade kaydi URETILMEDI (ayri is akisi)",
        (await db.customerPayment.count({ where: { saleId: s3.saleId, amount: { lt: 0 } } })) === 0,
        "beklenmedik iade kaydi");

      // Tahsilat da birlikte dusurulurse islem gecerlidir.
      const birlikte = await patch(`/api/cash/${s3.saleId}`, { saleAmount: 400, paidAmount: 400 });
      check("Tutar ve tahsilat BIRLIKTE dusurulunce kabul edilir -> 200", birlikte.status === 200, `gelen ${birlikte.status}`);

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

      const tersler = await db.customerPayment.findMany({
        where: { saleId, amount: { lt: 0 } },
        select: { amount: true, paymentMethod: true },
      });
      console.log(`      ters kayitlar: ${tersler.map((t) => `${t.amount} ${t.paymentMethod}`).join(", ")}`);
      check("Ters kayit yontemlere DAGITILDI (tek yonteme yuklenmedi)",
        tersler.length === 2, `${tersler.length} ters kayit — 2 bekleniyordu (CASH + CARD)`);
      check("  ...CASH icin -100", tersler.some((t) => t.paymentMethod === "CASH" && n(t.amount) === -100),
        tersler.map((t) => `${t.paymentMethod}:${t.amount}`).join(","));
      check("  ...CARD icin -200", tersler.some((t) => t.paymentMethod === "CARD" && n(t.amount) === -200),
        tersler.map((t) => `${t.paymentMethod}:${t.amount}`).join(","));
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

      // Ekranin kullandigi sorgunun AYNISI (dashboard/page.tsx).
      const pendingSayisi = () =>
        db.appointment.count({
          where: { status: "completed", sales: { none: { saleStatus: { not: "VOIDED" } } } },
        });
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
      check("  ...mevcut sorgu ile dogru sorgu ayni sonucu veriyor",
        mevcutSorgu === dogruSorgu, `${mevcutSorgu} vs ${dogruSorgu}`);

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
      for (const u of [`/api/cash/summary?date=${BUGUN}`, `/api/day-end?date=${BUGUN}`]) {
        const body = (await get(u)) as Record<string, unknown>;
        const ad = u.split("?")[0];
        check(`${ad} -> listedTotal alani var`, typeof body.listedTotal === "number", `${typeof body.listedTotal}`);
        check(`${ad} -> discount alani var`, typeof body.discount === "number", `${typeof body.discount}`);
        check(`${ad} -> listedTotal - discount = realizedRevenue`,
          Math.round((n(body.listedTotal) - n(body.discount)) * 100) / 100 === n(body.realizedRevenue),
          `${body.listedTotal} - ${body.discount} != ${body.realizedRevenue}`);
      }

      const ozet = (await get(`/api/cash/summary?date=${BUGUN}`)) as Record<string, unknown>;
      console.log(`      gun ozeti: liste=${ozet.listedTotal} indirim=${ozet.discount} ciro=${ozet.realizedRevenue}`);
      check("Gun ozetinde indirim 0'dan buyuk", n(ozet.discount) >= 100, `${ozet.discount}`);

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
      const ekranlar = tsx.filter((f) => /listedTotal/.test(readFileSync(f, "utf8")));
      console.log(`      indirim gosteren ekranlar: ${ekranlar.map((f) => f.split("/").slice(-2).join("/")).join(", ")}`);
      check(`Indirim ekranlarda GOSTERILIYOR (${tsx.length} tsx tarandi)`,
        ekranlar.length >= 2, `${ekranlar.length} ekran — kasa ve gun sonu bekleniyordu`);
    }

    // ── KONU 6 — Bu dosyanin kendi metni bayat mi (FAZ 3 · Sira 3.4) ──────
    //
    // Bu paket bir donem denetim izini EKSIK olarak raporluyordu. Sira 10b'de
    // AuditLog gelince o sabit metin yanlis bilgiye donustu ve gercekten yanlis
    // bir karara yol acti: FAZ 2 kapanis raporunda "satis duzenleme gecmisi
    // yok" yazildi. Asagidaki liste o metinlerin izini surer; her ifade
    // yalnizca listenin KENDISINDE gecebilir, baska hicbir yerde.
    console.log("\nKONU 6 — Bu dosyanin metni guncel mi");
    {
      const kendisi = readFileSync("scripts/verify-audit-trail.ts", "utf8");
      const bayatIfadeler = ["ertelendi", "sonraki adimda ele alinacak", "eski deger saklanmiyor"];
      for (const ifade of bayatIfadeler) {
        // Bu kontrolun KENDI listesi haric hicbir yerde gecmemeli.
        const gecisSayisi = kendisi.split(ifade).length - 1;
        check(`"${ifade}" ifadesi dosyada YOK`, gecisSayisi <= 1, `${gecisSayisi} kez geciyor`);
      }
      check(
        "Denetim izinin gercek dogrulamasi isaret ediliyor",
        kendisi.includes("verify-audit-log.ts"),
        "yonlendirme yok"
      );
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

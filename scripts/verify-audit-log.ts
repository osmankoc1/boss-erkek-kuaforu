/**
 * Denetim izi (FAZ 2 · Sıra 10b).
 *
 * Çalıştırma (dev server ayakta olmalı):
 *   npx dotenv -e .env.local -- tsx scripts/verify-audit-log.ts
 *
 * ─── SINANAN DEĞİŞMEZLER ─────────────────────────────────────────────────
 *   • Sale CREATE/UPDATE/VOID, CustomerPayment CREATE, BarberPayout CREATE,
 *     Expense CREATE/DELETE, müşteri birleştirme, kritik randevu durum
 *     değişikliği ve ayar değişikliği kaydediliyor.
 *   • `changes` YALNIZCA değişen alanları, before/after ile tutuyor.
 *   • Aktör: ADMIN'de userId+userEmail dolu; PUBLIC/SYSTEM'de null.
 *   • Audit yazılamazsa ANA İŞLEM DE ROLLBACK oluyor.
 *   • İdempotent tekrar (Sıra 9b) ikinci audit satırı üretmiyor.
 *   • Hassas alanlar (parola/token/secret/bağlantı dizesi) `changes` içine
 *     hiçbir koşulda giremiyor — fail-closed whitelist.
 *   • Rutin `pending_verification → pending` geçişi kaydedilmiyor.
 *   • Denetim geçmişi yalnızca admin tarafından okunabiliyor.
 *
 * UYARI: Dev veritabanına test verisi yazar ve sonunda siler.
 * Production endpoint'ine karşı çalışmayı reddeder.
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { assertWritableTestDatabase } from "../lib/db-guard";
import { SignJWT } from "jose";
import { istanbulDateString, addIstanbulDays } from "../lib/tz";
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITIES,
  AUDIT_SOURCES,
  createdFields,
  diffFields,
  isAuditableStatusChange,
  writeAudit,
} from "../lib/audit";

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

const MARK = "ZZAUDITLOG";
const PHONE_PREFIX = "0555999120";
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
const del = (u: string) =>
  fetch(`${BASE}${u}`, { method: "DELETE", headers: { Cookie: cookie } }).then(async (r) => ({
    status: r.status,
    body: (await r.json().catch(() => ({}))) as Record<string, unknown>,
  }));

type AuditSatir = {
  id: string; entity: string; entityId: string; action: string; source: string;
  userId: string | null; userEmail: string | null;
  changes: Record<string, { before: unknown; after: unknown }> | null;
};

/**
 * Testin olusturdugu audit hedefleri.
 *
 * Silinen bir kaydin (or. gider) id'si temizlik aninda artik sorgulanamaz;
 * audit satiri sahipsiz kalirdi. Olusturulan her hedef burada biriktirilir.
 */
const auditHedefleri: string[] = [];
const auditHedefEkle = (id: string) => {
  if (id) auditHedefleri.push(id);
};

const auditFor = (entityId: string, action?: string) =>
  db.auditLog.findMany({
    where: { entityId, ...(action ? { action } : {}) },
    orderBy: { createdAt: "asc" },
  }) as Promise<AuditSatir[]>;

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
  const apptIds = (
    await db.appointment.findMany({
      where: { OR: [{ customerId: { in: ids } }, { barberId: { in: barberIds } }] },
      select: { id: true },
    })
  ).map((a) => a.id);
  const giderIds = (await db.expense.findMany({ where: { category: MARK }, select: { id: true } })).map((e) => e.id);

  const say = { audit: 0, odeme: 0, satis: 0, randevu: 0, musteri: 0, berber: 0, gider: 0 };
  const auditHedef = [...saleIds, ...apptIds, ...ids, ...barberIds, ...giderIds, ...auditHedefleri];
  if (auditHedef.length) {
    say.audit = (await db.auditLog.deleteMany({ where: { entityId: { in: auditHedef } } })).count;
  }
  // Odeme/hakedis audit satirlari kendi id'leriyle yazilir; onlari da temizle.
  const odemeIds = (await db.customerPayment.findMany({ where: { saleId: { in: saleIds } }, select: { id: true } })).map((p) => p.id);
  const payoutIds = (await db.barberPayout.findMany({ where: { barberId: { in: barberIds } }, select: { id: true } })).map((p) => p.id);
  if (odemeIds.length || payoutIds.length) {
    say.audit += (await db.auditLog.deleteMany({ where: { entityId: { in: [...odemeIds, ...payoutIds] } } })).count;
  }

  if (barberIds.length) await db.barberPayout.deleteMany({ where: { barberId: { in: barberIds } } });
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
  const admin = await db.user.findFirst({ select: { id: true, email: true } });
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
    // ── TEST 1 — Şema ve indeksler ───────────────────────────────────────
    console.log("TEST 1 — Sema ve indeksler");
    {
      const kolonlar = await db.$queryRawUnsafe<{ kolon: string; nullable: string; tip: string }[]>(`
        SELECT column_name::text AS kolon, is_nullable::text AS nullable, data_type::text AS tip
        FROM information_schema.columns WHERE table_schema='public' AND table_name='AuditLog'
        ORDER BY column_name`);
      const adlar = kolonlar.map((k) => k.kolon);
      console.log(`      kolonlar: ${adlar.join(", ")}`);
      for (const bekleyen of ["entity", "entityId", "action", "source", "userId", "userEmail", "changes", "createdAt"]) {
        check(`  kolon ${bekleyen} var`, adlar.includes(bekleyen), adlar.join(","));
      }
      check("source NOT NULL", kolonlar.find((k) => k.kolon === "source")?.nullable === "NO");
      check("userId NULLABLE (PUBLIC/SYSTEM icin)", kolonlar.find((k) => k.kolon === "userId")?.nullable === "YES");
      check("changes jsonb", kolonlar.find((k) => k.kolon === "changes")?.tip === "jsonb",
        kolonlar.find((k) => k.kolon === "changes")?.tip);

      const idx = await db.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname='public' AND tablename='AuditLog'`);
      check("Indeksler olusturuldu (pk + 4)", n(idx[0]?.n) >= 5, `${idx[0]?.n} indeks`);

      const fk = await db.$queryRawUnsafe<{ n: number }[]>(`
        SELECT count(*)::int AS n FROM information_schema.table_constraints
        WHERE table_schema='public' AND table_name='AuditLog' AND constraint_type='FOREIGN KEY'`);
      check("userId FK DEGIL (kullanici silinse de iz kalir)", n(fk[0]?.n) === 0, `${fk[0]?.n} FK`);
    }

    // ── TEST 2 — Sale CREATE + tahsilat + aktör ──────────────────────────
    console.log("\nTEST 2 — Sale CREATE ve aktor");
    {
      const c = await musteri("Create");
      const { saleId, status } = await satisYap(c, barber.id, service, 500, 500);
      check("Satis olustu -> 201", status === 201, `gelen ${status}`);

      const kayitlar = await auditFor(saleId);
      check("Satis icin audit satiri var", kayitlar.length === 1, `${kayitlar.length} kayit`);
      const a = kayitlar[0];
      check("  ...entity=Sale action=CREATE", a?.entity === "Sale" && a?.action === "CREATE", `${a?.entity}/${a?.action}`);
      check("  ...source=ADMIN", a?.source === "ADMIN", `${a?.source}`);
      check("  ...userId dolu", a?.userId === admin.id, `${a?.userId}`);
      check("  ...userEmail dolu", a?.userEmail === admin.email, `${a?.userEmail}`);
      check("  ...changes saleAmount iceriyor", n(a?.changes?.saleAmount?.after) === 500, `${a?.changes?.saleAmount?.after}`);

      const odemeler = await db.customerPayment.findMany({ where: { saleId }, select: { id: true } });
      const odemeAudit = await auditFor(odemeler[0]?.id ?? "yok");
      check("Pesin tahsilat icin de audit satiri var", odemeAudit.length === 1, `${odemeAudit.length}`);
      check("  ...entity=CustomerPayment", odemeAudit[0]?.entity === "CustomerPayment", `${odemeAudit[0]?.entity}`);
    }

    // ── TEST 3 — Sale UPDATE: yalnızca DEĞİŞEN alanlar ───────────────────
    console.log("\nTEST 3 — Sale UPDATE: yalnizca degisen alanlar");
    {
      const c = await musteri("Update");
      const { saleId } = await satisYap(c, barber.id, service, 1000, 300);
      const r = await patch(`/api/cash/${saleId}`, { saleAmount: 700 });
      check("Duzenleme -> 200", r.status === 200, `gelen ${r.status}`);

      const kayitlar = await auditFor(saleId, "UPDATE");
      check("UPDATE audit satiri var", kayitlar.length === 1, `${kayitlar.length}`);
      const ch = kayitlar[0]?.changes ?? {};
      console.log(`      degisen alanlar: ${Object.keys(ch).join(", ")}`);
      check("  ...saleAmount 1000 -> 700", n(ch.saleAmount?.before) === 1000 && n(ch.saleAmount?.after) === 700,
        `${ch.saleAmount?.before} -> ${ch.saleAmount?.after}`);
      check("  ...barberShare de degisti ve kayitli", "barberShare" in ch, Object.keys(ch).join(","));
      check("  ...DEGISMEYEN alan changes'e girmedi (customerName)", !("customerName" in ch), Object.keys(ch).join(","));
      check("  ...DEGISMEYEN alan changes'e girmedi (paymentMethod)", !("paymentMethod" in ch), Object.keys(ch).join(","));
    }

    // ── TEST 4 — Sale VOID ───────────────────────────────────────────────
    console.log("\nTEST 4 — Sale VOID");
    {
      const c = await musteri("Void");
      const { saleId } = await satisYap(c, barber.id, service, 400, 400);
      await post(`/api/cash/${saleId}/void`, { voidReason: `${MARK} gerekce` });

      const kayitlar = await auditFor(saleId, "VOID");
      check("VOID audit satiri var", kayitlar.length === 1, `${kayitlar.length}`);
      check("  ...saleStatus PAID -> VOIDED",
        kayitlar[0]?.changes?.saleStatus?.after === "VOIDED", `${kayitlar[0]?.changes?.saleStatus?.after}`);
      check("  ...voidReason kayitli",
        String(kayitlar[0]?.changes?.voidReason?.after ?? "").includes(MARK), `${kayitlar[0]?.changes?.voidReason?.after}`);
    }

    // ── TEST 5 — CustomerPayment ve BarberPayout CREATE ──────────────────
    console.log("\nTEST 5 — Tahsilat ve hakedis odemesi");
    {
      const c = await musteri("Tahsilat");
      const { saleId } = await satisYap(c, barber.id, service, 600, 0);
      const od = await post("/api/debts/payment", { saleId, customerId: c.id, amount: 250, paymentMethod: "CARD" });
      check("Borc tahsilati -> 201", od.status === 201, `gelen ${od.status}`);
      const odemeId = (od.body.payment as { id: string } | undefined)?.id ?? "";
      const odAudit = await auditFor(odemeId);
      check("Tahsilat audit satiri var", odAudit.length === 1, `${odAudit.length}`);
      check("  ...amount 250 kayitli", n(odAudit[0]?.changes?.amount?.after) === 250, `${odAudit[0]?.changes?.amount?.after}`);

      const hak = await post("/api/payouts", {
        barberId: barber.id, amount: 50, paymentMethod: "CASH",
        periodStart: BUGUN, periodEnd: BUGUN, note: MARK,
      });
      check("Hakedis odemesi -> 201", hak.status === 201, `gelen ${hak.status}`);
      const payoutId = (hak.body.payout as { id: string } | undefined)?.id ?? "";
      const hakAudit = await auditFor(payoutId);
      check("Hakedis odemesi audit satiri var", hakAudit.length === 1, `${hakAudit.length}`);
      check("  ...entity=BarberPayout", hakAudit[0]?.entity === "BarberPayout", `${hakAudit[0]?.entity}`);
    }

    // ── TEST 6 — Expense CREATE / DELETE ─────────────────────────────────
    console.log("\nTEST 6 — Gider olusturma ve silme");
    {
      const oluştur = await post("/api/expenses", { amount: 125.5, category: MARK, description: `${MARK} kira` });
      check("Gider olustu -> 201", oluştur.status === 201, `gelen ${oluştur.status}`);
      const giderId = (oluştur.body.expense as { id: string } | undefined)?.id ?? "";
      auditHedefEkle(giderId);

      const cAudit = await auditFor(giderId, "CREATE");
      check("Gider CREATE audit var", cAudit.length === 1, `${cAudit.length}`);
      check("  ...amount 125.5", n(cAudit[0]?.changes?.amount?.after) === 125.5, `${cAudit[0]?.changes?.amount?.after}`);

      const sil = await del(`/api/expenses/${giderId}`);
      check("Gider silindi -> 200", sil.status === 200, `gelen ${sil.status}`);
      const dAudit = await auditFor(giderId, "DELETE");
      check("Gider DELETE audit var", dAudit.length === 1, `${dAudit.length}`);
      check("  ...silinen deger before'da", n(dAudit[0]?.changes?.amount?.before) === 125.5, `${dAudit[0]?.changes?.amount?.before}`);
      check("  ...after null", dAudit[0]?.changes?.amount?.after === null, `${dAudit[0]?.changes?.amount?.after}`);
    }

    // ── TEST 7 — Randevu durum değişikliği: kritik vs rutin ──────────────
    console.log("\nTEST 7 — Randevu durum degisikligi (kritik vs rutin)");
    {
      check("pending_verification -> pending RUTIN (audit YOK)",
        !isAuditableStatusChange("pending_verification", "pending"));
      check("confirmed -> completed KRITIK", isAuditableStatusChange("confirmed", "completed"));
      check("confirmed -> cancelled KRITIK", isAuditableStatusChange("confirmed", "cancelled"));
      check("completed -> confirmed KRITIK (void geri alma)", isAuditableStatusChange("completed", "confirmed"));
      check("ayni durum -> audit yok", !isAuditableStatusChange("pending", "pending"));

      const c = await musteri("Randevu");
      const appt = await db.appointment.create({
        data: {
          customerId: c.id, barberId: barber.id, serviceId: service.id,
          date: addIstanbulDays(new Date(), 0), startTime: "16:00", endTime: "17:00",
          status: "confirmed", appointmentPrice: 300, notes: MARK,
        },
      });
      await patch(`/api/appointments/${appt.id}`, { status: "cancelled" });
      const kayitlar = await auditFor(appt.id);
      check("Iptal icin audit satiri var", kayitlar.length === 1, `${kayitlar.length}`);
      check("  ...action=STATUS_CHANGE", kayitlar[0]?.action === "STATUS_CHANGE", `${kayitlar[0]?.action}`);
      check("  ...confirmed -> cancelled",
        kayitlar[0]?.changes?.status?.before === "confirmed" && kayitlar[0]?.changes?.status?.after === "cancelled",
        JSON.stringify(kayitlar[0]?.changes));
      check("  ...source=ADMIN", kayitlar[0]?.source === "ADMIN", `${kayitlar[0]?.source}`);
    }

    // ── TEST 8 — Ayar değişikliği ────────────────────────────────────────
    console.log("\nTEST 8 — Ayar degisikligi");
    {
      const once = await db.setting.findUnique({ where: { key: "business_name" } });
      const eski = once?.value ?? "";
      const yeni = `${MARK} Kuafor`;

      const r = await post("/api/settings", { business_name: yeni });
      check("Ayar guncellendi -> 200", r.status === 200, `gelen ${r.status}`);

      const kayitlar = await auditFor("business_name");
      check("Ayar audit satiri var", kayitlar.length >= 1, `${kayitlar.length}`);
      const son = kayitlar[kayitlar.length - 1];
      check("  ...entity=Setting", son?.entity === "Setting", `${son?.entity}`);
      check("  ...value before/after dogru",
        son?.changes?.value?.before === (eski || null) && son?.changes?.value?.after === yeni,
        `${son?.changes?.value?.before} -> ${son?.changes?.value?.after}`);

      // Geri al ve degismeyen ayar icin kayit yazilmadigini dogrula
      const oncekiSayi = (await auditFor("business_name")).length;
      await post("/api/settings", { business_name: yeni });
      check("Degeri DEGISMEYEN ayar icin yeni kayit yazilmadi",
        (await auditFor("business_name")).length === oncekiSayi, "gereksiz kayit olustu");

      if (eski) await post("/api/settings", { business_name: eski });
      await db.auditLog.deleteMany({ where: { entityId: "business_name" } });
    }

    // ── TEST 9 — Müşteri birleştirme ─────────────────────────────────────
    console.log("\nTEST 9 — Musteri birlestirme");
    {
      const a = await musteri("Ana");
      const b = await musteri("Ikincil");
      const r = await post("/api/customers/merge", { primaryId: a.id, secondaryId: b.id });
      check("Birlestirme -> 200", r.status === 200, `gelen ${r.status}`);

      const kayitlar = await auditFor(b.id);
      check("Birlestirme audit satiri var", kayitlar.length === 1, `${kayitlar.length}`);
      check("  ...action=MERGE", kayitlar[0]?.action === "MERGE", `${kayitlar[0]?.action}`);
      check("  ...hangi kayda baglandigi yazili",
        kayitlar[0]?.changes?.mergedIntoCustomerId?.after === a.id, `${kayitlar[0]?.changes?.mergedIntoCustomerId?.after}`);
    }

    // ── TEST 10 — ROLLBACK: audit yazılamazsa ana işlem de geri alınır ───
    console.log("\nTEST 10 — Audit yazilamazsa ANA ISLEM ROLLBACK");
    {
      const c = await musteri("Rollback");
      const oncekiSatis = await db.sale.count();

      // (a) writeAudit fail-closed dogrulamasi ile patlar
      let hataA = "";
      try {
        await db.$transaction(async (tx) => {
          await tx.sale.create({
            data: {
              customerId: c.id, barberId: barber.id, customerName: c.fullName, customerPhone: c.phone,
              serviceName: service.name, barberName: barber.name, barberWorkerType: "COMMISSION",
              saleAmount: 999, paidAmount: 999, remainingAmount: 0, note: MARK,
            },
          });
          await writeAudit(tx, {
            entity: "OlmayanVarlik" as never,
            entityId: "x", action: "CREATE",
            actor: { source: "ADMIN", userId: admin.id, userEmail: admin.email },
          });
        });
      } catch (e) {
        hataA = (e as Error).message;
      }
      console.log(`      (a) writeAudit hatasi: ${hataA}`);
      check("(a) Taninmayan varlik writeAudit'i patlatti", hataA.includes("taninmayan varlik"), hataA);
      check("(a) ANA ISLEM GERI ALINDI (satis olusmadi)",
        (await db.sale.count()) === oncekiSatis, `satis sayisi ${await db.sale.count()} != ${oncekiSatis}`);

      // (b) Veritabani seviyesinde audit hatasi (NOT NULL ihlali)
      let hataB = "";
      try {
        await db.$transaction(async (tx) => {
          await tx.sale.create({
            data: {
              customerId: c.id, barberId: barber.id, customerName: c.fullName, customerPhone: c.phone,
              serviceName: service.name, barberName: barber.name, barberWorkerType: "COMMISSION",
              saleAmount: 888, paidAmount: 888, remainingAmount: 0, note: MARK,
            },
          });
          // `source` NOT NULL -- bu insert DB seviyesinde patlar.
          await tx.$executeRawUnsafe(
            `INSERT INTO "AuditLog" ("id","entity","entityId","action","source") VALUES ($1,$2,$3,$4,NULL)`,
            randomUUID(), "Sale", "x", "CREATE"
          );
        });
      } catch (e) {
        hataB = (e as Error).message.slice(0, 120);
      }
      console.log(`      (b) DB hatasi yakalandi: ${hataB ? "evet" : "HAYIR"}`);
      check("(b) DB seviyesindeki audit hatasi yakalandi", hataB.length > 0, "hata firlatilmadi");
      check("(b) ANA ISLEM GERI ALINDI (satis olusmadi)",
        (await db.sale.count()) === oncekiSatis, `satis sayisi ${await db.sale.count()} != ${oncekiSatis}`);
      check("(b) Yarim audit satiri kalmadi",
        (await db.auditLog.count({ where: { entityId: "x" } })) === 0, "artik audit satiri var");
    }

    // ── TEST 11 — İdempotent tekrar ikinci audit üretmiyor ───────────────
    console.log("\nTEST 11 — Idempotent tekrar ikinci audit URETMIYOR");
    {
      const c = await musteri("Idem");
      const { saleId } = await satisYap(c, barber.id, service, 500, 0);
      const anahtar = randomUUID();
      const govde = { saleId, customerId: c.id, amount: 120, paymentMethod: "CASH", idempotencyKey: anahtar };

      const ilk = await post("/api/debts/payment", govde);
      check("Ilk tahsilat -> 201", ilk.status === 201, `gelen ${ilk.status}`);
      const odemeId = (ilk.body.payment as { id: string } | undefined)?.id ?? "";
      check("  ...1 audit satiri", (await auditFor(odemeId)).length === 1, `${(await auditFor(odemeId)).length}`);

      const tekrar = await post("/api/debts/payment", govde);
      check("Ayni anahtarla tekrar -> 200", tekrar.status === 200, `gelen ${tekrar.status}`);
      check("Tekrar IKINCI audit satiri URETMEDI",
        (await auditFor(odemeId)).length === 1, `${(await auditFor(odemeId)).length} kayit`);

      const hepsi = await Promise.all(Array.from({ length: 4 }, () => post("/api/debts/payment", govde)));
      check("4 es zamanli tekrar da 200", hepsi.every((r) => r.status === 200), hepsi.map((r) => r.status).join(","));
      check("Hala tek audit satiri", (await auditFor(odemeId)).length === 1, `${(await auditFor(odemeId)).length}`);
    }

    // ── TEST 12 — HASSAS VERİ audit'e giremez ────────────────────────────
    console.log("\nTEST 12 — Hassas veri korumasi (fail-closed whitelist)");
    {
      // Whitelist'te olmayan alanlar diff'e HIC girmez.
      const sahte = {
        saleAmount: 100,
        password: "gizli123",
        token: "tok_abc",
        apiKey: "sk_live_XXXX",
        connectionString: "postgresql://kullanici:parola@host/db",
        passwordHash: "$2a$12$abcdef",
      };
      const sonra = { ...sahte, saleAmount: 200, password: "yeni", token: "tok_def" };
      const d = diffFields("Sale", sahte, sonra) ?? {};
      console.log(`      diff sonucu: ${Object.keys(d).join(", ")}`);
      check("saleAmount degisimi yakalandi", "saleAmount" in d);
      for (const alan of ["password", "token", "apiKey", "connectionString", "passwordHash"]) {
        check(`  ...${alan} changes'e GIRMEDI`, !(alan in d), Object.keys(d).join(","));
      }

      const c2 = createdFields("Setting", { value: "x", password: "p", token: "t" });
      check("createdFields de whitelist disini almiyor",
        !("password" in c2) && !("token" in c2), Object.keys(c2).join(","));

      // Tum AuditLog tablosunda hassas desen taramasi
      const hepsi = await db.auditLog.findMany({ select: { changes: true } });
      const metin = JSON.stringify(hepsi);
      for (const desen of ["password", "passwordHash", "token", "secret", "postgresql://", "sk_live", "SESSION_SECRET"]) {
        check(`Tabloda "${desen}" gecmiyor`, !metin.includes(desen), "hassas veri sizmis");
      }
    }

    // ── TEST 13 — Denetim geçmişi yalnızca admin ─────────────────────────
    console.log("\nTEST 13 — Erisim kontrolu ve okuma ucu");
    {
      const eski = cookie;
      cookie = "";
      const yetkisiz = await fetch(`${BASE}/api/audit`, { cache: "no-store" });
      check("Oturumsuz /api/audit -> 401", yetkisiz.status === 401, `gelen ${yetkisiz.status}`);
      const sayfa = await fetch(`${BASE}/admin/denetim`, { redirect: "manual" });
      check("Oturumsuz /admin/denetim -> yonlendirme", sayfa.status === 307 || sayfa.status === 302,
        `gelen ${sayfa.status}`);
      cookie = eski;

      const r = (await get("/api/audit")) as Record<string, unknown>;
      check("Admin /api/audit okuyabiliyor", Array.isArray(r.logs), typeof r.logs);
      check("  ...filtre secenekleri donuyor",
        Array.isArray((r.filters as { entities?: unknown })?.entities), "filters yok");

      const filtreli = (await get("/api/audit?entity=Sale&action=CREATE")) as { logs: AuditSatir[] };
      check("Entity + action filtresi calisiyor",
        filtreli.logs.every((l) => l.entity === "Sale" && l.action === "CREATE"),
        `${filtreli.logs.length} kayit`);

      const kaynak = (await get("/api/audit?source=ADMIN")) as { logs: AuditSatir[] };
      check("Source filtresi calisiyor", kaynak.logs.every((l) => l.source === "ADMIN"), `${kaynak.logs.length}`);

      const tarihli = (await get(`/api/audit?from=${BUGUN}&to=${BUGUN}`)) as { logs: AuditSatir[] };
      check("Tarih filtresi calisiyor", Array.isArray(tarihli.logs), typeof tarihli.logs);

      const sayfaHtml = await fetch(`${BASE}/admin/denetim`, { headers: { Cookie: cookie } });
      const html = await sayfaHtml.text();
      check("Denetim ekrani 200", sayfaHtml.status === 200, `gelen ${sayfaHtml.status}`);
      for (const baslik of ["Tarih / Saat", "Kaynak", "Aktör", "İşlem", "Varlık", "İlgili Kayıt", "Değişiklik Özeti"]) {
        check(`  ...ekranda "${baslik}" sutunu var`, html.includes(baslik), "eksik");
      }
      check("  ...render hatasi yok", !/Application error|Internal Server Error/.test(html));
    }

    // ── TEST 14 — Sabitler ve backfill yok ───────────────────────────────
    console.log("\nTEST 14 — Sabitler ve backfill");
    {
      check("3 kaynak tanimli", AUDIT_SOURCES.length === 3, AUDIT_SOURCES.join(","));
      check("  ...ADMIN/PUBLIC/SYSTEM", ["ADMIN", "PUBLIC", "SYSTEM"].every((s) => (AUDIT_SOURCES as readonly string[]).includes(s)));
      check("7 varlik tanimli", AUDIT_ENTITIES.length === 7, AUDIT_ENTITIES.join(","));
      check("6 eylem tanimli", AUDIT_ACTIONS.length === 6, AUDIT_ACTIONS.join(","));

      // Migration SQL'inde backfill yok
      const migDir = readFileSync("prisma/migrations/migration_lock.toml", "utf8");
      check("migration_lock okunabildi", migDir.length > 0);
      const sqlDosyalari = ["20260825094005_audit_log/migration.sql"];
      for (const f of sqlDosyalari) {
        const sql = readFileSync(`prisma/migrations/${f}`, "utf8");
        check(`  ...${f} backfill icermiyor`, !/INSERT INTO/i.test(sql), "INSERT var");
        check(`  ...${f} yalnizca CREATE TABLE/INDEX`, !/ALTER TABLE|DROP/i.test(sql), "beklenmedik ifade");
      }
    }
  } finally {
    console.log("\nTEMIZLIK...");
    const s = await cleanup();
    console.log(`  silinen: audit=${s.audit} odeme=${s.odeme} satis=${s.satis} randevu=${s.randevu} musteri=${s.musteri} berber=${s.berber} gider=${s.gider}`);
    console.log(`  DB: ${await db.sale.count()} satis, ${await db.auditLog.count()} audit, ${await db.customer.count()} musteri`);
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

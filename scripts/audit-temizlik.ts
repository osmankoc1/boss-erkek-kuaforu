import type { PrismaClient } from "../app/generated/prisma/client";

/**
 * Test paketleri için denetim izi temizliği (FAZ 2 · Sıra 10b).
 *
 * ─── NEDEN GEREKLİ ───────────────────────────────────────────────────────
 * Sıra 10b'den sonra satış, tahsilat, hakediş ödemesi, gider, birleştirme,
 * kritik randevu durumu ve ayar değişikliği `AuditLog` satırı üretiyor.
 * Test paketlerinin mevcut `cleanup()` fonksiyonları bu tabloyu bilmiyordu;
 * entity'ler silindikten sonra denetim satırları dev veritabanında birikiyordu.
 *
 * ─── NEDEN "ÖKSÜZ SÜPÜRME" ───────────────────────────────────────────────
 * Her paketin `cleanup()` şekli farklı; hepsine ayrı ayrı id listesi
 * geçirmek kırılgan olurdu. Bunun yerine: entity'si ARTIK VAR OLMAYAN
 * denetim satırları silinir.
 *
 * Bu yaklaşım YALNIZCA TESTLER İÇİN doğrudur. Üründe öksüz denetim satırı
 * SİLİNMEZ — bir giderin silinmiş olması, silindiğinin kaydını değersiz
 * kılmaz; tam tersine asıl değerli olan odur. Bu dosya `scripts/` altındadır
 * ve ürün kodundan çağrılmaz.
 */

type Db = Pick<
  PrismaClient,
  "auditLog" | "sale" | "customerPayment" | "barberPayout" | "expense" | "customer" | "appointment"
>;

/** Denetim satırının işaret ettiği kaydın hâlâ var olup olmadığına bakılan tablolar. */
const KONTROL: Record<string, (db: Db, ids: string[]) => Promise<string[]>> = {
  Sale: async (db, ids) =>
    (await db.sale.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((r) => r.id),
  CustomerPayment: async (db, ids) =>
    (await db.customerPayment.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((r) => r.id),
  BarberPayout: async (db, ids) =>
    (await db.barberPayout.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((r) => r.id),
  Expense: async (db, ids) =>
    (await db.expense.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((r) => r.id),
  Customer: async (db, ids) =>
    (await db.customer.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((r) => r.id),
  Appointment: async (db, ids) =>
    (await db.appointment.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((r) => r.id),
};

/**
 * Entity'si silinmiş denetim satırlarını temizler.
 *
 * `settingKeys` verilirse o anahtarlara ait `Setting` denetim satırları da
 * silinir — ayar anahtarı silinmediği için öksüz süpürme onları yakalayamaz.
 *
 * @returns silinen satır sayısı
 */
export async function temizleAuditIzleri(db: Db, settingKeys: string[] = []): Promise<number> {
  let silinen = 0;

  for (const [entity, bul] of Object.entries(KONTROL)) {
    const satirlar = await db.auditLog.findMany({ where: { entity }, select: { id: true, entityId: true } });
    if (satirlar.length === 0) continue;

    const hedefler = [...new Set(satirlar.map((s) => s.entityId))];
    const yasayan = new Set(await bul(db, hedefler));
    const oksuz = satirlar.filter((s) => !yasayan.has(s.entityId)).map((s) => s.id);

    if (oksuz.length) {
      silinen += (await db.auditLog.deleteMany({ where: { id: { in: oksuz } } })).count;
    }
  }

  if (settingKeys.length) {
    silinen += (await db.auditLog.deleteMany({ where: { entity: "Setting", entityId: { in: settingKeys } } })).count;
  }

  return silinen;
}

import type { PrismaClient } from "@/app/generated/prisma/client";

/**
 * Denetim izi altyapısı (FAZ 2 · Sıra 10b).
 *
 * ─── NEDEN MERKEZİ TABLO ─────────────────────────────────────────────────
 * Model başına `createdByUserId` alanı yalnızca **son değiştireni** tutar;
 * "1000 TL'lik satış kim tarafından 700'e çekildi ve önceki değer neydi"
 * sorusunu cevaplamaz. Merkezi `AuditLog` hem aktörü hem önceki/sonraki
 * değeri tek yerde tutar.
 *
 * ─── DEĞİŞMEZLER ─────────────────────────────────────────────────────────
 *   1. Audit satırı ana işlemle AYNI transaction'da yazılır. `writeAudit`
 *      bir `tx` istemcisi alır; ayrı bir bağlantı kullanmaz.
 *   2. Audit yazılamazsa ana işlem de commit EDİLMEZ — bu fonksiyon hatayı
 *      yutmaz, yukarı fırlatır ve transaction geri alınır.
 *   3. `changes` yalnızca DEĞİŞEN alanları tutar; komple satır saklanmaz.
 *   4. Alan seçimi FAIL-CLOSED whitelist ile yapılır: listede olmayan hiçbir
 *      alan `changes` içine giremez. Yarın şemaya `apiKey` eklense bile
 *      otomatik olarak dışarıda kalır. (Aynı ilke FAZ 2 · Sıra 7'deki
 *      veritabanı hedef korumasında da uygulandı: denylist değil allowlist.)
 *   5. Geçmiş veriye backfill yapılmaz; yalnızca bu katman devreye girdikten
 *      sonraki işlemler kaydedilir.
 *
 * ─── BU DOSYA SAFTIR ─────────────────────────────────────────────────────
 * `server-only` ve oturum katmanı bilinçli olarak DIŞARIDA bırakıldı: bu
 * kurallar test script'lerinden de doğrulanabilmeli. Oturumdan aktör çözen
 * `adminActor()` ayrı bir dosyada (`lib/audit-actor.ts`) yaşar.
 * (Aynı ayrım FAZ 2 · Sıra 7'de `lib/customer-counters.ts` için de yapıldı.)
 */

/** İşlemin kaynağı. */
export const AUDIT_SOURCES = ["ADMIN", "PUBLIC", "SYSTEM"] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

/** Denetlenen varlık türleri. */
export const AUDIT_ENTITIES = [
  "Sale",
  "CustomerPayment",
  "BarberPayout",
  "Expense",
  "Customer",
  "Appointment",
  "Setting",
] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

/** Denetlenen eylemler. */
export const AUDIT_ACTIONS = ["CREATE", "UPDATE", "VOID", "DELETE", "MERGE", "STATUS_CHANGE"] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Varlık başına `changes` içine girmesine İZİN VERİLEN alanlar.
 *
 * Bu bir whitelist'tir ve fail-closed çalışır. Hassas bir alan (parola,
 * token, bağlantı dizesi) buraya eklenmediği sürece denetim iznine hiçbir
 * koşulda yazılamaz — unutulma ihtimali yoktur, çünkü varsayılan "yazma"dır.
 */
const AUDIT_FIELDS: Record<AuditEntity, readonly string[]> = {
  Sale: [
    "listedPrice",
    "saleAmount",
    "paidAmount",
    "remainingAmount",
    "saleStatus",
    "paymentMethod",
    "barberShare",
    "businessShare",
    "barberId",
    "barberName",
    "serviceName",
    "customerName",
    "note",
    "voidReason",
  ],
  CustomerPayment: ["amount", "paymentMethod", "saleId", "customerId", "note"],
  BarberPayout: ["amount", "paymentMethod", "barberId", "periodStart", "periodEnd", "note"],
  Expense: ["amount", "category", "description", "expenseDate"],
  Customer: ["fullName", "phone", "email", "tag", "mergedIntoCustomerId"],
  Appointment: ["status", "date", "startTime", "barberId", "appointmentPrice"],
  Setting: ["value"],
};

/** Aktör bilgisi. */
export type AuditActor = {
  source: AuditSource;
  userId: string | null;
  userEmail: string | null;
};

/** Public (müşterinin kendi işlemi) — aktör kimliği yoktur. */
export const PUBLIC_ACTOR: AuditActor = { source: "PUBLIC", userId: null, userEmail: null };

/** Sistem (cron, zamanlanmış iş) — aktör kimliği yoktur. */
export const SYSTEM_ACTOR: AuditActor = { source: "SYSTEM", userId: null, userEmail: null };

/** Bir alanın denetim izine yazılabilir karşılığı. */
type AuditValue = string | number | boolean | null;

/** Decimal, Date ve benzeri nesneleri JSON'a uygun sade değere çevirir. */
function sadelestir(v: unknown): AuditValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v.toISOString();
  // Prisma Decimal ve benzerleri: metinsel gösterim hassasiyeti korur.
  return String(v);
}

export type AuditChanges = Record<string, { before: AuditValue; after: AuditValue }>;

/**
 * İki satırın whitelist'teki alanlarındaki FARKLARI çıkarır.
 *
 * Değişmeyen alanlar dışarıda kalır; `changes` yalnızca gerçekten değişeni
 * gösterir. Fark yoksa `null` döner ve çağıran audit yazmayabilir.
 */
export function diffFields(
  entity: AuditEntity,
  before: Record<string, unknown>,
  after: Record<string, unknown>
): AuditChanges | null {
  const changes: AuditChanges = {};
  for (const alan of AUDIT_FIELDS[entity]) {
    const o = sadelestir(before[alan]);
    const y = sadelestir(after[alan]);
    if (o !== y) changes[alan] = { before: o, after: y };
  }
  return Object.keys(changes).length ? changes : null;
}

/** Oluşturma için: yalnızca `after` doldurulur. */
export function createdFields(entity: AuditEntity, row: Record<string, unknown>): AuditChanges {
  const changes: AuditChanges = {};
  for (const alan of AUDIT_FIELDS[entity]) {
    if (!(alan in row)) continue;
    changes[alan] = { before: null, after: sadelestir(row[alan]) };
  }
  return changes;
}

/** Silme/iptal için: yalnızca `before` doldurulur. */
export function deletedFields(entity: AuditEntity, row: Record<string, unknown>): AuditChanges {
  const changes: AuditChanges = {};
  for (const alan of AUDIT_FIELDS[entity]) {
    if (!(alan in row)) continue;
    changes[alan] = { before: sadelestir(row[alan]), after: null };
  }
  return changes;
}

/** `writeAudit` için gereken asgari istemci — transaction da olabilir. */
export type AuditClient = Pick<PrismaClient, "auditLog">;

export type AuditEntry = {
  entity: AuditEntity;
  entityId: string;
  action: AuditAction;
  actor: AuditActor;
  changes?: AuditChanges | null;
};

/**
 * Denetim satırını yazar.
 *
 * ÖNEMLİ: Hata YUTULMAZ. `tx` bir transaction istemcisiyse ve bu çağrı
 * başarısız olursa, ana işlem de geri alınır — ürün kararı budur: denetim
 * izi olmadan para hareketi kaydedilmez.
 */
export async function writeAudit(tx: AuditClient, entry: AuditEntry): Promise<void> {
  // Fail-closed doğrulama: tanınmayan varlık/eylem/kaynak sessizce geçmez.
  if (!(AUDIT_ENTITIES as readonly string[]).includes(entry.entity)) {
    throw new Error(`Denetim izi: taninmayan varlik "${entry.entity}"`);
  }
  if (!(AUDIT_ACTIONS as readonly string[]).includes(entry.action)) {
    throw new Error(`Denetim izi: taninmayan eylem "${entry.action}"`);
  }
  if (!(AUDIT_SOURCES as readonly string[]).includes(entry.actor.source)) {
    throw new Error(`Denetim izi: taninmayan kaynak "${entry.actor.source}"`);
  }
  if (!entry.entityId) {
    throw new Error("Denetim izi: entityId bos olamaz");
  }

  await tx.auditLog.create({
    data: {
      entity: entry.entity,
      entityId: entry.entityId,
      action: entry.action,
      source: entry.actor.source,
      userId: entry.actor.userId,
      userEmail: entry.actor.userEmail,
      changes: entry.changes ?? undefined,
    },
  });
}

/**
 * İşletme açısından ÖNEMLİ randevu durum geçişi mi?
 *
 * Rutin teknik hareketler (e-posta doğrulaması sonrası
 * `pending_verification → pending`) denetim izine girmez: hacimli ve düşük
 * değerlidir, asıl kayıtları gürültüye boğar. Finans/operasyon anlamı taşıyan
 * geçişler kaydedilir.
 */
export function isAuditableStatusChange(from: string, to: string): boolean {
  if (from === to) return false;
  const onemli = ["completed", "cancelled"];
  return onemli.includes(to) || onemli.includes(from);
}

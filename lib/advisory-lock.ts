import "server-only";
import type { PrismaClient } from "@/app/generated/prisma/client";

/**
 * Genel amaçlı PostgreSQL advisory lock yardımcısı.
 *
 * `pg_advisory_xact_lock` (session değil, xact) kullanılır: kilit transaction
 * bitince — commit, rollback ya da bağlantı kopması fark etmeksizin —
 * PostgreSQL tarafından otomatik bırakılır. Elle `unlock` çağrısı yoktur,
 * dolayısıyla hata yolunda kalıcı kilit kalmaz. Bu varyant ayrıca Neon'un
 * pooled bağlantısıyla (PgBouncer transaction mode) uyumludur.
 *
 * `$queryRaw` değil `$executeRaw` kullanılır: fonksiyon `void` döner ve
 * Prisma void kolonunu deserialize edemez.
 *
 * hashtext() iki int4 üretir. Farklı anahtarların aynı hash'e düşmesi teorik
 * olarak mümkündür; sonucu yalnızca gereksiz bir bekleme olur, veri hatası değil.
 */
export async function acquireAdvisoryLock(
  client: Pick<PrismaClient, "$executeRaw">,
  namespace: string,
  key: string
): Promise<void> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${namespace}::text), hashtext(${key}::text))`;
}

/** Randevu başına kasa kaydı oluşturmayı serileştiren kilit ad alanı. */
export const SALE_APPOINTMENT_LOCK = "boss:sale-appointment";

/**
 * Satış başına tahsilat yazmayı serileştiren kilit ad alanı.
 *
 * Kilitsiz hâlde eşzamanlı istekler `sale.paidAmount` değerini aynı anda
 * okuyup aynı anda yazıyordu: 5 paralel istek ödeme defterine 5 kayıt
 * düşürüyor, satış tarafında ise tek artış oluyordu (FAZ 2 · Sıra 6).
 */
export const SALE_PAYMENT_LOCK = "boss:sale-payment";

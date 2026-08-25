import { z } from "zod";
import { Prisma } from "@/app/generated/prisma/client";

/**
 * Kesin idempotency (FAZ 2 · Sıra 9b).
 *
 * ─── NEDEN ───────────────────────────────────────────────────────────────
 * Sıra 6 ve Sıra 8'de çift tıklama, **10 saniyelik mükerrer penceresi** ile
 * engelleniyordu: aynı satışa/berbere, aynı tutarda, aynı yöntemle gelen
 * ikinci istek reddediliyordu. Bu bir sezgiseldir ve iki açığı vardır:
 *
 *   1. Pencere dışında kalan bir istek tekrarı (yavaş ağ, kullanıcı 15 sn
 *      sonra tekrar tıklıyor, istemci retry'ı) ikinci kaydı oluşturur.
 *   2. Gerçekten ikinci bir tahsilat aynı tutardaysa yanlışlıkla reddedilir.
 *
 * Anahtar tabanlı idempotency ikisini birden çözer: karar tutara değil,
 * **isteğin kimliğine** bakar. Süre sınırı yoktur.
 *
 * ─── ANAHTAR NE ZAMAN ÜRETİLİR ───────────────────────────────────────────
 * İstemci anahtarı **form açıldığında bir kez** üretir, her tıklamada değil.
 * Böylece çift tıklama aynı anahtarı gönderir ve tek kayıt oluşur; kullanıcı
 * formu kapatıp yeniden açtığında yeni anahtar üretilir ve gerçek ikinci
 * tahsilat serbestçe girilebilir.
 *
 * ─── ÇAKIŞMADA NE OLUR ───────────────────────────────────────────────────
 * Aynı anahtarla gelen ikinci istek **hata değildir**: işlem zaten yapılmış
 * demektir. Var olan kayıt `200` ile geri döner (`idempotent: true`).
 * Kullanıcıya korkutucu bir hata göstermek yerine "işlem tamam" denir —
 * gerçek durum budur.
 *
 * Anahtar göndermeyen istemciler için 10 saniyelik pencere ikinci savunma
 * hattı olarak YERİNDE KALIR; bu katman onu değiştirmez.
 */

/** Prisma benzersizlik ihlali kodu. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Hata, `idempotencyKey` benzersizlik ihlali mi?
 *
 * Yalnızca bu alandan kaynaklanan çakışma idempotent tekrar sayılır; başka
 * bir unique kısıtın ihlali gerçek bir hatadır ve maskelenmemelidir.
 */
export function isIdempotencyConflict(error: unknown): boolean {
  // `instanceof` farklı bir Prisma örneğinden gelen hatada tutmayabilir;
  // kod alanına bakmak güvenli ve yeterlidir (bkz. lib/prisma-errors.ts).
  const kod =
    error instanceof Prisma.PrismaClientKnownRequestError
      ? error.code
      : (error as { code?: unknown } | null)?.code;
  if (kod !== UNIQUE_VIOLATION) return false;

  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) return target.includes("idempotencyKey");
  if (typeof target === "string") return target.includes("idempotencyKey");
  // Hedef bilgisi gelmediyse temkinli davranılır: idempotency sayılmaz.
  return false;
}

/**
 * İstek gövdesindeki idempotency anahtarı şeması.
 *
 * İsteğe bağlıdır — göndermeyen istemciler eskisi gibi çalışır. Uzunluk
 * sınırı, anahtarın veritabanına sığmasını ve kötü niyetli devasa değerleri
 * engeller. `crypto.randomUUID()` 36 karakterdir.
 */
export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8, "Idempotency anahtarı çok kısa.")
  .max(128, "Idempotency anahtarı çok uzun.")
  .optional()
  .nullable();

/** Boş string'i `null`'a çevirir; `undefined` da `null` olur. */
export function normalizeKey(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

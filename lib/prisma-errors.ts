import { Prisma } from "@/app/generated/prisma/client";

/**
 * Prisma "kayıt bulunamadı" hata kodu.
 *
 * `update`/`delete` gibi kayıt varlığını şart koşan işlemler, hedef satır yoksa
 * P2025 fırlatır. Yakalanmazsa Next.js bunu 500'e çevirir — oysa bu bir sunucu
 * hatası değil, istemcinin var olmayan bir kaynağı hedeflemesidir.
 */
const RECORD_NOT_FOUND = "P2025";

export function isRecordNotFound(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === RECORD_NOT_FOUND;
  }
  // Farklı bir Prisma örneğinden gelen hatalarda `instanceof` tutmayabilir;
  // kod alanına bakmak güvenli bir yedek.
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === RECORD_NOT_FOUND
  );
}

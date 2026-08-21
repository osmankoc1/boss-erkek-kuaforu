import "server-only";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { db } from "./db";
import {
  BLOCKING_STATUSES,
  evaluateBookingSlot,
  slotLockKey,
  startOfLocalDay,
  startOfNextLocalDay,
  localDayOfWeek,
  type BookingCheckResult,
  type BookingContext,
} from "./booking-rules";

export type { BookingCheckResult, BookingIssueCode } from "./booking-rules";

/**
 * `validateBookingSlot`'un ihtiyaç duyduğu minimum Prisma yüzeyi.
 * Hem `db` hem de `$transaction` içindeki tx client bu yapıya uyar; bu sayede
 * doğrulama, kilidin alındığı transaction'ın içinde çalıştırılabilir.
 */
export type BookingReadClient = Pick<
  PrismaClient,
  "barber" | "workingHour" | "dateException" | "appointment"
>;

/** Advisory lock için sabit ad alanı — başka amaçlı kilitlerle çakışmasın. */
const LOCK_NAMESPACE = "boss:appointment-slot";

/**
 * Berber + gün için transaction kapsamlı advisory lock alır.
 *
 * `pg_advisory_xact_lock` bilinçli olarak seçildi (session değil, xact):
 * kilit transaction bitince — commit ya da rollback fark etmeksizin, hatta
 * bağlantı kopsa bile — PostgreSQL tarafından otomatik bırakılır. Elle
 * `unlock` çağrısı yoktur, dolayısıyla hata durumunda kalıcı kilit kalmaz.
 *
 * Ayrıca xact varyantı Neon'un pooled bağlantısı (PgBouncer transaction mode)
 * ile uyumludur; session bazlı kilitler bu modda güvenilir çalışmaz.
 *
 * hashtext() iki int4 üretir: (ad alanı, berber+gün). İki farklı anahtarın
 * aynı hash'e düşmesi teorik olarak mümkündür; sonucu yalnızca gereksiz bir
 * bekleme olur, yanlış randevu değil.
 *
 * `$queryRaw` değil `$executeRaw` kullanılır: pg_advisory_xact_lock `void`
 * döner ve Prisma void kolonunu deserialize edemez.
 */
export async function acquireSlotLock(
  client: Pick<PrismaClient, "$executeRaw">,
  barberId: string,
  date: Date
): Promise<void> {
  const key = slotLockKey(barberId, date);
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCK_NAMESPACE}::text), hashtext(${key}::text))`;
}

export type ValidateBookingInput = {
  barberId: string;
  /** "YYYY-MM-DD" veya Date. */
  date: string | Date;
  /** "HH:MM" */
  startTime: string;
  /** Seçilen tüm hizmetlerin toplam süresi. */
  durationMinutes: number;
  /**
   * Randevu düzenlenirken verilir; randevunun kendisi çakışma sayılmaz.
   * (Faz 3 "randevu taşıma" işi bu parametreyi kullanacak.)
   */
  excludeAppointmentId?: string;
  /** Admin geçmişe kayıt girebilsin diye geçmiş kontrolünü atlar. */
  allowPast?: boolean;
  /** Test edilebilirlik için; verilmezse şimdiki zaman. */
  now?: Date;
  /**
   * Okumaların yapılacağı Prisma client. Eşzamanlılık korumasının işe
   * yaraması için, kilidin alındığı transaction'ın tx client'ı geçilmelidir;
   * aksi halde doğrulama kilidin dışında kalır.
   */
  client?: BookingReadClient;
};

/**
 * Bir randevu slotunun sunucu tarafında geçerli olup olmadığını doğrular.
 *
 * Veriyi toplar, kararı `evaluateBookingSlot` (saf katman) verir.
 * Tarayıcıdan gelen hiçbir bilgiye güvenilmez; süre dahil her şey
 * çağıran tarafından veritabanı kaynaklı olarak sağlanmalıdır.
 *
 * EŞZAMANLILIK: Bu fonksiyon tek başına yarış koşulunu önlemez. Yazma yoluyla
 * birlikte kullanılırken `acquireSlotLock` ile alınan kilidin transaction'ı
 * içinde, `client` olarak o transaction'ın tx client'ı geçilerek çağrılmalıdır.
 * Yalnızca okuma amaçlı çağrılarda (ör. ön kontrol) kilit gerekmez.
 */
export async function validateBookingSlot(
  input: ValidateBookingInput
): Promise<BookingCheckResult> {
  const {
    barberId,
    date,
    startTime,
    durationMinutes,
    excludeAppointmentId,
    allowPast = false,
    now = new Date(),
    client = db,
  } = input;

  const parsedDate = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsedDate.getTime())) {
    return { ok: false, code: "INVALID_INPUT", message: "Geçersiz tarih." };
  }

  // Gün sınırları yerel saat dilimine göre hesaplanır. Sunucunun
  // TZ=Europe/Istanbul olarak çalıştığı varsayılır (bkz. Faz 2 · saat dilimi).
  const dayStart = startOfLocalDay(parsedDate);
  const dayEnd = startOfNextLocalDay(parsedDate);
  const dayOfWeek = localDayOfWeek(dayStart);

  const [barber, workingHours, dateException, existingAppointments] = await Promise.all([
    client.barber.findUnique({
      where: { id: barberId },
      select: { id: true, isActive: true },
    }),
    client.workingHour.findMany({
      where: { barberId, dayOfWeek },
      select: { startTime: true, endTime: true, isOff: true },
    }),
    client.dateException.findFirst({
      where: { barberId, date: { gte: dayStart, lt: dayEnd } },
      select: { id: true },
    }),
    client.appointment.findMany({
      where: {
        barberId,
        date: { gte: dayStart, lt: dayEnd },
        status: { in: [...BLOCKING_STATUSES] },
      },
      select: { id: true, startTime: true, endTime: true },
    }),
  ]);

  // Aynı gün için birden fazla kayıt varsa çalışılan kaydı tercih et.
  // (Şemada barberId+dayOfWeek üzerinde unique kısıt yok.)
  const workingHour = workingHours.find((hour) => !hour.isOff) ?? workingHours[0] ?? null;

  const context: BookingContext = {
    barber,
    workingHour,
    hasDateException: dateException !== null,
    existingAppointments,
    dayStart,
    startTime,
    durationMinutes,
    now,
    excludeAppointmentId,
    allowPast,
  };

  return evaluateBookingSlot(context);
}

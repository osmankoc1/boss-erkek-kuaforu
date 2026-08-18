import { z } from "zod";

/**
 * Admin CRUD endpoint'lerinin giriş şemaları.
 *
 * Amaç: istemciden gelen ham JSON'un hiçbir zaman doğrudan Prisma'nın `data`
 * alanına verilmemesi. Route'lar yalnızca `parsed.data` kullanır; böylece
 * `id`, `createdAt` gibi sistem alanları veya şemada olmayan alanlar
 * veritabanına ulaşamaz.
 *
 * Zod varsayılan davranışı (strip) bilinçli tercih edildi: bilinmeyen alanlar
 * sessizce atılır. Katı reddetme (`strict`) yerine strip seçilmesinin sebebi,
 * arayüze ileride bir alan eklendiğinde formun 400 ile kırılmaması; güvenlik
 * açısından ikisi de eşdeğerdir çünkü yazmaya yalnızca `parsed.data` gider.
 */

/** "HH:MM" — 00:00 – 23:59 */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeString = z.string().regex(TIME_PATTERN, "Saat biçimi HH:MM olmalıdır.");

/** Boş metni null'a çeviren opsiyonel metin alanı. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined || v === null || v === "" ? null : v));

// ── Barber ───────────────────────────────────────────────────────────────────

const barberFields = {
  name: z.string().trim().min(1, "Ad alanı zorunludur.").max(120),
  bio: optionalText(2000),
  photoUrl: optionalText(500),
  specialty: optionalText(200),
  experienceYrs: z.number().int().min(0).max(80),
  calendarColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Renk #RRGGBB biçiminde olmalıdır."),
  isActive: z.boolean(),
  workerType: z.enum(["OWNER", "COMMISSION"]),
  commissionRate: z.number().min(0).max(100),
};

/** Yeni çalışan: yalnızca `name` zorunlu, kalanı varsayılana düşer. */
export const barberCreateSchema = z.object({
  name: barberFields.name,
  bio: barberFields.bio.optional(),
  photoUrl: barberFields.photoUrl.optional(),
  specialty: barberFields.specialty.optional(),
  experienceYrs: barberFields.experienceYrs.optional(),
  calendarColor: barberFields.calendarColor.optional(),
  isActive: barberFields.isActive.optional(),
  workerType: barberFields.workerType.optional(),
  commissionRate: barberFields.commissionRate.optional(),
});

/** Çalışan güncelleme: tüm alanlar opsiyonel (kısmi güncelleme). */
export const barberUpdateSchema = z.object({
  name: barberFields.name.optional(),
  bio: barberFields.bio.optional(),
  photoUrl: barberFields.photoUrl.optional(),
  specialty: barberFields.specialty.optional(),
  experienceYrs: barberFields.experienceYrs.optional(),
  calendarColor: barberFields.calendarColor.optional(),
  isActive: barberFields.isActive.optional(),
  workerType: barberFields.workerType.optional(),
  commissionRate: barberFields.commissionRate.optional(),
});

// ── WorkingHour ──────────────────────────────────────────────────────────────

export const workingHourCreateSchema = z.object({
  barberId: z.string().trim().min(1, "Çalışan seçilmelidir."),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: timeString,
  endTime: timeString,
  isOff: z.boolean().optional(),
});

/**
 * Çalışma saati güncelleme.
 *
 * `barberId` ve `dayOfWeek` bilinçli olarak DIŞARIDA: bir kaydın hangi
 * çalışana veya hangi güne ait olduğu sonradan değiştirilemez. Gerekiyorsa
 * kayıt silinip yenisi oluşturulur.
 */
export const workingHourUpdateSchema = z.object({
  startTime: timeString.optional(),
  endTime: timeString.optional(),
  isOff: z.boolean().optional(),
});

/**
 * Çalışılan bir gün için bitiş saati başlangıçtan sonra olmalıdır.
 * `isOff` ise saatler anlamsızdır, kontrol edilmez.
 */
export function isValidWorkWindow(startTime: string, endTime: string, isOff: boolean): boolean {
  if (isOff) return true;
  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  return toMinutes(endTime) > toMinutes(startTime);
}

/** Zod hatasını kullanıcıya gösterilebilir tek satırlık mesaja çevirir. */
export function firstIssueMessage(error: z.ZodError, fallback = "Geçersiz veri."): string {
  const issue = error.issues[0];
  if (!issue) return fallback;
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

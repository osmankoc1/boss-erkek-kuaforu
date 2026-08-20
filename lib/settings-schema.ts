import { z } from "zod";

/**
 * İşletme ayarlarının yazma şeması — TEK doğruluk kaynağı.
 *
 * `Setting` modeli serbest bir anahtar-değer deposudur; şema olmadan
 * `POST /api/settings` gönderilen HER anahtarı upsert eder. Bu, yetkili bir
 * admin oturumuyla bile istenmeyen sonuçlar doğurur: bilinmeyen anahtarlar
 * tabloyu şişirir, düz metin gövde `Object.entries` üzerinden her karakteri
 * ayrı bir ayara çevirir ve tip hataları 500'e düşer.
 *
 * Buradaki liste `SettingsForm` içindeki FIELDS ile birebir aynıdır; arayüze
 * yeni bir alan eklenirse buraya da eklenmelidir.
 *
 * Public okuma tarafındaki filtre ayrı bir listedir — bkz. `PUBLIC_SETTING_KEYS`
 * (lib/public-fields.ts). Orası "hangileri oturumsuz görülebilir" sorusunu,
 * burası "hangileri yazılabilir" sorusunu yanıtlar.
 */

/** Boş bırakılabilen metin alanı. */
const text = (max: number) => z.string().max(max);

/** Boş VEYA geçerli e-posta. Admin alanı temizleyebilmeli. */
const optionalEmail = z.union([z.literal(""), z.string().email().max(200)]);

/**
 * Boş VEYA geçerli URL.
 *
 * Üst sınır bilinçli olarak yüksek: Google Maps embed bağlantıları çok uzun
 * olabiliyor (üretimde 410 karakterlik bir örnek mevcut).
 */
const optionalUrl = z.union([z.literal(""), z.string().url().max(2000)]);

export const settingsUpdateSchema = z.object({
  business_name: text(120).optional(),
  business_phone: text(40).optional(),
  business_email: optionalEmail.optional(),
  business_address: text(400).optional(),
  maps_link: optionalUrl.optional(),
  instagram_url: optionalUrl.optional(),
  facebook_url: optionalUrl.optional(),
  resend_from_email: optionalEmail.optional(),
  // Arayüzde "true/false" metni olarak giriliyor; boş da bırakılabiliyor.
  google_calendar_enabled: z.enum(["", "true", "false"]).optional(),
  google_calendar_id: text(200).optional(),
});

export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

/** Yazılmasına izin verilen anahtarlar (log ve teşhis için). */
export const WRITABLE_SETTING_KEYS = Object.keys(settingsUpdateSchema.shape) as (keyof SettingsUpdate)[];

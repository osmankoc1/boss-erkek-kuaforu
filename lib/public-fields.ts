/**
 * Public (oturumsuz) yüzeye çıkmasına izin verilen alanların TEK tanımı.
 *
 * Buradaki listeler hem API yanıtlarında hem de sunucu bileşenlerinden
 * istemciye prop olarak geçen verilerde kullanılır. Tek yerde tutulmasının
 * sebebi, yeni bir alan eklendiğinde dört ayrı `select` içinden birinin
 * unutulup sızıntı yaratmasını engellemektir.
 */

/**
 * Müşteriye gösterilebilen berber alanları.
 *
 * Kasıtlı olarak DIŞARIDA bırakılanlar:
 * - `workerType`, `commissionRate` → çalışanın ücret anlaşması; sızması
 *   hem işletme içi kriz hem rakibe maliyet bilgisi demektir.
 * - `calendarColor` → yalnızca admin takvimi için.
 * - `isActive` → zaten filtre olarak kullanılıyor, veriyle taşınmasına gerek yok.
 * - `createdAt` → müşteriye anlamsız.
 */
export const PUBLIC_BARBER_SELECT = {
  id: true,
  name: true,
  bio: true,
  photoUrl: true,
  specialty: true,
  experienceYrs: true,
} as const;

/** `PUBLIC_BARBER_SELECT` ile çekilen bir berberin şekli. */
export type PublicBarber = {
  id: string;
  name: string;
  bio: string | null;
  photoUrl: string | null;
  specialty: string | null;
  experienceYrs: number;
};

/**
 * Oturumsuz `/api/settings` çağrısında dönebilecek ayar anahtarları.
 *
 * `business_email` bilinçli olarak dışarıdadır: sitede iletişim bilgisi olarak
 * zaten gösteriliyor olsa da, aynı değer yeni randevu bildirimlerinin gittiği
 * operasyonel adres olarak kullanılıyor (bkz. app/api/appointments/route.ts).
 * Toplu ve makine okunur biçimde servis etmek gereksiz bir spam yüzeyidir.
 *
 * Not: `resend_from_email` ve `google_calendar_*` anahtarları FAZ 3 · Sıra
 * 3.3'te tamamen kaldırıldı (hiçbir kod okumuyordu). Eski kurulumlardan
 * kalan satırlar veritabanında duruyor olabilir; bu liste onları zaten
 * tanımadığı için oturumsuz çağrıya sızmazlar.
 */
export const PUBLIC_SETTING_KEYS = [
  "business_name",
  "business_phone",
  "business_address",
  "maps_link",
  "instagram_url",
  "facebook_url",
] as const;

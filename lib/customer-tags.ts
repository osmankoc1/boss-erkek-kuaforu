/**
 * Müşteri etiketleri — TEK doğruluk kaynağı.
 *
 * `Customer.tag` şemada serbest bir `String` (varsayılan "normal"); veritabanı
 * seviyesinde bir kısıt yok. Bu yüzden geçerli değer kümesi burada tanımlanır
 * ve hem arayüz (dropdown + renk/etiket gösterimi) hem de yazma şeması
 * (lib/customer-schema.ts) buradan beslenir.
 *
 * Yeni bir etiket eklemek için tek yapılacak: aşağıdaki listeye eklemek.
 * `TAG_LABELS` bilerek `Record<CustomerTag, string>` olarak tiplendi — listeye
 * eklenen ama etiketi yazılmayan bir değer derleme hatası verir.
 */
export const CUSTOMER_TAGS = ["normal", "düzenli", "VIP", "sorunlu"] as const;

export type CustomerTag = (typeof CUSTOMER_TAGS)[number];

export const TAG_LABELS: Record<CustomerTag, string> = {
  normal: "Normal",
  düzenli: "Düzenli",
  VIP: "VIP",
  sorunlu: "Sorunlu",
};

export function isCustomerTag(value: unknown): value is CustomerTag {
  return typeof value === "string" && (CUSTOMER_TAGS as readonly string[]).includes(value);
}

/**
 * Gösterim etiketi. Veritabanından gelen `tag` tip olarak `string` olduğu için
 * (Prisma alanı serbest metin), tanınmayan bir değer geldiğinde ham hâliyle
 * gösterilir — arayüz boş hücre göstermez.
 */
export function tagLabel(tag: string): string {
  return isCustomerTag(tag) ? TAG_LABELS[tag] : tag;
}

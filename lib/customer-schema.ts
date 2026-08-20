import { z } from "zod";
import { CUSTOMER_TAGS } from "./customer-tags";

/**
 * `PATCH /api/customers/[id]` gövde şeması.
 *
 * Yalnızca `tag` ve `notes` yazılabilir; gövdedeki diğer alanlar Zod'un
 * varsayılan strip davranışıyla atılır (id, sayaçlar, telefon vb. bu uçtan
 * değiştirilemez).
 *
 * - `tag`   : yalnızca CUSTOMER_TAGS içindeki değerler. Gönderilmezse mevcut
 *             değer korunur (arayüz her zaman gönderiyor, ama uç bunu şart
 *             koşmuyor).
 * - `notes` : metin veya null. Uzunluk sınırı bilinçli olarak yok — mevcut
 *             davranış korunuyor, alan Postgres tarafında `text`.
 */
export const customerUpdateSchema = z.object({
  tag: z
    .enum(CUSTOMER_TAGS, {
      error: `Geçersiz etiket. Geçerli değerler: ${CUSTOMER_TAGS.join(", ")}`,
    })
    .optional(),
  notes: z.string().nullable().optional(),
});

export type CustomerUpdate = z.infer<typeof customerUpdateSchema>;

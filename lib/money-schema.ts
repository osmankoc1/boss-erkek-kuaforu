import { z } from "zod";
import { hasValidMoneyScale, MONEY_SCALE_ERROR, RATE_SCALE_ERROR } from "./money";

/**
 * Para ve oran girdilerinin doğrulama şemaları (FAZ 2 · Sıra 9a).
 *
 * ÜRÜN KARARI: 2 ondalık haneden fazla tutar **reddedilir** (400).
 * Sunucu sessizce yuvarlamaz.
 *
 * Neden: `Decimal(12,2)` kolonuna `19.999` yazılırsa PostgreSQL onu sessizce
 * `20.00` yapar. Kullanıcının girdiği tutarla kaydedilen tutar farklı olur ve
 * kimse bunu fark etmez. Aynı gerekçeyle Sıra 6'da "kalan borçtan fazlasını
 * kırpma, isteği reddet" kararı verilmişti; bu onun devamıdır.
 *
 * `lib/money.ts` içindeki `hasValidMoneyScale` sayının EN KISA gösterimine
 * bakar: `0.1 + 0.2` sonucu `0.30000000000000004` olarak görünür ve reddedilir.
 * Bu doğru davranıştır — istemci kuruşa yuvarlanmış bir tutar göndermelidir.
 */

/** Kuruş hassasiyetini zorunlu kılan para tutarı. */
export const moneyAmount = z.number().refine(hasValidMoneyScale, { error: MONEY_SCALE_ERROR });

/** Yüzde oranı — o da `Decimal(5,2)` olduğu için 2 haneyle sınırlı. */
export const rateAmount = z.number().refine(hasValidMoneyScale, { error: RATE_SCALE_ERROR });

/**
 * Kasa satış modalindeki tutar senkronizasyonu (FAZ 3 · Sıra 3.7A).
 *
 * ─── NEDEN AYRI DOSYA ────────────────────────────────────────────────────
 * Bu kural bir React effect'inin içine gömülüydü ve test edilemiyordu.
 * Projede bileşen testi koşucusu yok; kuralı saf bir fonksiyona çıkarmak,
 * davranışı gerçek bir regresyon testiyle kilitlemenin en ucuz yolu.
 *
 * ─── ÇÖZDÜĞÜ HATA ────────────────────────────────────────────────────────
 * Önceki effect, seçili hizmetler her değiştiğinde tahsilatı da toplama
 * eşitliyordu — kullanıcının ELLE girdiği tahsilatı ezerek. Gerçek arayüzde
 * kanıtlandı:
 *
 *   1) SAÇ+SAKAL (600) seçildi      → Satış 600  Ödenen 600  Kalan   0.00
 *   2) Ödenen ELLE 200 yapıldı      → Satış 600  Ödenen 200  Kalan 400.00
 *   3) İkinci hizmet (200) eklendi  → Satış 800  Ödenen 800  Kalan   0.00
 *
 * Üçüncü adımda 400 ₺'lik veresiye sessizce kayboluyordu. Kaydedilirse
 * müşterinin borcu hiç oluşmuyor: doğrudan finansal kayıp.
 *
 * ─── KURAL ───────────────────────────────────────────────────────────────
 * Kullanıcı tahsilata bir kez dokunduysa o değer KORUNUR. Yalnızca yeni
 * satış tutarını aşamaz — tahsilat satıştan büyük olamaz.
 */

export type TutarGirdisi = {
  /** Seçili hizmetlerin fiyat toplamı. */
  toplam: number;
  /** Kullanıcı satış tutarını elle değiştirdi mi. */
  tutarElleGirildi: boolean;
  /** Kullanıcı tahsilatı elle değiştirdi mi. */
  tahsilatElleGirildi: boolean;
  /** Ekrandaki mevcut satış tutarı. */
  mevcutTutar: number;
  /** Ekrandaki mevcut tahsilat. */
  mevcutTahsilat: number;
};

export type TutarSonucu = {
  saleAmount: number;
  paidAmount: number;
};

/**
 * Hizmet seçimi değiştiğinde satış tutarı ve tahsilatın ne olacağını verir.
 *
 * - Satış tutarı elle girildiyse dokunulmaz.
 * - Tahsilat elle girildiyse korunur, ama satış tutarını aşamaz.
 * - Hiçbiri elle girilmediyse ikisi de toplama eşitlenir (eski davranış).
 */
export function senkronizeTutarlar(g: TutarGirdisi): TutarSonucu {
  const saleAmount = g.tutarElleGirildi ? g.mevcutTutar : g.toplam;

  const paidAmount = g.tahsilatElleGirildi
    ? Math.min(g.mevcutTahsilat, saleAmount)
    : saleAmount;

  return { saleAmount, paidAmount };
}

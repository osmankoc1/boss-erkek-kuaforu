# Sıra 10 — Denetim İzi ve Düzenleme Geçmişi (TAMAMLANDI)

**Durum:** Sıra 10b'de uygulandı ve production'a alındı.
**Migration:** `20260825094005_audit_log`
**Doğrulama:** `scripts/verify-audit-log.ts` (110 kontrol),
`scripts/verify-appointment-delete-audit.ts` (59 kontrol)

Bu dosya, kararın **neden** böyle verildiğini kayıt altında tutar. Karşılaştırma
tablosu ve gerekçeler korunmuştur; uygulanmadan önce yazılmış "yapılacak"
ifadeleri, verilen kararlarla değiştirilmiştir.

---

## Çözülen açık

Sıra 10 analizinde kanıtlanan durum şuydu:

| Bulgu | O günkü ölçüm |
|---|---|
| Denetim/geçmiş tablosu | Yok |
| `Sale`, `CustomerPayment`, `BarberPayout`, `Expense`'te aktör alanı | Hiçbirinde yok |
| Satış düzenlemesinde önceki tutar | Saklanmıyor — `1000 → 700` geri getirilemez |
| Hakediş geriye dönük değişimi | `barberShare 400 → 280` sessizce |
| Kullanıcı notu | Düzenlemede eziliyor |

**Pratik sonuç:** Tek admin varken görünmez. İkinci kullanıcı eklendiği anda
"bu satışı kim değiştirdi" sorusu cevapsız kalırdı.

Bunların tamamı merkezi `AuditLog` ile kapandı.

---

## Uygulanan model

```prisma
model AuditLog {
  id       String @id @default(cuid())
  entity   String   /// "Sale" | "CustomerPayment" | "BarberPayout" | "Expense" | "Customer" | "Appointment" | "Setting"
  entityId String
  action   String   /// "CREATE" | "UPDATE" | "VOID" | "DELETE" | "MERGE" | "STATUS_CHANGE"
  source   String   /// "ADMIN" | "PUBLIC" | "SYSTEM"

  /// Aktör — yalnızca ADMIN kaynaklı işlemlerde dolu.
  /// `User`'a FK YOKTUR: saklama süresi sınırsız, kullanıcı silinse bile
  /// iz ayakta kalmalı. E-posta o anki haliyle snapshot'lanır.
  userId    String?
  userEmail String?

  /// Yalnızca DEĞİŞEN alanlar: { "saleAmount": { "before": 1000, "after": 700 } }
  changes   Json?
  createdAt DateTime @default(now())

  @@index([createdAt])
  @@index([entity, entityId, createdAt])
  @@index([entity, action, createdAt])
  @@index([source, createdAt])
}
```

Taslaktan iki sapma oldu, ikisi de bilinçli:

- **`source` ayrı bir alan olarak eklendi.** Kaynak bilgisini `userEmail`
  içine sentinel metin olarak gömmek, o alanı hem kimlik hem etiket yapardı.
- **`changes` içinde `from/to` yerine `before/after` kullanıldı** ve alan
  seçimi fail-closed whitelist'e bağlandı (`lib/audit.ts`): listede olmayan
  hiçbir alan denetim izine giremez. Yarın şemaya `apiKey` eklense bile
  otomatik olarak dışarıda kalır.

---

## Neden merkezi tablo — model başına alan değil

| | Merkezi `AuditLog` | Model başına `createdByUserId` |
|---|---|---|
| Migration yüzeyi | 1 yeni tablo | 4+ tabloya kolon |
| "Kim oluşturdu" | ✅ | ✅ |
| "Kim değiştirdi, neyi, neden" | ✅ | ❌ yalnızca son değiştiren |
| Önceki değer | ✅ `changes` içinde | ❌ |
| Sorgu kolaylığı | Tek yerden zaman çizelgesi | Her tabloya ayrı bakmak |
| Yazma maliyeti | Her işlemde +1 satır | Yok |
| Büyüme | Sınırsız — saklama politikası gerekir | Yok |

**Karar:** Merkezi `AuditLog`. Asıl ihtiyaç "kim oluşturdu" değil,
**"kim neyi neye çevirdi"**; model başına alan bunu karşılamıyor.

Bu yüzden para modellerinde aktör alanı bilerek YOKTUR. `verify-audit-trail.ts`
bunu bilgi olarak basar — eksiklik değil, bu kararın sonucudur.

---

## Verilen kararlar

| Soru | Karar |
|---|---|
| Merkezi tablo mu, model başına alan mı? | **Merkezi `AuditLog`** |
| Hangi işlemler kaydedilsin? | Satış oluştur/düzenle/VOID, tahsilat, hakediş ödemesi, gider, müşteri birleştirme, **işletme açısından kritik** randevu durum geçişleri, randevu silme, ayar değişikliği. Rutin `pending_verification → pending` geçişi KAYDEDİLMEZ — hacimli ve düşük değerli. |
| Saklama süresi? | **Sınırsız.** Silme/düzenleme ucu bilinçli olarak yoktur: denetim izi değiştirilebilir olsaydı denetim izi olmazdı. |
| Kim görecek? | **Ayrı admin ekranı** — `/admin/denetim`. Satır içi geçmiş tercih edilmedi. |
| Geçmiş veri? | **Backfill yapılmadı**, yapılamazdı. Yalnızca bu katman devreye girdikten sonraki işlemler kayıtlı. Kabul edildi. |

---

## Değişmezler

1. Denetim satırı ana işlemle **aynı transaction'da** yazılır.
2. Denetim yazılamazsa **ana işlem de commit edilmez** — `writeAudit` hatayı
   yutmaz. Para hareketi denetim izi olmadan kaydedilmez.
3. `changes` yalnızca **değişen** alanları tutar; komple satır saklanmaz.
4. Alan seçimi **fail-closed whitelist** ile yapılır (denylist değil).

---

## Sonradan eklenenler

**FAZ 3 · Sıra 3.2 — randevu silme.** `DELETE /api/appointments/[id]` denetim
izine bağlandı. Randevu silindiğinde `Sale.appointmentId` NULL'a çekildiği için
bağlı satış id'leri, ilişki koparılmadan **önce** okunup `changes.saleIds`
içinde saklanır. Satış ayakta kalır; hangi randevudan geldiği yalnızca denetim
izinde durur.

---

## Sıra 10 kapsamında ayrıca çözülenler

Migration gerektirmeyen dört konu (Sıra 10a): byMethod VOID atfı, pendingKasa,
indirim görünürlüğü, negatif kalan. Doğrulaması `scripts/verify-audit-trail.ts`
içinde.

`/api/cash` POST'un **walk-in yolu** da Sıra 10b'de tek transaction'a alındı —
önceden satış ve ödeme defteri satırı ayrı yazılıyordu ve defter satırı
yazılamazsa `Σ(defter) = paidAmount` değişmezi bozulabiliyordu.

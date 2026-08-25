# Sıra 10 — Denetim İzi ve Düzenleme Geçmişi (ERTELENDİ)

**Durum:** Analiz edildi, kanıtlandı, **uygulanmadı.** Şemaya dokunulmadı.
**Neden ertelendi:** Migration gerektiriyor ve ürün kararı bekliyor.

Sıra 10'un migration gerektirmeyen dört konusu (byMethod VOID atfı,
pendingKasa, indirim görünürlüğü, negatif kalan) tamamlandı ve canlıya
alınmaya hazır. Bu dosya kalan iki konu için **sonraki adımda** yapılacak
analizin başlangıç noktasıdır.

---

## Kanıtlanmış açık

`scripts/verify-audit-trail.ts` bunları her koşuda bilgi olarak basar
(başarısızlık saymaz):

| Bulgu | Ölçüm |
|---|---|
| Denetim/geçmiş tablosu | **Yok** |
| `Sale`, `CustomerPayment`, `BarberPayout`, `Expense`'te aktör alanı | **Hiçbirinde yok** |
| `User` modeline referans veren model | **Hiçbiri** |
| Satış düzenlemesinde önceki tutar | **Saklanmıyor** — `1000 → 700` geri getirilemez |
| Hakediş geriye dönük değişimi | `barberShare 400 → 280` **sessizce**, eski değer yok |
| Kullanıcı notu | Düzenlemede **eziliyor** |

**Pratik sonuç:** Tek admin varken görünmez. İkinci kullanıcı eklendiği anda
"bu satışı kim değiştirdi" sorusu cevapsız kalır.

---

## Sonraki adımda değerlendirilecek yaklaşım: merkezi `AuditLog`

### Taslak model (HENÜZ UYGULANMADI)

```prisma
model AuditLog {
  id         String   @id @default(cuid())
  /// Hangi tablo: "Sale", "CustomerPayment", "BarberPayout", "Expense"
  entity     String
  entityId   String
  /// "CREATE" | "UPDATE" | "VOID" | "DELETE"
  action     String
  /// İşlemi yapan admin. Silinen kullanıcıda kayıt kalsın diye ilişki
  /// zorunlu tutulmaz; ad ayrıca snapshot'lanır.
  userId     String?
  userEmail  String?
  /// Yalnızca DEĞİŞEN alanlar: { "saleAmount": { "from": 1000, "to": 700 } }
  changes    Json?
  createdAt  DateTime @default(now())

  @@index([entity, entityId, createdAt])
  @@index([createdAt])
}
```

### Merkezi tablo vs. model başına alan — karşılaştırma

| | Merkezi `AuditLog` | Model başına `createdByUserId` |
|---|---|---|
| Migration yüzeyi | 1 yeni tablo | 4+ tabloya kolon |
| "Kim oluşturdu" | ✅ | ✅ |
| "Kim değiştirdi, neyi, neden" | ✅ | ❌ yalnızca son değiştiren |
| Önceki değer | ✅ `changes` içinde | ❌ |
| Sorgu kolaylığı | Tek yerden zaman çizelgesi | Her tabloya ayrı bakmak |
| Yazma maliyeti | Her işlemde +1 satır | Yok |
| Büyüme | Sınırsız — saklama politikası gerekir | Yok |

**İlk değerlendirme:** Merkezi `AuditLog` daha uygun görünüyor; asıl ihtiyaç
"kim oluşturdu" değil, **"kim neyi neye çevirdi"**. Model başına alan bunu
karşılamıyor. Ancak karar kullanıcıya ait.

### Uygulama notları (analiz edilecek)

- **Aktör nereden gelir:** `requireAdmin()` zaten oturumu çözüyor; `userId`
  buradan alınabilir. `lib/dal.ts` incelenmeli.
- **Nereye yazılır:** İlgili işlemler zaten `db.$transaction` içinde
  (`/api/cash`, `/api/cash/[id]`, `void`, `debts/payment`, `payouts`).
  Log satırı aynı transaction'a girmeli — yoksa işlem başarılı olup log
  yazılmayabilir.
- **Prisma middleware/extension** ile otomatik yakalama düşünülebilir; ancak
  aktör bilgisi request bağlamından geldiği için açık çağrı daha öngörülebilir.
- **`changes` alanı** yalnızca farkı tutmalı; tüm satırı kopyalamak tabloyu
  hızla şişirir.

---

## Karar bekleyen sorular

1. **Merkezi `AuditLog` mu, model başına aktör alanı mı?**
2. **Hangi işlemler kaydedilsin?** (öneri: satış oluştur/düzenle/VOID,
   tahsilat, hakediş ödemesi, gider — yani para hareketleri)
3. **Saklama süresi var mı?** Sınırsız büyüme mi, N ay sonra arşiv/silme mi?
4. **Kim görecek?** Ayrı bir admin ekranı mı, yoksa satış detayında satır içi
   geçmiş mi?
5. **Geçmiş veri:** Mevcut kayıtlar için geriye dönük log üretilmeyecek
   (üretilemez); bu kabul ediliyor mu?

---

## Kapsam dışı ama not edilen

`/api/cash` POST'un **walk-in yolunda** satış ve ödeme defteri satırı
**transaction dışında** yazılıyor (randevulu yol transaction içinde).
Ödeme satırı yazılamazsa `Σ(defter) = paidAmount` değişmezi bozulur.
Sıra 10 başlıklarından biri değil; ayrıca karara bağlanmalı.

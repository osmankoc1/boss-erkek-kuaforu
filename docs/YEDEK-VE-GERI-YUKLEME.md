# Yedek ve Geri Yükleme

**Amaç:** Bir hata anında "yedek var mı, ne kadar eski, nasıl dönerim?"
sorularının cevabının önceden yazılı olması. Panik anında öğrenilen prosedür,
prosedür değildir.

**Korunan:** 18 tablo — satışlar, tahsilatlar, hakediş ödemeleri, giderler,
müşteriler, randevular ve denetim izi. Yani işletmenin tüm finansal kaydı.

> **Bu belge bir tatbikatın yerini tutmaz.** Aşağıdaki geri yükleme adımları
> henüz GERÇEK BİR RESTORE ile denenmemiştir (FAZ 3 · Sıra 3.5B, backlog).
> İlk gerçek geri yükleme, üretimde değil bir dev branch üzerinde
> denenmelidir.

---

## 1. Branch mantığı

Veritabanı Neon üzerinde. Neon'da "branch", kaynağın kopyala-yaz (copy-on-write)
bir görüntüsüdür: anında oluşur, yer kaplamaz, ve alındığı andaki veriyi
dondurur. Bu projede üç tür branch kullanılıyor:

| Branch | Rolü | Kim yazar |
|---|---|---|
| **production** (varsayılan) | Canlı veri. `bosskuafor.com.tr` buraya bağlı. | Yalnızca uygulama |
| **`hardening-dev-*`** | Geliştirme ve test hedefi. Tüm `scripts/verify-*.ts` buraya yazar. | Geliştirme, testler |
| **`pre-*`** | Riskli bir deploy ÖNCESİ alınan dondurulmuş kopya. | Kimse — dokunulmaz |

Mevcut geliştirme branch'i: `hardening-dev-2026-08-17` (endpoint `ep-royal-haze-…`).

Şimdiye kadar alınan `pre-*` yedekleri, adlarını korudukları işten alır:
`pre-decimal-2026-08-24`, `pre-idempotency-2026-08-25`, `pre-auditlog-2026-08-25`.

### Neden `pre-*` branch'leri silinmiyor

Yer kaplamadıkları için silmenin faydası yok, tutmanın maliyeti yok. Bir
sorunun deploy'dan kaç gün sonra fark edileceği önceden bilinemez.

---

## 2. Hangi deploy'da yedek gerekir

| Deploy türü | Yedek | Gerekçe |
|---|---|---|
| **Migration içeriyor** (`prisma/migrations/` altında yeni klasör) | **ZORUNLU** | Şema değişikliği geri alması en zor işlemdir. |
| Veri dönüştürme / toplu güncelleme scripti | **ZORUNLU** | Kod `git revert` ile döner, veri dönmez. |
| Yalnızca kod / metin / doküman | Gerekmez | `git revert` + yeniden deploy yeterli. |

Kural: **`git revert` ile geri alınamayan her şey yedek ister.**

Referans: FAZ 2'de bu kural üç kez uygulandı — Decimal migration'ı,
idempotency alanı ve AuditLog tablosu öncesinde. FAZ 3'te (3.1–3.4) hiçbir
migration olmadığı için yedek alınmadı; doğru karardı.

---

## 3. Deploy öncesi kontrol listesi

Migration içeren bir deploy'dan önce, **sırayla**:

1. **Yedek branch'i oluştur.** Neon konsolu → Branches → Create branch.
   Ad: `pre-<isin-adi>-<YYYY-MM-DD>` (örn. `pre-auditlog-2026-08-25`).

2. **Parent'ı DOĞRULA — en kritik adım.**
   Yeni branch'in parent'ı **production** olmalı. Konsolda branch detayında
   "Parent branch" alanına bakın.

   > Parent yanlışsa (örneğin `hardening-dev`), elinizde production verisinin
   > yedeği YOKTUR — geliştirme verisinin yedeği vardır. Bu, yedek almamaktan
   > daha tehlikelidir: yedek aldığınızı sanırsınız.

3. **Migration'ı önce dev branch'te uygula ve test et.** Production'a hiç
   bağlanmadan: `npm run db:push` (dev `.env.local` ile).

4. **Tam regresyonu koştur.** `scripts/verify-*.ts` paketlerinin tamamı.

5. **Push et.** Vercel build'i `prisma migrate deploy` çalıştırır.

6. **Build logunu oku.** Şunları gör:
   - `Cloning … (Commit: <beklenen SHA>)`
   - `Applying migration <ad>` (veya migration yoksa `No pending migrations to apply.`)
   - `Build Completed` / `Deployment completed`

7. **Deploy sonrası salt-okuma smoke test.** Public sayfalar 200, admin
   sayfaları 307, ilgili API'ler beklenen kodu dönüyor. Runtime loglarında
   5xx ve Prisma hatası yok.

---

## 4. Geri yükleme

### Önce dur ve tespit et

Geri yükleme veri kaybeder: yedek anından sonraki **tüm** gerçek işlemler
silinir. Bir günlük satış kaydı, bir migration hatasından daha pahalı olabilir.

Sırayla sorun:

1. Sorun **kodda mı, veride mi?** Kodsa `git revert` + yeniden deploy yeterli;
   veriye dokunmayın.
2. Veriyse **kaç kayıt etkilendi?** Az sayıdaysa elle düzeltmek, geri
   yüklemekten daha az kayıp verir. Denetim izi (`/admin/denetim`) neyin
   değiştiğini gösterir.
3. Sorun **ne zaman başladı?** Geri dönülecek an bundan öncesi olmalı.

### Yol A — Yedek branch'ten geri dönme (bilinen bir deploy'u geri almak)

Elinizde o işin `pre-*` branch'i varsa:

1. Neon konsolunda `pre-*` branch'ini bulun; **parent'ının production
   olduğunu** doğrulayın.
2. Verinin gerçekten beklediğiniz halde olduğunu **okuyarak** teyit edin
   (Neon SQL Editor ile birkaç `SELECT`). Geri dönmeden önce bakın.
3. Neon'un branch restore işlemiyle production'ı bu branch'e döndürün.
4. Uygulamayı ilgili commit'e `git revert` edip yeniden deploy edin —
   şema eski hale döndüyse yeni kod çalışmaz.

### Yol B — Zaman içinde bir noktaya dönme (PITR)

Yedek branch'i yoksa Neon'un point-in-time recovery özelliği kullanılır:
belirli bir ana ait yeni bir branch oluşturulur, içeriği doğrulanır, sonra
production'a döndürülür.

> **PITR penceresi bu belgede yazılmamıştır — Neon planına bağlıdır ve
> doğrulanmamıştır.** Tahmin etmeyin. Neon konsolunda projenin ayarlarından
> "History retention" / "Restore window" değerini okuyun. Bu süre dolduktan
> sonra o ana dönmek MÜMKÜN DEĞİLDİR; `pre-*` branch'leri tam da bu yüzden
> alınır ve silinmez.

### Geri yükleme sonrası

- Uygulama sürümünün şemayla uyumlu olduğunu doğrulayın.
- Salt-okuma smoke test: public 200, admin 307, API'ler beklenen kod.
- Runtime loglarını kontrol edin (Prisma hatası, 5xx).
- **Ne kaybedildiğini yazın:** hangi an geri dönüldü, o andan sonraki hangi
  işlemler kayboldu. Bu bilgi olmadan kasa ve veresiye kayıtları müşteriyle
  uyuşmaz.

---

## 5. Yanlış hedefe yazmaya karşı koruma

`lib/db-guard.ts` fail-closed bir allowlist uygular: `scripts/verify-*.ts`
paketleri production veritabanına bağlanmayı **reddeder**. Koruma
`scripts/verify-db-guard.ts` ile doğrulanır.

Bu koruma devre dışı bırakılmamalıdır. Test scriptlerinin yanlışlıkla canlı
veriye yazmasını engelleyen tek katman odur.

---

## 6. Bilinen boşluklar

| Boşluk | Durum |
|---|---|
| Gerçek geri yükleme hiç denenmedi | **Açık** — FAZ 3 · Sıra 3.5B, backlog |
| Yedeğin varlığını otomatik doğrulayan script yok | **Açık** — `NEON_API_KEY` gerektirir; şimdilik sağlanmadı |
| PITR penceresi belgelenmedi | **Bilinçli** — plana bağlı, konsoldan doğrulanmalı |

Otomatik doğrulama olmadığı sürece, yedeğin varlığı ve parent'ı **elle**
teyit edilir (madde 3, adım 2).

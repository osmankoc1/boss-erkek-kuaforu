# Backlog — V1.0 sonrasına bırakılanlar

FAZ 3 kapanışında kanıtlanmış, değerlendirilmiş ve **bilinçli olarak
ertelenmiş** işler. Hiçbiri V1.0'ı engellemiyor.

Buraya bir madde girdiyse: problem gerçekten var, ölçüldü, ve şimdi
yapılmamasının gerekçesi yazıldı.

---

## 1. Lint borcu — 36 problem / 17 hata

Analizde risk kategorilerine ayrıldı. **35'i kod kalitesi, 1'i çözüldü.**

### Çözüldü — Kategori A (1)

`SaleModal` tahsilat ezme hatası. `react-hooks/set-state-in-effect`
uyarısının altında gerçek bir finansal hata çıktı; FAZ 3 · Sıra 3.7A'da
kanıtlandı ve düzeltildi. Bkz. `lib/sale-amounts.ts`,
`scripts/verify-sale-amounts.ts`.

### Ertelendi — Kategori B: teorik render riski (6)

`react-hooks/set-state-in-effect`, veri/para/güvenlik riski YOK:

| Dosya | Satır | Kalıp |
|---|---|---|
| `components/site/AnimatedHero.tsx` | 82 | mount bayrağı (`setMounted(true)`) |
| `components/site/AnimatedCheckmark.tsx` | 34 | mount bayrağı |
| `kasa/SaleModal.tsx` | 63 | arama sonuçlarını temizleme (erken çıkış) |
| `randevular/AdminAppointmentModal.tsx` | 57 | arama sonuçlarını temizleme |
| `musteriler/[id]/MergeCustomerButton.tsx` | 42 | arama sonuçlarını temizleme |
| `musteriler/[id]/MergeCustomerButton.tsx` | 38 | modal kapanınca form sıfırlama |

**Neden ertelendi:** En kötü sonuç bir fazladan render. Bunları susturmak için
çalışan `useEffect` yapılarını yeniden yazmak, bugün doğru çalışan modal ve
arama akışlarına gerçek risk sokar. Kazanç sıfıra yakın, risk gerçek.

İki mount bayrağı ayrıca hidrasyon uyuşmazlığını önlemek için bilinçli
konulmuştur; dosyalarında gerekçesi yazılıdır.

### Ertelendi — Kategori C: kozmetik (10 hata + 19 uyarı)

| Kural | Adet | Etki |
|---|---|---|
| `react/no-unescaped-entities` | 6 | Yok — React zaten doğru render ediyor |
| `@next/next/no-html-link-for-pages` | 2 | Tam sayfa yenileme; yalnızca hız |
| `@typescript-eslint/no-explicit-any` | 1 | Tek noktada tip güvenliği kaybı |
| `prefer-const` | 1 | Yok |
| `@typescript-eslint/no-unused-vars` | 13 (uyarı) | Yok — ölü kod işareti |
| `@next/next/no-img-element` | 5 (uyarı) | Public sitede görsel optimizasyonu kaçırılmış |
| Kullanılmayan `eslint-disable` | 1 (uyarı) | Yok |

**Neden ertelendi:** Hiçbirinin davranış etkisi yok. Sırf sayıyı sıfırlamak
için koda dokunmak, V1.0'a hiçbir şey katmaz.

**Ele alınırsa öncelik sırası:** `no-img-element` (5) gerçek bir kullanıcı
faydası taşıyan tek madde — public sayfa hızı. Diğerleri tamamen mekanik.

---

## 2. FAZ 3 · Sıra 3.5B — Gerçek geri yükleme tatbikatı

Prosedür yazıldı (`docs/YEDEK-VE-GERI-YUKLEME.md`) ama **hiç denenmedi.**

**Neden ertelendi:** Tatbikat, tanımı gereği bir restore işlemi gerektirir.
Ayrı bir oturumda, ayrı onayla ve dev branch üzerinde yapılmalıdır.

**Yapıldığında:** sonucu ve karşılaşılan sapmaları prosedür belgesine işleyin;
belgedeki "denenmemiştir" uyarısını kaldırın.

---

## 3. FAZ 3 · Sıra 3.6C — Cron izleme genişletmeleri

Sıra 3.6'da yalnızca minimum yapıldı: başarısızlıkta 5xx + günlük özet
e-postası.

Ertelenenler:

- **`Notification` tablosuna yazma.** Tablo şemada mevcut ama ürün kodunda
  hiç kullanılmıyor — gönderilen/başarısız e-postaları kaydetmek için
  tasarlanmış, hiç bağlanmamış. Geçmişe dönük gönderim raporu istenirse
  doğal veri kaynağı budur. Migration gerekmez.
- **Admin izleme ekranı.** Günlük özet e-postası bugünlük yeterli.
- **Gönderim geçmişi / trend raporu.**

---

## 4. Ölü şema artıkları

Zararsız oldukları test edilerek doğrulandı; temizlenmeleri bir davranış
değişikliği değil, düzen işidir.

| Artık | Durum |
|---|---|
| `Notification` tablosu | Şemada var, ürün kodunda hiç kullanılmıyor |
| `Appointment.googleEventId` sütunu | Hiçbir kod yazmıyor (Google Calendar entegrasyonu yok). Kaldırmak **migration gerektirir** |
| `business_hours` ayar satırı | Okunmuyor; çalışma saatleri `WorkingHour` tablosundan geliyor. Yazma şemasında ve arayüzde zaten yok |
| `resend_from_email`, `google_calendar_enabled` ayar satırları | FAZ 3 · Sıra 3.3'te üründen kaldırıldı; production veritabanında eski satırlar duruyor. Silinmeleri bir production veri işlemidir, ayrı onay ister |

---

## 5. Geliştirme ortamı — Turbopack `0xc0000142` (Windows)

Uzun süre açık kalan `next dev` sunucusunda Turbopack, PostCSS işçi sürecini
başlatamıyor (`STATUS_DLL_INIT_FAILED`). Sonuç: **tüm admin sayfaları 500
döner**, API'ler sağlam kalır. Bu oturumda üç kez tekrarladı ve her seferinde
sahte test hataları üretti.

**Production'ı ETKİLEMEZ** — Vercel'in Linux build ortamında görülmez.

**Geçici çözüm:** dev sunucusunu yeniden başlatmak; veya testleri
`next build && next start` ile production build'e karşı koşturmak.

**Teşhis ipucu:** admin sayfaları 500, API'ler 200/401 dönüyorsa önce
`._dev.log` içinde `0xc0000142` arayın — ürün kodunda hata aramayın.

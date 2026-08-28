# BOSS Erkek Kuaförü

Kuaför salonu için randevu ve işletme yönetim sistemi. Public site üzerinden
müşteri randevu alır; admin panelinden randevular, kasa, veresiye, hakediş,
gider ve gün sonu yönetilir.

Canlı: [bosskuafor.com.tr](https://bosskuafor.com.tr) — Vercel + Neon PostgreSQL.

## Teknoloji

Next.js 16 (App Router, Turbopack) · React 19 · Prisma 7 + PostgreSQL 18 ·
Tailwind 4 · Zod 4 · `decimal.js` · `jose` (oturum) · Resend (e-posta)

## Kurulum

```bash
npm install
```

`.env.local` dosyası gerekir (repoda YOK, `.gitignore` kapsamında):

| Değişken | Ne için |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL bağlantısı |
| `DIRECT_URL` | Migration için doğrudan bağlantı |
| `SESSION_SECRET` | Oturum JWT imzası |
| `RESEND_API_KEY` | E-posta gönderimi |
| `RESEND_FROM_EMAIL` | Gönderici adres — **ayarlardan değil, buradan okunur** |
| `NEXT_PUBLIC_SITE_URL` | Bağlantı üretimi |
| `CRON_SECRET` | Zamanlanmış iş kimlik doğrulaması |

Seed için isteğe bağlı: `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME`.

```bash
npm run db:push     # migration uygula (geliştirme)
npm run db:seed     # admin + varsayılan ayarlar + örnek veri
npm run dev         # http://localhost:3000
```

## Para birimi

Tüm parasal alanlar veritabanında `Decimal(12,2)`, kodda `decimal.js`
(`lib/money.ts`). Hesaplamalarda `number` kullanılmaz — yalnızca ekrana
basarken çevrilir. Prisma `Decimal` nesneleri Client Component'e **prop olarak
geçirilemez**; sessizce boş gelir. `serializeMoney` / `serializeSale` ile
dönüştürün.

## Testler

`scripts/verify-*.ts` altında 31 bağımsız paket. Her biri kendi verisini
oluşturur ve sonunda siler. Dev sunucusu ayakta olmalı:

```bash
npx dotenv -e .env.local -- tsx scripts/verify-audit-log.ts
```

Hepsini koşturmak için paketleri sırayla çalıştırın; her paket
`TOPLAM / GECEN / KALAN` özeti basar ve hata varsa çıkış kodu 1 olur.

## Veritabanı güvenliği

`lib/db-guard.ts` fail-closed bir allowlist uygular: **test paketleri
production veritabanına bağlanmayı reddeder.** Geliştirme yalnızca ayrı bir
Neon branch'i üzerinde yapılır. Bu koruma `verify-db-guard.ts` ile
doğrulanır — devre dışı bırakmayın.

## Dağıtım

`main` dalına push, Vercel'de production deploy'u tetikler.
Build komutu migration'ları da uygular:

```
prisma generate && prisma migrate deploy && next build
```

Şema değişikliği içeren bir deploy öncesi Neon'da yedek branch alın.

## Dizin yapısı

```
app/(site)      public site — statik (ISR), mutasyonlarda revalidatePath
app/(admin)     admin panel — dinamik, oturum korumalı
app/api         REST uçları
lib             para, denetim izi, oturum, saat dilimi, alan filtreleri
prisma          şema, migration'lar, seed
scripts         doğrulama paketleri
docs            karar notları
```

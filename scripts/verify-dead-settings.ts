/**
 * Ölü ayarların temizliği (FAZ 3 · Sıra 3.3).
 *
 * Çalıştırma (dev server ayakta olmalı):
 *   npx dotenv -e .env.local -- tsx scripts/verify-dead-settings.ts
 *
 * ─── NEDEN BU TEST VAR ───────────────────────────────────────────────────
 * Üç ayar anahtarı hiçbir işe yaramıyordu ama admin panelinde DÜZENLENEBİLİR
 * alan olarak duruyordu:
 *
 *   • `resend_from_email` — en zararlısı. Panelde "Gönderici E-posta (Resend)"
 *     yazıyor, kaydedince 200 dönüyor, ama `lib/mail.ts` gönderici adresini
 *     `process.env.RESEND_FROM_EMAIL`'den alıyor ve ayar tablosuna HİÇ
 *     bakmıyor. Yani işletme sahibi gönderici adresini değiştirdiğini
 *     sanıyor, hiçbir şey değişmiyor. Sessiz yanlış bilgi.
 *   • `google_calendar_enabled` / `google_calendar_id` — projede Google
 *     Calendar entegrasyonu yok: ne bir paket bağımlılığı, ne çağrı, ne de
 *     `googleEventId` sütununu yazan tek bir satır kod.
 *
 * Ayrıca `prisma/seed.ts` bunlardan ikisini her kurulumda veritabanına
 * ekiyordu.
 *
 * ─── SINANAN DEĞİŞMEZLER ─────────────────────────────────────────────────
 *   • Üç anahtar yazma şemasında (`WRITABLE_SETTING_KEYS`) YOK.
 *   • Admin ayarlar ekranında görünmüyorlar; "Google Calendar" bölümü yok.
 *   • Gönderilseler bile YAZILMIYORLAR ve denetim satırı üretmiyorlar.
 *   • Yalnızca bu anahtarlarla yapılan istek 400 dönüyor.
 *   • Meşru ayarlar bozulmadı: yazılıyor ve denetim izine geçiyor.
 *   • `prisma/seed.ts` artık ölü satır ekmiyor.
 *   • Oturumsuz `/api/settings` bunları sızdırmıyor (mevcut korumanın devamı).
 *
 * UYARI: Dev veritabanına yazar ve ayarların önceki değerlerini geri koyar.
 * Production endpoint'ine karşı çalışmayı reddeder.
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { assertWritableTestDatabase } from "../lib/db-guard";
import { SignJWT } from "jose";
import { WRITABLE_SETTING_KEYS } from "../lib/settings-schema";
import { PUBLIC_SETTING_KEYS } from "../lib/public-fields";
import { temizleAuditIzleri } from "./audit-temizlik";

neonConfig.webSocketConstructor = ws;

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const { connectionString: cs } = assertWritableTestDatabase();
const db = new PrismaClient({ adapter: new PrismaNeon({ connectionString: cs }) });

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`   PASS  ${name}`);
  } else {
    failed++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`   FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Temizlenen ölü anahtarlar. */
const OLU_ANAHTARLAR = ["resend_from_email", "google_calendar_enabled", "google_calendar_id"] as const;

/**
 * Kaynak dosyadan yorumları çıkarır.
 *
 * Kaldırma kontrolleri KODA bakmalı. Ham metinde arasaydık, kaldırma
 * sebebini anlatan yorumun içindeki anahtar adı "hâlâ duruyor" gibi
 * okunurdu — testin ilk halinde tam olarak bu oldu.
 */
function yorumsuz(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Temizlikten sonra ayakta kalması gereken meşru anahtarlar. */
const YASAYAN_ANAHTARLAR = [
  "business_name",
  "business_phone",
  "business_email",
  "business_address",
  "maps_link",
  "instagram_url",
  "facebook_url",
] as const;

type Yanit = { status: number; body: Record<string, unknown> };
let cookie = "";

const post = (u: string, body: unknown): Promise<Yanit> =>
  fetch(`${BASE}${u}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }));

/** Ayarların testten önceki hali — sonunda birebir geri yazılır. */
let yedek: { key: string; value: string }[] = [];

async function geriYukle() {
  for (const s of yedek) {
    await db.setting.upsert({ where: { key: s.key }, update: { value: s.value }, create: s });
  }
  // Testin actigi ayar denetim satirlari temizlenir; `Setting` anahtari
  // silinmedigi icin oksuz supurme onlari yakalayamaz, acikca verilir.
  await temizleAuditIzleri(db, [...OLU_ANAHTARLAR, ...YASAYAN_ANAHTARLAR]);
}

async function main() {
  console.log("=".repeat(66));
  console.log("OLU AYARLARIN TEMIZLIGI — FAZ 3 · Sira 3.3");
  console.log("=".repeat(66));

  const admin = await db.user.findFirst({ select: { id: true, email: true } });
  if (!admin) throw new Error("Admin kullanici yok — testi calistiramam.");
  const key = new TextEncoder().encode(process.env.SESSION_SECRET);
  cookie = `session=${await new SignJWT({ userId: admin.id, expiresAt: new Date(Date.now() + 7 * 864e5) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key)}`;

  yedek = await db.setting.findMany({ select: { key: true, value: true } });

  try {
    // ── TEST 1 — Bu anahtarlar GERCEKTEN olu mu (kod kaniti) ─────────────
    console.log("\nTEST 1 — Anahtarlarin olu oldugunun kod kaniti");
    {
      const mail = yorumsuz(readFileSync("lib/mail.ts", "utf8"));
      check(
        "lib/mail.ts gonderici adresini ENV'den aliyor",
        /process\.env\.RESEND_FROM_EMAIL/.test(mail),
        "env okumasi yok"
      );
      check(
        "  ...lib/mail.ts ayar tablosunu HIC okumuyor",
        !/db\.setting|getSetting|settingsUpdateSchema/.test(mail),
        "ayar okumasi var — anahtar olu olmayabilir"
      );
      check(
        "  ...`resend_from_email` mail katmaninda gecmiyor",
        !mail.includes("resend_from_email"),
        "gecıyor — canli olabilir"
      );

      const pkg = readFileSync("package.json", "utf8");
      check(
        "Google Calendar paket bagimliligi YOK",
        !/googleapis|google-auth|@google-cloud/.test(pkg),
        "paket var — entegrasyon canli olabilir"
      );
    }

    // ── TEST 2 — Yazma semasindan cikarildilar mi ────────────────────────
    console.log("\nTEST 2 — Yazma semasi (`WRITABLE_SETTING_KEYS`)");
    {
      for (const k of OLU_ANAHTARLAR) {
        check(`\`${k}\` yazma semasinda YOK`, !(WRITABLE_SETTING_KEYS as readonly string[]).includes(k), "hala yazilabilir");
      }
      for (const k of YASAYAN_ANAHTARLAR) {
        check(`  ...\`${k}\` hala yazilabilir`, (WRITABLE_SETTING_KEYS as readonly string[]).includes(k), "yanlislikla silinmis");
      }
      check(
        "Yazilabilir anahtar sayisi 7",
        WRITABLE_SETTING_KEYS.length === 7,
        `${WRITABLE_SETTING_KEYS.length}: ${WRITABLE_SETTING_KEYS.join(",")}`
      );
    }

    // ── TEST 3 — Admin arayuzunde gorunmuyorlar ─────────────────────────
    console.log("\nTEST 3 — Admin ayarlar ekrani");
    {
      const form = yorumsuz(readFileSync("app/(admin)/admin/(protected)/ayarlar/SettingsForm.tsx", "utf8"));
      for (const k of OLU_ANAHTARLAR) {
        check(`SettingsForm icinde \`${k}\` alani YOK`, !form.includes(k), "alan duruyor");
      }
      check("  ...`Google Calendar` bolumu kaldirilmis", !form.includes("Google Calendar"), "bolum duruyor");
      check(
        "  ...mesru alanlar duruyor",
        YASAYAN_ANAHTARLAR.every((k) => form.includes(k)),
        "mesru alan silinmis"
      );

      const html = await fetch(`${BASE}/admin/ayarlar`, { headers: { Cookie: cookie } }).then((r) => r.text());
      check("Ayarlar ekrani render oluyor", !/Application error|Internal Server Error/.test(html));
      check("  ...ekranda `Gonderici E-posta` etiketi YOK", !html.includes("Gönderici E-posta"), "etiket duruyor");
      check("  ...ekranda `Google Calendar` etiketi YOK", !html.includes("Google Calendar"), "etiket duruyor");
      check("  ...ekranda `İşletme Adı` etiketi VAR", html.includes("İşletme Adı"), "mesru alan kaybolmus");
    }

    // ── TEST 4 — Calisma zamani: yazilamiyorlar ─────────────────────────
    console.log("\nTEST 4 — Olu anahtarlar YAZILAMIYOR");
    {
      // Baz deger EN BASTA alinir. Sonra alinsaydi ilk istegin yazdigi deger
      // baz kabul edilir ve "degismedi" kontrolleri sahte PASS verirdi.
      const oncekiOlu = new Map(
        (await db.setting.findMany({ where: { key: { in: [...OLU_ANAHTARLAR] } } })).map((s) => [s.key, s.value])
      );

      // Yalnizca olu anahtarlarla istek: yazilacak gecerli alan kalmaz.
      const yalnizOlu = await post("/api/settings", {
        google_calendar_enabled: "true",
        google_calendar_id: "yeni-takvim-id",
        resend_from_email: "sahte1@example.com",
      });
      check("Yalnizca olu anahtar iceren istek 400", yalnizOlu.status === 400, `gelen ${yalnizOlu.status}`);
      check(
        "  ...hata mesaji 'gecerli ayar alani yok'",
        String(yalnizOlu.body.error ?? "").includes("geçerli bir ayar alanı yok"),
        String(yalnizOlu.body.error)
      );
      for (const k of OLU_ANAHTARLAR) {
        const simdiki = await db.setting.findUnique({ where: { key: k } });
        check(
          `  ...ilk istekten sonra \`${k}\` DEGISMEDI`,
          (simdiki?.value ?? null) === (oncekiOlu.get(k) ?? null),
          `once=${oncekiOlu.get(k) ?? "(yok)"} simdi=${simdiki?.value ?? "(yok)"}`
        );
      }

      // Mesru bir alanla BIRLIKTE gonderilirse: mesru yazilir, olu yazilmaz.
      const yeniAd = `ZZ Ayar Testi ${Date.now()}`;
      const karisik = await post("/api/settings", {
        business_name: yeniAd,
        resend_from_email: "sahte2@example.com",
        google_calendar_enabled: "false",
      });
      check("Mesru + olu karisik istek 200", karisik.status === 200, `gelen ${karisik.status}`);

      const sonrakiAd = await db.setting.findUnique({ where: { key: "business_name" } });
      check("  ...mesru ayar YAZILDI", sonrakiAd?.value === yeniAd, String(sonrakiAd?.value));

      for (const k of OLU_ANAHTARLAR) {
        const simdiki = await db.setting.findUnique({ where: { key: k } });
        const once = oncekiOlu.get(k);
        check(
          `  ...\`${k}\` DEGISMEDI`,
          (simdiki?.value ?? null) === (once ?? null),
          `once=${once ?? "(yok)"} simdi=${simdiki?.value ?? "(yok)"}`
        );
      }

      // Denetim izi de olusmamali
      for (const k of OLU_ANAHTARLAR) {
        const izler = await db.auditLog.count({ where: { entity: "Setting", entityId: k } });
        check(`  ...\`${k}\` icin denetim satiri YOK`, izler === 0, `${izler} satir`);
      }
    }

    // ── TEST 5 — Mesru ayarlar bozulmadi (regresyon) ────────────────────
    console.log("\nTEST 5 — Mesru ayarlar hala calisiyor");
    {
      const deger = `ZZ ${Date.now()}`;
      const r = await post("/api/settings", {
        business_phone: "+90 555 111 22 33",
        business_address: deger,
        instagram_url: "https://instagram.com/zztest",
        facebook_url: "",
      });
      check("Mesru ayar guncellemesi 200", r.status === 200, `gelen ${r.status}`);

      const adres = await db.setting.findUnique({ where: { key: "business_address" } });
      check("  ...`business_address` yazildi", adres?.value === deger, String(adres?.value));

      const iz = await db.auditLog.findFirst({
        where: { entity: "Setting", entityId: "business_address" },
        orderBy: { createdAt: "desc" },
      });
      check("  ...denetim izine gecti", !!iz, "iz yok");
      check("  ...denetim kaynagi ADMIN", iz?.source === "ADMIN", iz?.source ?? "-");

      // Gecersiz deger hala reddediliyor mu (sema bozulmadi)
      const gecersiz = await post("/api/settings", { business_email: "email-degil" });
      check("Gecersiz e-posta hala 400", gecersiz.status === 400, `gelen ${gecersiz.status}`);
    }

    // ── TEST 6 — Seed olu satir ekmiyor ─────────────────────────────────
    console.log("\nTEST 6 — `prisma/seed.ts` olu ayar ekmiyor");
    {
      const seed = yorumsuz(readFileSync("prisma/seed.ts", "utf8"));
      for (const k of OLU_ANAHTARLAR) {
        check(`seed.ts \`${k}\` ekmiyor`, !seed.includes(k), "hala ekiliyor");
      }
      check(
        "  ...seed mesru ayarlari ekmeye devam ediyor",
        seed.includes("business_name") && seed.includes("business_phone"),
        "mesru seed bozulmus"
      );
    }

    // ── TEST 7 — Public sizinti yok (mevcut korumanin devami) ───────────
    console.log("\nTEST 7 — Oturumsuz erisimde sizinti yok");
    {
      const ham = await fetch(`${BASE}/api/settings`, { cache: "no-store" }).then((r) => r.text());
      for (const k of OLU_ANAHTARLAR) {
        check(`Public GET \`${k}\` icermiyor`, !ham.includes(k), "sizdi");
      }
      check(
        "  ...public liste bu anahtarlari zaten tanimiyor",
        OLU_ANAHTARLAR.every((k) => !(PUBLIC_SETTING_KEYS as readonly string[]).includes(k)),
        "public listeye sizmis"
      );
      check("  ...mesru public ayarlar donuyor", ham.includes("business_name"), "public ayar kaybolmus");
    }

    // ── TEST 8 — Veritabaninda kalan eski satirlar zararsiz ─────────────
    //
    // Kod temizligi veritabanindaki eski satirlari SILMEZ (production veri
    // islemi ayri onay ister). Bu test, kalan satirlarin zarar vermedigini
    // dogrular: admin GET onlari dondurse bile arayuz gostermez, POST
    // yazamaz, public sizmaz.
    console.log("\nTEST 8 — DB'de kalan eski satirlar zararsiz");
    {
      // Eski bir kurulumu taklit et: satiri elle koy.
      await db.setting.upsert({
        where: { key: "google_calendar_id" },
        update: { value: "eski-kurulumdan-kalan" },
        create: { key: "google_calendar_id", value: "eski-kurulumdan-kalan" },
      });

      const adminHtml = await fetch(`${BASE}/admin/ayarlar`, { headers: { Cookie: cookie } }).then((r) => r.text());
      // Yalnizca "input olarak render edilmedi" yetmez: deger sayfa
      // yukune (RSC props) hic girmemeli.
      check("Kalan satir admin sayfa yukune GIRMIYOR", !adminHtml.includes("eski-kurulumdan-kalan"), "sayfa yukunde var");
      check("  ...anahtar adi da yukte YOK", !adminHtml.includes("google_calendar_id"), "anahtar adi yukte");
      check("  ...ekran yine de saglikli", !/Application error|Internal Server Error/.test(adminHtml));

      const ham = await fetch(`${BASE}/api/settings`, { cache: "no-store" }).then((r) => r.text());
      check("Kalan satir public GET'e sizmiyor", !ham.includes("eski-kurulumdan-kalan"), "sizdi");

      // Ustune yazilamiyor
      await post("/api/settings", { business_name: "ZZ kalinti testi", google_calendar_id: "degistirilmeye-calisildi" });
      const sonra = await db.setting.findUnique({ where: { key: "google_calendar_id" } });
      check("Kalan satirin degeri DEGISTIRILEMIYOR", sonra?.value === "eski-kurulumdan-kalan", String(sonra?.value));

      await db.setting.deleteMany({ where: { key: "google_calendar_id" } });
    }
  } finally {
    console.log("\nGERI YUKLEME...");
    await geriYukle();
    const son = await db.setting.findMany({ select: { key: true } });
    console.log(`  ayar sayisi: ${son.length}  |  audit: ${await db.auditLog.count()}`);
  }

  console.log("\n" + "=".repeat(66));
  console.log(`TOPLAM: ${passed + failed}   GECEN: ${passed}   KALAN: ${failed}`);
  if (failed > 0) {
    console.log("\nBASARISIZ:");
    for (const f of failures) console.log("  - " + f);
  }
  console.log("=".repeat(66));
}

main()
  .then(() => db.$disconnect().then(() => process.exit(failed > 0 ? 1 : 0)))
  .catch(async (e) => {
    console.error("HATA:", e);
    await db.$disconnect();
    process.exit(1);
  });

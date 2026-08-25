/**
 * Public sayfaların tazeliği (FAZ 3 · Sıra 3.1).
 *
 * Çalıştırma (geliştirme sunucusu — yalnızca kod kontrolleri):
 *   npx dotenv -e .env.local -- tsx scripts/verify-public-freshness.ts
 *
 * Çalıştırma (PRODUCTION BUILD — asıl kanıt):
 *   npx next build && npx next start -p 3100
 *   TEST_BASE_URL=http://localhost:3100 TEST_PROD_BUILD=1 \
 *     npx dotenv -e .env.local -- tsx scripts/verify-public-freshness.ts
 *
 * ─── SORUN ───────────────────────────────────────────────────────────────
 * `/`, `/hizmetler`, `/ekibimiz`, `/iletisim` build çıktısında `○` — yani
 * BUILD ZAMANINDA statik üretiliyor. Admin bir hizmet/berber/kampanya
 * eklediğinde bu sayfalar kendiliğinden yenilenmiyordu, çünkü:
 *
 *   1. services/barbers/campaigns mutasyon uçları `revalidatePath` ÇAĞIRMIYORDU
 *      (yalnızca `/api/settings` çağırıyordu),
 *   2. ana sayfanın kampanya sorgusu `endDate >= new Date()` ve ekrandaki
 *      "X gün kaldı" hesabı build anına DONUYORDU — süresi dolan kampanya
 *      düşmüyor, ileri tarihli kampanya hiç görünmüyordu.
 *
 * ─── NEDEN İKİ AYRI KONTROL TÜRÜ ─────────────────────────────────────────
 * `next dev` her isteği yeniden render eder; bayatlık ORADA GÖRÜNMEZ.
 * Çalışma zamanı kontrolleri bu yüzden yalnızca `TEST_PROD_BUILD=1` ile
 * çalışır — dev'de sessizce "geçti" demek yerine ATLANDI olarak raporlanır.
 * Kod kontrolleri her zaman çalışır ve regresyonda koruma sağlar.
 *
 * UYARI: Dev veritabanına test verisi yazar ve sonunda siler.
 * Production endpoint'ine karşı çalışmayı reddeder.
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { assertWritableTestDatabase } from "../lib/db-guard";
import { temizleAuditIzleri } from "./audit-temizlik";
import { SignJWT } from "jose";

neonConfig.webSocketConstructor = ws;

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const PROD_BUILD = process.env.TEST_PROD_BUILD === "1";
const { connectionString: cs } = assertWritableTestDatabase();
const db = new PrismaClient({ adapter: new PrismaNeon({ connectionString: cs }) });

let passed = 0;
let failed = 0;
let atlanan = 0;
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
function atla(name: string, sebep: string) {
  atlanan++;
  console.log(`   ATLA  ${name} — ${sebep}`);
}

const MARK = "ZZTAZELIK";

type Yanit = { status: number; body: Record<string, unknown> };
let cookie = "";
const post = (u: string, b: unknown): Promise<Yanit> =>
  fetch(`${BASE}${u}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(b),
  }).then(async (r) => ({ status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }));
const patch = (u: string, b: unknown): Promise<Yanit> =>
  fetch(`${BASE}${u}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(b),
  }).then(async (r) => ({ status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }));
const del = (u: string) =>
  fetch(`${BASE}${u}`, { method: "DELETE", headers: { Cookie: cookie } }).then((r) => ({ status: r.status }));
const html = (u: string) => fetch(`${BASE}${u}`, { cache: "no-store" }).then((r) => r.text());

/** Mutasyon sonrası sayfanın yenilenmesi için kısa bekleme. */
const uyu = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cleanup() {
  const svc = await db.service.findMany({ where: { name: { startsWith: MARK } }, select: { id: true } });
  const brb = await db.barber.findMany({ where: { name: { startsWith: MARK } }, select: { id: true } });
  await db.appointmentService.deleteMany({ where: { serviceId: { in: svc.map((s) => s.id) } } });
  await db.saleItem.deleteMany({ where: { serviceId: { in: svc.map((s) => s.id) } } });
  const n = {
    hizmet: (await db.service.deleteMany({ where: { name: { startsWith: MARK } } })).count,
    berber: (await db.barber.deleteMany({ where: { id: { in: brb.map((b) => b.id) } } })).count,
    kampanya: (await db.campaign.deleteMany({ where: { title: { startsWith: MARK } } })).count,
  };
  await temizleAuditIzleri(db);
  return n;
}

async function main() {
  const admin = await db.user.findFirst({ select: { id: true } });
  if (!admin) throw new Error("Admin yok.");
  const key = new TextEncoder().encode(process.env.SESSION_SECRET);
  cookie = `session=${await new SignJWT({ userId: admin.id, expiresAt: new Date(Date.now() + 7 * 864e5) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key)}`;

  await cleanup();
  console.log(PROD_BUILD ? "  KIP: PRODUCTION BUILD (calisma zamani kontrolleri ACIK)\n" : "  KIP: gelistirme (calisma zamani kontrolleri ATLANIR)\n");

  try {
    // ── TEST 1 — Mutasyon uçları revalidatePath çağırıyor mu ─────────────
    console.log("TEST 1 — Mutasyon uclarinda revalidatePath");
    {
      const beklenen: [string, string[]][] = [
        ["app/api/services/route.ts", ["/hizmetler", "/"]],
        ["app/api/services/[id]/route.ts", ["/hizmetler", "/"]],
        ["app/api/barbers/route.ts", ["/ekibimiz", "/"]],
        ["app/api/barbers/[id]/route.ts", ["/ekibimiz", "/"]],
        ["app/api/campaigns/route.ts", ["/"]],
        ["app/api/campaigns/[id]/route.ts", ["/"]],
      ];
      for (const [dosya, yollar] of beklenen) {
        const src = readFileSync(dosya, "utf8");
        const ad = dosya.replace("app/api/", "");
        check(`${ad} revalidatePath cagiriyor`, /revalidatePath\s*\(/.test(src), "cagri yok");
        for (const y of yollar) {
          check(`  ...${ad} -> "${y}"`, src.includes(`revalidatePath("${y}")`), `"${y}" yenilenmiyor`);
        }
      }
    }

    // ── TEST 2 — Zamana bağlı sayfa ISR ile yenileniyor mu ───────────────
    console.log("\nTEST 2 — Zamana bagli sayfa (ana sayfa) kendiliginden yenileniyor mu");
    {
      const src = readFileSync("app/(site)/page.tsx", "utf8");
      // Kampanya penceresi mutasyona bagli DEGIL: sure dolunca kendiliginden
      // dusmeli. Bunun tek yolu ISR (`export const revalidate`).
      const m = /export const revalidate\s*=\s*(\d+)/.exec(src);
      check("Ana sayfada `export const revalidate` var", m !== null, "ISR yok — kampanya penceresi build'e donuyor");
      if (m) {
        const sn = Number(m[1]);
        console.log(`      revalidate = ${sn} saniye (${Math.round(sn / 60)} dk)`);
        check("  ...aralik makul (1 dk – 24 saat)", sn >= 60 && sn <= 86400, `${sn} sn`);
      }

      // force-dynamic tum siteyi dinamiklestirmemeli
      check("Ana sayfa force-dynamic YAPILMAMIS (performans korunuyor)",
        !/dynamic\s*=\s*["']force-dynamic["']/.test(src), "force-dynamic kullanilmis");
      for (const p of ["app/(site)/hizmetler/page.tsx", "app/(site)/ekibimiz/page.tsx", "app/(site)/iletisim/page.tsx"]) {
        const s = readFileSync(p, "utf8");
        check(`${p.split("/").slice(-2).join("/")} force-dynamic degil`,
          !/dynamic\s*=\s*["']force-dynamic["']/.test(s), "force-dynamic kullanilmis");
      }
    }

    // ── TEST 3 — "Şimdi" tek yerde hesaplanıyor mu (Date.now kök nedeni) ─
    console.log("\nTEST 3 — Render icinde impure cagri (Date.now kok nedeni)");
    {
      const src = readFileSync("app/(site)/page.tsx", "utf8");
      // JSX/`map` icinde Date.now() cagrisi hem lint hatasi hem de sorgu ile
      // ekranin FARKLI anlari kullanmasina yol acar.
      const jsxBaslangic = src.indexOf("return (");
      const jsxGovde = jsxBaslangic > 0 ? src.slice(jsxBaslangic) : src;
      check("JSX icinde Date.now() cagrisi YOK",
        !/Date\.now\s*\(/.test(jsxGovde), "render sirasinda impure cagri var");
      check("JSX icinde new Date() cagrisi YOK",
        !/new Date\s*\(\s*\)/.test(jsxGovde), "render sirasinda impure cagri var");
      check("Sorgu ve ekran AYNI 'simdi' degerini kullaniyor",
        /const\s+(simdi|now)\s*=\s*new Date\(\)/.test(src), "tek referans zaman yok");
    }

    // ── TEST 4 — ÇALIŞMA ZAMANI: hizmet ekleme /hizmetler'e yansıyor mu ──
    console.log("\nTEST 4 — Hizmet ekleme -> /hizmetler (calisma zamani)");
    if (!PROD_BUILD) {
      atla("Hizmet ekleme /hizmetler'de goruluyor", "yalnizca production build'de anlamli (dev her istegi yeniden render eder)");
    } else {
      const ad = `${MARK} Hizmet ${Date.now()}`;
      const once = await html("/hizmetler");
      check("Yeni hizmet ONCE sayfada yok", !once.includes(ad));

      const r = await post("/api/services", { name: ad, durationMinutes: 30, price: 777, category: "Test" });
      check("Hizmet olusturuldu -> 201", r.status === 201, `gelen ${r.status}`);
      await uyu(1500);

      const sonra = await html("/hizmetler");
      check("Yeni hizmet /hizmetler'de GORUNUYOR", sonra.includes(ad), "sayfa bayat kaldi");

      const id = (r.body.service as { id: string } | undefined)?.id ?? "";
      const yeniAd = `${MARK} Guncel ${Date.now()}`;
      await patch(`/api/services/${id}`, { name: yeniAd });
      await uyu(1500);
      const guncel = await html("/hizmetler");
      check("Guncellenen ad /hizmetler'de GORUNUYOR", guncel.includes(yeniAd), "guncelleme yansimadi");

      await patch(`/api/services/${id}`, { isActive: false });
      await uyu(1500);
      const pasif = await html("/hizmetler");
      check("Pasife alinan hizmet /hizmetler'den DUSTU", !pasif.includes(yeniAd), "pasif hizmet hala gorunuyor");
    }

    // ── TEST 5 — ÇALIŞMA ZAMANI: berber ekleme /ekibimiz'e yansıyor mu ──
    console.log("\nTEST 5 — Berber ekleme -> /ekibimiz (calisma zamani)");
    if (!PROD_BUILD) {
      atla("Berber ekleme /ekibimiz'de goruluyor", "yalnizca production build'de anlamli");
    } else {
      const ad = `${MARK} Berber ${Date.now()}`;
      const once = await html("/ekibimiz");
      check("Yeni berber ONCE sayfada yok", !once.includes(ad));

      const r = await post("/api/barbers", {
        name: ad, bio: "test", specialty: "test", experienceYrs: 1,
        calendarColor: "#c9762c", isActive: true, workerType: "COMMISSION", commissionRate: 40,
      });
      check("Berber olusturuldu -> 201", r.status === 201, `gelen ${r.status}`);
      await uyu(1500);

      const sonra = await html("/ekibimiz");
      check("Yeni berber /ekibimiz'de GORUNUYOR", sonra.includes(ad), "sayfa bayat kaldi");
    }

    // ── TEST 6 — ÇALIŞMA ZAMANI: kampanya ekleme /'e yansıyor mu ────────
    console.log("\nTEST 6 — Kampanya ekleme -> / (calisma zamani)");
    if (!PROD_BUILD) {
      atla("Kampanya ekleme ana sayfada goruluyor", "yalnizca production build'de anlamli");
    } else {
      const baslik = `${MARK} Kampanya ${Date.now()}`;
      const once = await html("/");
      check("Yeni kampanya ONCE sayfada yok", !once.includes(baslik));

      const bugun = new Date();
      const bitis = new Date(bugun.getTime() + 10 * 86400000);
      const r = await post("/api/campaigns", {
        title: baslik, description: "test kampanya",
        startDate: bugun.toISOString(), endDate: bitis.toISOString(),
        isActive: true, showOnHome: true, priority: 0,
      });
      check("Kampanya olusturuldu -> 201", r.status === 201, `gelen ${r.status}`);
      await uyu(1500);

      const sonra = await html("/");
      check("Yeni kampanya ANA SAYFADA GORUNUYOR", sonra.includes(baslik), "sayfa bayat kaldi");

      const id = (r.body.campaign as { id: string } | undefined)?.id ?? "";
      await del(`/api/campaigns/${id}`);
      await uyu(1500);
      const silinmis = await html("/");
      check("Silinen kampanya ana sayfadan DUSTU", !silinmis.includes(baslik), "silinen kampanya hala gorunuyor");
    }

    // ── TEST 7 — Süresi geçmiş kampanya kod düzeyinde dışarıda mı ───────
    console.log("\nTEST 7 — Kampanya tarih penceresi");
    {
      const src = readFileSync("app/(site)/page.tsx", "utf8");
      check("Kampanya sorgusu endDate/startDate penceresi uyguluyor",
        /endDate:\s*\{\s*gte:/.test(src) && /startDate:\s*\{\s*lte:/.test(src), "pencere filtresi yok");
      check("Pencere tek referans zamanla kuruluyor",
        /endDate:\s*\{\s*gte:\s*(simdi|now)\s*\}/.test(src), "sorgu ayri bir `new Date()` kullaniyor");
    }
  } finally {
    console.log("\nTEMIZLIK...");
    const n = await cleanup();
    console.log(`  silinen: hizmet=${n.hizmet} berber=${n.berber} kampanya=${n.kampanya}`);
  }

  console.log("\n" + "=".repeat(66));
  console.log(`TOPLAM: ${passed + failed}   GECEN: ${passed}   KALAN: ${failed}${atlanan ? `   ATLANAN: ${atlanan}` : ""}`);
  if (atlanan > 0 && !PROD_BUILD) {
    console.log("\nNOT: Calisma zamani kontrolleri ATLANDI. Gercek kanit icin:");
    console.log("  npx next build && npx next start -p 3100");
    console.log("  TEST_BASE_URL=http://localhost:3100 TEST_PROD_BUILD=1 npx dotenv -e .env.local -- tsx scripts/verify-public-freshness.ts");
  }
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

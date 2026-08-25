/**
 * Veritabanı hedef koruması testi (allowlist, fail-closed).
 *
 * Çalıştırma (DB bağlantısı GEREKMEZ — koruma alt süreçlerde sınanır):
 *   npx tsx scripts/verify-db-guard.ts
 *
 * Bu test hiçbir veritabanına BAĞLANMAZ. Koruma katmanını iki şekilde sınar:
 *   1. `describeDatabaseTarget()` saf sınıflandırma (doğrudan çağrı)
 *   2. Gerçek bir yazma script'ini sahte DATABASE_URL değerleriyle alt süreçte
 *      çalıştırıp durdurulup durdurulmadığına bakarak (uçtan uca)
 *
 * Sahte bağlantı dizeleri gerçek bir sunucuya ait değildir; koruma zaten
 * bağlantı kurulmadan önce devreye girer.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { describeDatabaseTarget, ALLOWED_WRITE_ENDPOINT_PREFIXES } from "../lib/db-guard";

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

const NEON = (ep: string) => `postgresql://kullanici:parola@${ep}-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`;

/** Gerçek endpoint'ler — koruma bunlara göre karar veriyor. */
const DEV = "ep-royal-haze-abc123";
const PRODUCTION = "ep-frosty-dust-xyz789";
const ESKI_SANILAN_PROD = "ep-raspy-brook-old999";
const BILINMEYEN = "ep-tamamen-baska-000";

/**
 * Bir script'i verilen DATABASE_URL ile alt süreçte çalıştırır.
 * `null` değer o anahtarı siler.
 */
function calistir(script: string, env: Record<string, string | null>) {
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) childEnv[k] = v;
  for (const [k, v] of Object.entries(env)) {
    if (v === null) delete childEnv[k];
    else childEnv[k] = v;
  }
  const res = spawnSync("npx", ["--no-install", "tsx", script], {
    env: childEnv as NodeJS.ProcessEnv,
    encoding: "utf8",
    shell: true,
    timeout: 120000,
  });
  return { code: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

function main() {
  // ── TEST 1 — Saf sınıflandırma ────────────────────────────────────────
  console.log("TEST 1 — describeDatabaseTarget() siniflandirmasi");
  {
    const dev = describeDatabaseTarget(NEON(DEV));
    check("dev endpoint -> yazma izinli", dev.writeAllowed, `writeAllowed=${dev.writeAllowed}`);
    check("  ...maskeli isim endpoint'i sizdirmiyor", dev.masked === "ep-royal-haze-****", dev.masked);

    const prod = describeDatabaseTarget(NEON(PRODUCTION));
    check("PRODUCTION endpoint -> yazma YASAK", !prod.writeAllowed, `writeAllowed=${prod.writeAllowed}`);
    check("  ...maskeli", prod.masked === "ep-frosty-dust-****", prod.masked);

    const eski = describeDatabaseTarget(NEON(ESKI_SANILAN_PROD));
    check("eski 'ep-raspy-brook' -> yazma YASAK (sabit ad gerekmiyor)", !eski.writeAllowed);

    const bilinmeyen = describeDatabaseTarget(NEON(BILINMEYEN));
    check("bilinmeyen Neon endpoint -> yazma YASAK", !bilinmeyen.writeAllowed);

    const sqlite = describeDatabaseTarget("file:./prisma/dev.db");
    check("yerel SQLite -> yazma izinli (mevcut davranis korunur)", sqlite.writeAllowed);
    check("  ...tur sqlite", sqlite.kind === "sqlite", sqlite.kind);

    const bos = describeDatabaseTarget("");
    check("DATABASE_URL yok -> yazma YASAK (fail-closed)", !bos.writeAllowed);
    check("  ...tur missing", bos.kind === "missing", bos.kind);

    const sacma = describeDatabaseTarget("mysql://kullanici:parola@localhost/db");
    check("taninmayan bicim -> yazma YASAK (fail-closed)", !sacma.writeAllowed);

    const digerPg = describeDatabaseTarget("postgresql://u:p@baska-sunucu.example.com:5432/db");
    check("Neon disi postgres -> yazma YASAK (fail-closed)", !digerPg.writeAllowed);

    check("allowlist yalnizca gelistirme endpoint'i iceriyor",
      ALLOWED_WRITE_ENDPOINT_PREFIXES.length === 1 && ALLOWED_WRITE_ENDPOINT_PREFIXES[0] === "ep-royal-haze",
      ALLOWED_WRITE_ENDPOINT_PREFIXES.join(", "));
  }

  // ── TEST 2 — Yazan script uçtan uca ───────────────────────────────────
  console.log("\nTEST 2 — Yazan script gercek davranis (alt surec)");
  {
    const prod = calistir("scripts/verify-customer-counters.ts", { DATABASE_URL: NEON(PRODUCTION) });
    check("PRODUCTION endpoint -> script DURDURULDU", prod.code !== 0, `cikis kodu ${prod.code}`);
    check("  ...gerekce yaziliyor", /DURDURULDU/.test(prod.out), prod.out.split("\n")[0] ?? "");
    check("  ...maskeli endpoint gosteriliyor", /ep-frosty-dust-\*\*\*\*/.test(prod.out), "maskeli ad yok");
    check("  ...baglanti dizesi SIZMADI", !prod.out.includes("parola") && !prod.out.includes("neon.tech"),
      "cikti baglanti bilgisi iceriyor");

    const bilinmeyen = calistir("scripts/verify-customer-counters.ts", { DATABASE_URL: NEON(BILINMEYEN) });
    check("bilinmeyen endpoint -> script DURDURULDU", bilinmeyen.code !== 0, `cikis kodu ${bilinmeyen.code}`);

    const eski = calistir("scripts/verify-customer-counters.ts", { DATABASE_URL: NEON(ESKI_SANILAN_PROD) });
    check("eski sanilan prod endpoint -> DURDURULDU", eski.code !== 0, `cikis kodu ${eski.code}`);

    const yok = calistir("scripts/verify-customer-counters.ts", { DATABASE_URL: null });
    check("DATABASE_URL yok -> DURDURULDU", yok.code !== 0, `cikis kodu ${yok.code}`);
  }

  // ── TEST 3 — Salt-okuma script'i ──────────────────────────────────────
  console.log("\nTEST 3 — Salt-okuma script'i (report-counter-drift)");
  {
    const onaysiz = calistir("scripts/report-counter-drift.ts", {
      DATABASE_URL: NEON(PRODUCTION),
      READONLY_REMOTE_OK: null,
    });
    check("allowlist disi + ONAYSIZ -> DURDURULDU", onaysiz.code !== 0, `cikis kodu ${onaysiz.code}`);
    check("  ...nasil onaylanacagi anlatiliyor", /READONLY_REMOTE_OK/.test(onaysiz.out), "yonlendirme yok");
    check("  ...baglanti dizesi SIZMADI", !onaysiz.out.includes("parola"), "cikti baglanti bilgisi iceriyor");

    // Onay verilince koruma gecer; baglanti kurulamayacagi icin script sonra
    // hata verir — kritik olan KORUMANIN gecmesi ve etiketin dogru olmasi.
    const onayli = calistir("scripts/report-counter-drift.ts", {
      DATABASE_URL: NEON(PRODUCTION),
      READONLY_REMOTE_OK: "1",
    });
    check("allowlist disi + ONAYLI -> koruma gecildi", /ALLOWLIST DISI/.test(onayli.out),
      onayli.out.split("\n").slice(0, 3).join(" | "));
    check("  ...hedef maskeli etiketlendi", /ep-frosty-dust-\*\*\*\*/.test(onayli.out), "maskeli ad yok");
  }

  // ── TEST 4 — Kaynak taraması ──────────────────────────────────────────
  console.log("\nTEST 4 — Kaynak taramasi");
  {
    const scriptler = readdirSync("scripts").filter((f) => f.endsWith(".ts"));
    const yazanDesen = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/;

    const korumasizYazanlar: string[] = [];
    for (const f of scriptler) {
      const src = readFileSync(`scripts/${f}`, "utf8");
      // Koruma, BAGLANTI ACAN script'ler icindir. Yalnizca tip olarak
      // PrismaClient import eden ve `db`yi disaridan alan yardimci modüller
      // (or. audit-temizlik.ts) kendi hedeflerini secmez; onlari cagiran
      // script zaten korumalidir.
      const baglantiAciyor = /new PrismaClient\s*\(/.test(src);
      if (!baglantiAciyor) continue;
      if (!yazanDesen.test(src)) continue;
      if (!/assertWritableTestDatabase\(\)/.test(src)) korumasizYazanlar.push(f);
    }
    check(`Veriye yazan tum script'ler korumali (${scriptler.length} dosya tarandi)`,
      korumasizYazanlar.length === 0, korumasizYazanlar.join(", "));

    const seed = readFileSync("prisma/seed.ts", "utf8");
    check("prisma/seed.ts korumali", /assertWritableTestDatabase\(\)/.test(seed), "koruma yok");

    // Sabit production adi artik hicbir yerde gerekmiyor (aciklama harici)
    // Bu testin kendisi eski adi TEST VERISI olarak tasiyor (artik ozel
    // muamele gormedigini dogruluyor); taramadan haric tutulur.
    const kodDosyalari = [
      ...scriptler.filter((f) => f !== "verify-db-guard.ts").map((f) => `scripts/${f}`),
      "prisma/seed.ts",
    ];
    const sabitAdKalanlar = kodDosyalari.filter((f) => {
      const src = readFileSync(f, "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
        .join("\n");
      return /ep-raspy-brook/.test(src);
    });
    check("Sabit 'ep-raspy-brook' kontrolu koddan tamamen kalkti",
      sabitAdKalanlar.length === 0, sabitAdKalanlar.join(", "));
  }

  console.log("\n" + "=".repeat(66));
  console.log(`TOPLAM: ${passed + failed}   GECEN: ${passed}   KALAN: ${failed}`);
  if (failed > 0) {
    console.log("\nBASARISIZ:");
    for (const f of failures) console.log("  - " + f);
  }
  console.log("=".repeat(66));
}

main();
process.exit(failed > 0 ? 1 : 0);

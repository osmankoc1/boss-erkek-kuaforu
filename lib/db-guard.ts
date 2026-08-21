/**
 * Veritabanı hedef koruması — ALLOWLIST, fail-closed.
 *
 * ─── NEDEN ───────────────────────────────────────────────────────────────
 * Önceki koruma "endpoint `ep-raspy-brook` ile başlıyorsa dur" şeklindeydi:
 * production'ın adını sabit yazan bir DENYLIST. Neon compute endpoint'i
 * değişince (production artık `ep-frosty-dust`) bu kontrol sessizce işlevsiz
 * kaldı — canlı production'a bağlanan bir script "production değil" yazdı.
 *
 * Bu dosya mantığı tersine çevirir: **yalnızca açıkça izin verilen hedefte**
 * yazma yapılabilir. Production endpoint'i tekrar değişse bile koruma çalışır,
 * çünkü yeni endpoint allowlist'te olmadığı için otomatik olarak reddedilir.
 *
 * ─── KURALLAR ────────────────────────────────────────────────────────────
 *   Yazma yapan script (test, seed):
 *     • Yerel SQLite            → izinli (yerel geliştirme)
 *     • Allowlist'teki endpoint → izinli
 *     • Başka HER ŞEY           → DURDURULUR (tanınmayan hedef dahil)
 *
 *   Salt-okuma script (rapor):
 *     • Allowlist'teki hedef    → izinli
 *     • Allowlist dışı          → yalnızca AÇIK ONAYLA (READONLY_REMOTE_OK=1)
 *
 * Bağlantı dizesi, şifre veya host asla loglanmaz; yalnızca maskelenmiş
 * endpoint kimliği basılır.
 */

/**
 * Yazma yapılmasına izin verilen Neon endpoint önekleri.
 *
 * Buraya YALNIZCA geliştirme/test branch'leri eklenir. Production endpoint'i
 * hiçbir koşulda eklenmemelidir.
 */
export const ALLOWED_WRITE_ENDPOINT_PREFIXES = ["ep-royal-haze"] as const;

export type DbTargetKind = "missing" | "sqlite" | "neon" | "postgres-other" | "unknown";

export type DbTarget = {
  kind: DbTargetKind;
  /** Maskelenmiş, loglanması güvenli hedef adı. */
  masked: string;
  /** Yazma yapılmasına izin verilen bir hedef mi? */
  writeAllowed: boolean;
  /** Prisma'ya verilecek bağlantı dizesi (asla loglanmaz). */
  connectionString: string;
};

/** Endpoint kimliğini bağlantı dizesinden çıkarır (`-pooler` eki atılır). */
function extractEndpoint(connectionString: string): string | null {
  const match = /@([^/.@]+)\./.exec(connectionString);
  if (!match) return null;
  return match[1].replace(/-pooler$/, "");
}

/** `ep-royal-haze-a1b2c3` → `ep-royal-haze-****` */
function maskEndpoint(endpoint: string): string {
  const parts = endpoint.split("-");
  return parts.length > 3 ? `${parts.slice(0, 3).join("-")}-****` : `${endpoint}-****`;
}

/** Hedefi sınıflandırır. Yan etkisi yoktur; karar vermez, yalnızca tarif eder. */
export function describeDatabaseTarget(connectionString?: string | null): DbTarget {
  const cs = connectionString ?? "";
  if (!cs.trim()) {
    return { kind: "missing", masked: "(DATABASE_URL tanimli degil)", writeAllowed: false, connectionString: "" };
  }

  if (cs.startsWith("file:")) {
    return { kind: "sqlite", masked: "yerel SQLite dosyasi", writeAllowed: true, connectionString: cs };
  }

  if (!/^postgres(ql)?:\/\//.test(cs)) {
    return { kind: "unknown", masked: "(taninmayan baglanti bicimi)", writeAllowed: false, connectionString: cs };
  }

  const endpoint = extractEndpoint(cs);
  if (!endpoint) {
    return { kind: "unknown", masked: "(endpoint cozumlenemedi)", writeAllowed: false, connectionString: cs };
  }

  const neon = /\.neon\.tech/i.test(cs) || endpoint.startsWith("ep-");
  const izinli = ALLOWED_WRITE_ENDPOINT_PREFIXES.some((p) => endpoint.startsWith(p));

  return {
    kind: neon ? "neon" : "postgres-other",
    masked: maskEndpoint(endpoint),
    writeAllowed: izinli,
    connectionString: cs,
  };
}

function durdur(satirlar: string[]): never {
  console.error("\n" + "=".repeat(64));
  for (const s of satirlar) console.error(s);
  console.error("=".repeat(64) + "\n");
  process.exit(1);
}

/**
 * Veriye YAZAN script'ler için zorunlu kapı.
 *
 * Allowlist dışındaki her hedefte süreci sonlandırır. Tanınmayan bir hedef de
 * reddedilir (fail-closed): şüphe varsa yazma yapılmaz.
 */
export function assertWritableTestDatabase(): DbTarget {
  const target = describeDatabaseTarget(process.env.DATABASE_URL);

  if (target.kind === "missing") {
    durdur([
      "DURDURULDU: DATABASE_URL tanimli degil.",
      "Bu script veriye YAZIYOR; hedef belirsizken calistirilamaz.",
    ]);
  }

  if (!target.writeAllowed) {
    durdur([
      `DURDURULDU: '${target.masked}' yazma icin izinli hedeflerden degil.`,
      "",
      "Bu script veriye YAZIYOR. Yalnizca acikca izin verilen gelistirme",
      "hedeflerinde calisabilir:",
      ...ALLOWED_WRITE_ENDPOINT_PREFIXES.map((p) => `  - ${p}-****`),
      "  - yerel SQLite dosyasi",
      "",
      "Hedef production ya da taninmayan bir veritabani olabilir.",
      "Izin vermek icin lib/db-guard.ts icindeki allowlist'i bilerek",
      "guncelleyin; production ASLA eklenmemelidir.",
    ]);
  }

  console.log(`Hedef: ${target.masked}  [yazma izinli — gelistirme hedefi]\n`);
  return target;
}

/**
 * Yalnızca OKUYAN script'ler için kapı.
 *
 * Allowlist dışı bir hedefte (ör. production raporu) çalışmak meşru olabilir,
 * ama kazara olmamalıdır: açık onay değişkeni gerekir.
 */
export function assertReadableDatabase(): DbTarget {
  const target = describeDatabaseTarget(process.env.DATABASE_URL);

  if (target.kind === "missing" || target.kind === "unknown") {
    durdur([`DURDURULDU: ${target.masked}`, "Salt-okuma script'i icin bile gecerli bir hedef gerekir."]);
  }

  if (target.writeAllowed) {
    console.log(`Hedef: ${target.masked}  [gelistirme hedefi — salt okuma]\n`);
    return target;
  }

  if (process.env.READONLY_REMOTE_OK !== "1") {
    durdur([
      `DURDURULDU: '${target.masked}' izinli gelistirme hedeflerinden degil.`,
      "",
      "Bu script yalnizca OKUR, hicbir sey yazmaz. Yine de production gibi bir",
      "hedefe kazara baglanmamak icin acik onay gerekir:",
      "",
      "  READONLY_REMOTE_OK=1 npx dotenv -e <env-dosyasi> -- tsx <script>",
      "",
      "Onay verilmedigi icin calistirilmadi.",
    ]);
  }

  console.log(`Hedef: ${target.masked}  [ALLOWLIST DISI — salt okuma, acik onayla]\n`);
  return target;
}

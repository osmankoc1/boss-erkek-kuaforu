/**
 * Para alanı hassasiyet RAPORU — SALT OKUMA (FAZ 2 · Sıra 9a ön tarama).
 *
 * Çalıştırma (geliştirme hedefi):
 *   npx dotenv -e .env.local -- tsx scripts/report-money-precision.ts
 *
 * Çalıştırma (production gibi allowlist DIŞI hedef — açık onay gerekir):
 *   READONLY_REMOTE_OK=1 npx dotenv -e .env.production.local -- tsx scripts/report-money-precision.ts
 *
 * ─── NE YAPAR ────────────────────────────────────────────────────────────
 * `Float` (DOUBLE PRECISION) olarak saklanan 15 parasal/oransal alanı tarar
 * ve `Decimal` geçişinden ÖNCE bilinmesi gereken üç şeyi çıkarır:
 *
 *   1. Tablo başına satır sayısı        → kilit penceresi tahmini
 *   2. Hedef ölçeği aşan hassasiyet     → cast sırasında DEĞER DEĞİŞİR mi
 *   3. Hedef aralığı aşan büyüklük      → cast HATA VERİR mi
 *
 * ─── FLOAT GÜRÜLTÜSÜ NEDEN SORUN DEĞİL ───────────────────────────────────
 * "0.1 + 0.2 = 0.30000000000000004 saklanmışsa cast bunu bozar mı?" sorusu
 * akla gelir. Gelmiyor — PostgreSQL'in `float8 -> numeric` dönüşümü değeri
 * ÖNCE en kısa geri-dönüşlü (shortest round-trip) gösterime normalize eder.
 * PostgreSQL 18.6 üzerinde ölçüldü:
 *
 *     0.30000000000000004::float8::text     -> '0.30000000000000004'
 *     0.30000000000000004::float8::numeric  -> '0.3'          (normalize)
 *     8.165::float8::numeric                -> '8.165'        (korunur)
 *
 * Sonuç: 2 ondalık haneli olarak yazılmış her değer cast'ten aynen çıkar.
 * Bu yüzden tarama ikili ve kesindir:
 *
 *   FAZLA   → değerin kısa gösteriminde 2'den fazla ondalık var.
 *             Cast sessizce yuvarlar; tutar DEĞİŞİR. Karar gerektirir.
 *   ARALIK  → değer hedef Decimal aralığına sığmıyor.
 *             `ALTER TABLE` 22003 "numeric field overflow" ile PATLAR.
 *             (Bu davranış de bu ortamda fiilen doğrulandı.)
 *
 * ─── HİÇBİR ŞEY YAZMAZ ───────────────────────────────────────────────────
 * Yuvarlama, düzeltme, güncelleme yapmaz. Yalnızca okur ve raporlar.
 * Düzeltme gerekiyorsa bu ayrı bir karar ve ayrı bir script'tir.
 */
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { assertReadableDatabase } from "../lib/db-guard";

neonConfig.webSocketConstructor = ws;

const { connectionString: cs, masked } = assertReadableDatabase();
const db = new PrismaClient({ adapter: new PrismaNeon({ connectionString: cs }) });

/** Detay listesinde tablo başına gösterilecek azami kayıt. */
const DETAY_LIMIT = 20;

/**
 * Sıfırdan farklı sayılacak asgari fark.
 *
 * Postgres float8->numeric dönüşümü zaten normalize ettiği için pratikte
 * fark ya tam 0'dır ya da >= 0.001'dir; bu eşik yalnızca kayan nokta
 * karşılaştırmasında kenar durum bırakmamak içindir.
 */
const FARK_ESIGI = 1e-9;

type Alan = {
  tablo: string;
  alan: string;
  /** Hedef Prisma tipi. */
  hedef: string;
  /** NUMERIC ölçeği (ondalık hane). */
  olcek: number;
  /** NUMERIC toplam basamak. */
  hassasiyet: number;
};

/**
 * Taranacak alanlar — Sıra 9 analizinde belirlenen 15 alan.
 *
 * Bu liste SABİTTİR ve dışarıdan girdi almaz; aşağıdaki `$queryRawUnsafe`
 * çağrıları yalnızca bu listedeki tanımlayıcıları kullanır. (Prisma ham
 * sorguda tablo/kolon adı parametrelemeye izin vermez.)
 */
const ALANLAR: Alan[] = [
  { tablo: "Sale", alan: "listedPrice", hedef: "Decimal(12,2)", olcek: 2, hassasiyet: 12 },
  { tablo: "Sale", alan: "saleAmount", hedef: "Decimal(12,2)", olcek: 2, hassasiyet: 12 },
  { tablo: "Sale", alan: "paidAmount", hedef: "Decimal(12,2)", olcek: 2, hassasiyet: 12 },
  { tablo: "Sale", alan: "remainingAmount", hedef: "Decimal(12,2)", olcek: 2, hassasiyet: 12 },
  { tablo: "Sale", alan: "barberShare", hedef: "Decimal(12,2)", olcek: 2, hassasiyet: 12 },
  { tablo: "Sale", alan: "businessShare", hedef: "Decimal(12,2)", olcek: 2, hassasiyet: 12 },
  { tablo: "Sale", alan: "barberCommissionRate", hedef: "Decimal(5,2)", olcek: 2, hassasiyet: 5 },
  { tablo: "SaleItem", alan: "price", hedef: "Decimal(12,2)", olcek: 2, hassasiyet: 12 },
  { tablo: "CustomerPayment", alan: "amount", hedef: "Decimal(12,2)", olcek: 2, hassasiyet: 12 },
  { tablo: "Expense", alan: "amount", hedef: "Decimal(12,2)", olcek: 2, hassasiyet: 12 },
  { tablo: "BarberPayout", alan: "amount", hedef: "Decimal(12,2)", olcek: 2, hassasiyet: 12 },
  { tablo: "Service", alan: "price", hedef: "Decimal(12,2)", olcek: 2, hassasiyet: 12 },
  { tablo: "AppointmentService", alan: "price", hedef: "Decimal(12,2)", olcek: 2, hassasiyet: 12 },
  { tablo: "Appointment", alan: "appointmentPrice", hedef: "Decimal(12,2)", olcek: 2, hassasiyet: 12 },
  { tablo: "Barber", alan: "commissionRate", hedef: "Decimal(5,2)", olcek: 2, hassasiyet: 5 },
];

/** Tabloların satır sayısı — alan listesinden türetilir. */
const TABLOLAR = Array.from(new Set(ALANLAR.map((a) => a.tablo)));

type Ozet = {
  toplam: number;
  bosOlmayan: number;
  nullSayisi: number;
  fazlaOndalik: number;
  aralikAsan: number;
  enKucuk: number | null;
  enBuyuk: number | null;
};

type Detay = { id: string; deger: number; yuvarlanmis: number; fark: number };

const say = (n: number) => n.toLocaleString("tr-TR");
const sayi = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

async function alanOzeti(a: Alan): Promise<Ozet> {
  // NUMERIC üzerinden karşılaştırılır: Float'ın kendi temsil hatası
  // karşılaştırmaya karışmasın diye önce metinsel ondalık gösterime,
  // sonra hedef ölçeğe yuvarlanır.
  const maxDeger = Math.pow(10, a.hassasiyet - a.olcek); // ör. Decimal(12,2) -> 10^10
  const sql = `
    SELECT
      count(*)::int AS toplam,
      count("${a.alan}")::int AS bos_olmayan,
      count(*) FILTER (
        WHERE "${a.alan}" IS NOT NULL
          AND abs("${a.alan}"::numeric - round("${a.alan}"::numeric, ${a.olcek})) >= ${FARK_ESIGI}
      )::int AS fazla_ondalik,
      count(*) FILTER (
        WHERE "${a.alan}" IS NOT NULL AND abs("${a.alan}") >= ${maxDeger}
      )::int AS aralik_asan,
      min("${a.alan}") AS en_kucuk,
      max("${a.alan}") AS en_buyuk
    FROM "${a.tablo}"`;

  const [r] = await db.$queryRawUnsafe<Record<string, unknown>[]>(sql);
  return {
    toplam: sayi(r.toplam),
    bosOlmayan: sayi(r.bos_olmayan),
    nullSayisi: sayi(r.toplam) - sayi(r.bos_olmayan),
    fazlaOndalik: sayi(r.fazla_ondalik),
    aralikAsan: sayi(r.aralik_asan),
    enKucuk: r.en_kucuk === null ? null : Number(r.en_kucuk),
    enBuyuk: r.en_buyuk === null ? null : Number(r.en_buyuk),
  };
}

async function alanDetay(a: Alan): Promise<Detay[]> {
  const sql = `
    SELECT
      "id"::text AS id,
      "${a.alan}" AS deger,
      round("${a.alan}"::numeric, ${a.olcek}) AS yuvarlanmis,
      abs("${a.alan}"::numeric - round("${a.alan}"::numeric, ${a.olcek})) AS fark
    FROM "${a.tablo}"
    WHERE "${a.alan}" IS NOT NULL
      AND abs("${a.alan}"::numeric - round("${a.alan}"::numeric, ${a.olcek})) >= ${FARK_ESIGI}
    ORDER BY fark DESC
    LIMIT ${DETAY_LIMIT}`;

  const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(sql);
  return rows.map((r) => ({
    id: String(r.id),
    deger: Number(r.deger),
    yuvarlanmis: Number(r.yuvarlanmis),
    fark: Number(r.fark),
  }));
}

async function main() {
  console.log("=".repeat(78));
  console.log("PARA ALANI HASSASIYET RAPORU — SALT OKUMA");
  console.log(`Hedef: ${masked}`);
  console.log(`Tarih: ${new Date().toISOString()}`);
  console.log("Bu script hicbir veriyi degistirmez.");
  console.log("=".repeat(78));

  // ── 1. Tablo basina satir sayisi ────────────────────────────────────────
  console.log("\n1) TABLO BASINA SATIR SAYISI\n");
  const satirSayisi = new Map<string, number>();
  for (const t of TABLOLAR) {
    const [r] = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${t}"`);
    satirSayisi.set(t, sayi(r.n));
  }
  const enUzunTablo = Math.max(...TABLOLAR.map((t) => t.length));
  for (const t of TABLOLAR) {
    console.log(`   ${t.padEnd(enUzunTablo)}  ${say(satirSayisi.get(t) ?? 0).padStart(9)} satir`);
  }
  const toplamSatir = TABLOLAR.reduce((s, t) => s + (satirSayisi.get(t) ?? 0), 0);
  console.log(`   ${"".padEnd(enUzunTablo)}  ${"-".repeat(9)}`);
  console.log(`   ${"TOPLAM".padEnd(enUzunTablo)}  ${say(toplamSatir).padStart(9)} satir`);

  // ── 2. Alan bazinda hassasiyet ──────────────────────────────────────────
  console.log("\n\n2) ALAN BAZINDA HASSASIYET TARAMASI\n");
  console.log(
    "   " +
      "TABLO.ALAN".padEnd(38) +
      "HEDEF".padEnd(15) +
      "DOLU".padStart(8) +
      "FAZLA".padStart(8) +
      "ARALIK".padStart(8)
  );
  console.log("   " + "-".repeat(78));

  const ozetler = new Map<string, Ozet>();
  let toplamFazla = 0;
  let toplamAralik = 0;

  for (const a of ALANLAR) {
    const o = await alanOzeti(a);
    ozetler.set(`${a.tablo}.${a.alan}`, o);
    toplamFazla += o.fazlaOndalik;
    toplamAralik += o.aralikAsan;

    const isaret = o.fazlaOndalik > 0 || o.aralikAsan > 0 ? "  <<<" : "";
    console.log(
      "   " +
        `${a.tablo}.${a.alan}`.padEnd(38) +
        a.hedef.padEnd(15) +
        say(o.bosOlmayan).padStart(8) +
        say(o.fazlaOndalik).padStart(8) +
        say(o.aralikAsan).padStart(8) +
        isaret
    );
  }
  console.log("   " + "-".repeat(78));
  console.log(
    "   " +
      "TOPLAM".padEnd(53) +
      say(toplamFazla).padStart(8) +
      say(toplamAralik).padStart(8)
  );
  console.log("");
  console.log("   FAZLA  = 2 haneden fazla ondalik; cast SESSIZCE yuvarlar, tutar DEGISIR -> karar gerekir");
  console.log("   ARALIK = hedef Decimal araligina sigmiyor; ALTER TABLE 22003 ile PATLAR  -> engelleyici");
  console.log("   (Float temsil artigi bir kategori DEGILDIR: Postgres float8->numeric");
  console.log("    donusumunde kisa gosterime normalize eder, deger degismez.)");

  // ── 3. Deger araliklari ─────────────────────────────────────────────────
  console.log("\n\n3) DEGER ARALIKLARI (min / max)\n");
  for (const a of ALANLAR) {
    const o = ozetler.get(`${a.tablo}.${a.alan}`)!;
    if (o.bosOlmayan === 0) {
      console.log(`   ${`${a.tablo}.${a.alan}`.padEnd(38)} (veri yok)`);
      continue;
    }
    console.log(
      `   ${`${a.tablo}.${a.alan}`.padEnd(38)} min=${String(o.enKucuk).padStart(12)}   max=${String(o.enBuyuk).padStart(12)}` +
        (o.nullSayisi > 0 ? `   null=${o.nullSayisi}` : "")
    );
  }

  // ── 4. Sorunlu kayitlarin detayi ────────────────────────────────────────
  console.log("\n\n4) 2 HANEDEN FAZLA ONDALIKLI KAYITLAR (kayit bazinda)\n");
  if (toplamFazla === 0) {
    console.log("   Boyle bir kayit YOK. Hicbir tutar cast sirasinda degismeyecek.");
  } else {
    for (const a of ALANLAR) {
      const o = ozetler.get(`${a.tablo}.${a.alan}`)!;
      if (o.fazlaOndalik === 0) continue;
      console.log(`   ${a.tablo}.${a.alan}  —  ${say(o.fazlaOndalik)} kayit`);
      const detaylar = await alanDetay(a);
      for (const d of detaylar) {
        console.log(
          `      ${d.id.padEnd(28)} ${String(d.deger).padStart(16)}  ->  ${String(d.yuvarlanmis).padStart(12)}   fark=${d.fark}`
        );
      }
      if (o.fazlaOndalik > detaylar.length) {
        console.log(`      ... ve ${say(o.fazlaOndalik - detaylar.length)} kayit daha (ilk ${DETAY_LIMIT} gosterildi)`);
      }
      console.log("");
    }
  }

  // ── 5. Aralik asan kayitlar ─────────────────────────────────────────────
  if (toplamAralik > 0) {
    console.log("\n5) HEDEF ARALIGI ASAN KAYITLAR — ENGELLEYICI\n");
    for (const a of ALANLAR) {
      const o = ozetler.get(`${a.tablo}.${a.alan}`)!;
      if (o.aralikAsan === 0) continue;
      console.log(`   ${a.tablo}.${a.alan}  —  ${say(o.aralikAsan)} kayit  (hedef ${a.hedef})`);
      const maxDeger = Math.pow(10, a.hassasiyet - a.olcek);
      const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT "id"::text AS id, "${a.alan}" AS deger FROM "${a.tablo}"
         WHERE "${a.alan}" IS NOT NULL AND abs("${a.alan}") >= ${maxDeger}
         ORDER BY abs("${a.alan}") DESC LIMIT ${DETAY_LIMIT}`
      );
      for (const r of rows) console.log(`      ${String(r.id).padEnd(28)} ${String(r.deger)}`);
      console.log("");
    }
  }

  // ── 6. Karar ────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(78));
  console.log("SONUC");
  console.log("=".repeat(78));
  console.log(`   Taranan alan              : ${ALANLAR.length}`);
  console.log(`   Taranan tablo             : ${TABLOLAR.length}`);
  console.log(`   Toplam satir              : ${say(toplamSatir)}`);
  console.log(`   2 haneden fazla ondalik   : ${say(toplamFazla)}`);
  console.log(`   Hedef araligi asan        : ${say(toplamAralik)}`);
  console.log("");

  if (toplamAralik > 0) {
    console.log("   KARAR: 9a MIGRATION'A GECILEMEZ.");
    console.log("   Hedef Decimal araligini asan kayit var; ALTER TABLE hata verir.");
    console.log("   Once hedef hassasiyet buyutulmeli ya da bu kayitlar incelenmeli.");
  } else if (toplamFazla > 0) {
    console.log("   KARAR: MIGRATION ONCESI VERI KARARI GEREKIR.");
    console.log("   Yukaridaki kayitlar cast sirasinda SESSIZCE yuvarlanacak ve tutar");
    console.log("   degisecek. Once bu kayitlarin nasil ele alinacagi kararlastirilmali.");
  } else {
    console.log("   KARAR: 9a MIGRATION'A GECMEK GUVENLI.");
    console.log("   Hicbir tutar cast sirasinda degismeyecek; veri duzeltmesi gerekmiyor.");
  }
  console.log("");
  console.log("   Bu script hicbir veriyi degistirmedi.");
  console.log("=".repeat(78) + "\n");

  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("HATA:", e);
  await db.$disconnect();
  process.exit(1);
});

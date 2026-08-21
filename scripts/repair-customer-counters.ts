/**
 * Müşteri sayaç ONARIMI — dar kapsamlı, üç kapılı, varsayılan kuru koşu.
 *
 * ─── NE YAPAR ────────────────────────────────────────────────────────────
 * Yalnızca komut satırında AÇIKÇA verilen müşteri id'leri için
 * `recalculateCustomerCounters()` çalıştırır. Bu fonksiyon uygulama
 * kodunun kullandığı fonksiyonun ta kendisidir; onarım ayrı bir mantık
 * yazmaz, aynı değişmezleri uygular:
 *
 *   I1  completedCount    == status='completed' randevu adedi
 *   I2  cancelledCount    == status='cancelled' randevu adedi
 *   I3  totalAppointments == mevcut randevu adedi
 *   I4  lastVisitAt       == max(tamamlanmış randevu, iptal edilmemiş satış)
 *
 * Başka hiçbir müşteriye, başka hiçbir tabloya, başka hiçbir alana dokunmaz.
 *
 * ─── ÜÇ KAPI ─────────────────────────────────────────────────────────────
 *   1. --customer=<id>     Etkilenecek kayıtlar tek tek sayılır (zorunlu)
 *   2. REPAIR_REMOTE_OK=1  Allowlist dışı hedef (production) onayı
 *   3. --apply             Yazma onayı — YOKSA hiçbir şey yazılmaz
 *
 * ─── KULLANIM ────────────────────────────────────────────────────────────
 * Kuru koşu (hiçbir şey yazmaz, mevcut → hesaplanan gösterir):
 *   REPAIR_REMOTE_OK=1 npx dotenv -e .env.production.local -- \
 *     tsx scripts/repair-customer-counters.ts --customer=<id>
 *
 * Onarım (yazar):
 *   REPAIR_REMOTE_OK=1 npx dotenv -e .env.production.local -- \
 *     tsx scripts/repair-customer-counters.ts --customer=<id> --apply
 *
 * Sonrasında doğrulama:
 *   READONLY_REMOTE_OK=1 npx dotenv -e .env.production.local -- \
 *     tsx scripts/report-counter-drift.ts
 */
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { assertRepairTarget } from "../lib/db-guard";
import { recalculateCustomerCounters } from "../lib/customer-counters";

neonConfig.webSocketConstructor = ws;

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const CUSTOMER_IDS = args
  .filter((a) => a.startsWith("--customer="))
  .map((a) => a.slice("--customer=".length).trim())
  .filter(Boolean);

if (CUSTOMER_IDS.length === 0) {
  console.error("\n" + "=".repeat(64));
  console.error("DURDURULDU: hicbir musteri belirtilmedi.");
  console.error("");
  console.error("Bu script YALNIZCA acikca verilen kayitlar uzerinde calisir:");
  console.error("  --customer=<customerId>   (birden fazla kez verilebilir)");
  console.error("");
  console.error("Toplu onarim, 'tum sapanlari duzelt' gibi bir kip YOKTUR;");
  console.error("etkilenecek her kayit bilerek sayilmalidir.");
  console.error("=".repeat(64) + "\n");
  process.exit(1);
}

const bilinmeyenBayrak = args.find(
  (a) => a !== "--apply" && !a.startsWith("--customer=")
);
if (bilinmeyenBayrak) {
  console.error(`DURDURULDU: taninmayan argüman '${bilinmeyenBayrak}'.`);
  process.exit(1);
}

const { connectionString } = assertRepairTarget();
const db = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });

type Sayaclar = {
  totalAppointments: number;
  completedCount: number;
  cancelledCount: number;
  lastVisitAt: Date | null;
};

const zaman = (d: Date | null) => (d ? d.toISOString() : "null");

/** Sayaçların gerçek kayıtlardan hesaplanmış hâli (yazmadan). */
async function hesapla(customerId: string): Promise<Sayaclar> {
  const [total, completed, cancelled, sonRandevu, sonSatis] = await Promise.all([
    db.appointment.count({ where: { customerId } }),
    db.appointment.count({ where: { customerId, status: "completed" } }),
    db.appointment.count({ where: { customerId, status: "cancelled" } }),
    db.appointment.findFirst({
      where: { customerId, status: "completed" },
      orderBy: { date: "desc" },
      select: { date: true },
    }),
    db.sale.findFirst({
      where: { customerId, saleStatus: { not: "VOIDED" } },
      orderBy: { saleDate: "desc" },
      select: { saleDate: true },
    }),
  ]);
  const adaylar = [sonRandevu?.date, sonSatis?.saleDate].filter((d): d is Date => !!d);
  return {
    totalAppointments: total,
    completedCount: completed,
    cancelledCount: cancelled,
    lastVisitAt: adaylar.length ? new Date(Math.max(...adaylar.map((d) => d.getTime()))) : null,
  };
}

async function main() {
  console.log("=".repeat(70));
  console.log(APPLY ? "ONARIM KIPI — VERI YAZILACAK" : "KURU KOSU — hicbir sey yazilmayacak");
  console.log(`Kapsam: ${CUSTOMER_IDS.length} musteri (acikca belirtildi)`);
  console.log("=".repeat(70) + "\n");

  const plan: { id: string; ad: string; mevcut: Sayaclar; yeni: Sayaclar; degisecek: string[] }[] = [];

  for (const id of CUSTOMER_IDS) {
    const c = await db.customer.findUnique({
      where: { id },
      select: {
        id: true, fullName: true, phone: true,
        totalAppointments: true, completedCount: true, cancelledCount: true, lastVisitAt: true,
      },
    });
    if (!c) {
      console.error(`DURDURULDU: musteri bulunamadi -> ${id}`);
      console.error("Hicbir kayit degistirilmedi.");
      await db.$disconnect();
      process.exit(1);
    }

    const mevcut: Sayaclar = {
      totalAppointments: c.totalAppointments,
      completedCount: c.completedCount,
      cancelledCount: c.cancelledCount,
      lastVisitAt: c.lastVisitAt,
    };
    const yeni = await hesapla(id);

    const degisecek: string[] = [];
    if (mevcut.totalAppointments !== yeni.totalAppointments) degisecek.push("totalAppointments");
    if (mevcut.completedCount !== yeni.completedCount) degisecek.push("completedCount");
    if (mevcut.cancelledCount !== yeni.cancelledCount) degisecek.push("cancelledCount");
    if ((mevcut.lastVisitAt?.getTime() ?? null) !== (yeni.lastVisitAt?.getTime() ?? null)) degisecek.push("lastVisitAt");

    plan.push({ id, ad: c.fullName, mevcut, yeni, degisecek });

    console.log(`  ${c.fullName} (${c.phone})`);
    console.log(`      customerId        : ${c.id}`);
    console.log(`      totalAppointments : ${mevcut.totalAppointments} -> ${yeni.totalAppointments}${degisecek.includes("totalAppointments") ? "   DEGISECEK" : ""}`);
    console.log(`      completedCount    : ${mevcut.completedCount} -> ${yeni.completedCount}${degisecek.includes("completedCount") ? "   DEGISECEK" : ""}`);
    console.log(`      cancelledCount    : ${mevcut.cancelledCount} -> ${yeni.cancelledCount}${degisecek.includes("cancelledCount") ? "   DEGISECEK" : ""}`);
    console.log(`      lastVisitAt       : ${zaman(mevcut.lastVisitAt)} -> ${zaman(yeni.lastVisitAt)}${degisecek.includes("lastVisitAt") ? "   DEGISECEK" : ""}`);
    console.log(`      degisecek alan    : ${degisecek.length ? degisecek.join(", ") : "(yok — bu kayit zaten tutarli)"}`);
    console.log("");
  }

  const degisenler = plan.filter((p) => p.degisecek.length > 0);
  console.log("-".repeat(70));
  console.log(`Incelenen: ${plan.length} musteri | Degisecek: ${degisenler.length} musteri`);
  console.log(`Toplam degisecek alan: ${degisenler.reduce((s, p) => s + p.degisecek.length, 0)}`);
  console.log("-".repeat(70) + "\n");

  if (!APPLY) {
    console.log("KURU KOSU bitti — hicbir veri degistirilmedi.");
    console.log("Onarmak icin ayni komutu --apply ile calistirin.\n");
    await db.$disconnect();
    return;
  }

  if (degisenler.length === 0) {
    console.log("Degisecek kayit yok; yazma yapilmadi.\n");
    await db.$disconnect();
    return;
  }

  console.log("YAZILIYOR...\n");
  for (const p of degisenler) {
    await recalculateCustomerCounters(db, p.id);
    const sonra = await db.customer.findUnique({
      where: { id: p.id },
      select: { totalAppointments: true, completedCount: true, cancelledCount: true, lastVisitAt: true },
    });
    const dogru =
      sonra?.totalAppointments === p.yeni.totalAppointments &&
      sonra?.completedCount === p.yeni.completedCount &&
      sonra?.cancelledCount === p.yeni.cancelledCount &&
      (sonra?.lastVisitAt?.getTime() ?? null) === (p.yeni.lastVisitAt?.getTime() ?? null);
    console.log(`  ${dogru ? "OK  " : "HATA"} ${p.ad} (${p.id})`);
    console.log(`       t=${sonra?.totalAppointments} c=${sonra?.completedCount} x=${sonra?.cancelledCount} son=${zaman(sonra?.lastVisitAt ?? null)}`);
    if (!dogru) {
      console.error("\nDURDURULDU: yazma sonrasi deger beklenenle eslesmedi.");
      await db.$disconnect();
      process.exit(1);
    }
  }

  console.log("\nONARIM TAMAMLANDI.");
  console.log("Dogrulama icin sapma raporunu calistirin:");
  console.log("  READONLY_REMOTE_OK=1 npx dotenv -e <env-dosyasi> -- tsx scripts/report-counter-drift.ts\n");
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("HATA:", e);
  await db.$disconnect();
  process.exit(1);
});

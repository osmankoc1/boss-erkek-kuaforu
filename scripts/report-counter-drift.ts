/**
 * Müşteri sayaç sapması RAPORU — SALT OKUMA (FAZ 2 · Sıra 7).
 *
 * Çalıştırma:
 *   npx dotenv -e .env.local -- tsx scripts/report-counter-drift.ts
 *
 * Bu script HİÇBİR VERİ DEĞİŞTİRMEZ. Yalnızca her müşteri için
 *   mevcut sayaç → gerçek veriden hesaplanan → fark
 * tablosunu basar. Onarım ayrı bir karar ve ayrı bir script'tir.
 */
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const cs = process.env.DATABASE_URL;
if (!cs) {
  console.error("DATABASE_URL yok.");
  process.exit(1);
}
const ep = (/@([^/.]+)/.exec(cs)?.[1] ?? "").replace(/-pooler$/, "");
const prod = ep.startsWith("ep-raspy-brook");
console.log(`Hedef endpoint: ${ep.split("-").slice(0, 3).join("-")}-****  ${prod ? "(PRODUCTION — SALT OKUMA)" : "(dev)"}\n`);

const db = new PrismaClient({ adapter: new PrismaNeon({ connectionString: cs }) });

(async () => {
  const custs = await db.customer.findMany({
    select: {
      id: true, fullName: true, phone: true,
      totalAppointments: true, completedCount: true, cancelledCount: true, lastVisitAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  let sapanMusteri = 0;
  const satirlar: string[] = [];

  for (const c of custs) {
    const appts = await db.appointment.findMany({ where: { customerId: c.id }, select: { status: true, date: true } });
    const sales = await db.sale.findMany({
      where: { customerId: c.id, saleStatus: { not: "VOIDED" } },
      select: { saleDate: true },
    });
    const g = {
      total: appts.length,
      completed: appts.filter((a) => a.status === "completed").length,
      cancelled: appts.filter((a) => a.status === "cancelled").length,
    };
    const adaylar = [
      ...appts.filter((a) => a.status === "completed").map((a) => a.date.getTime()),
      ...sales.map((s) => s.saleDate.getTime()),
    ];
    const gercekZiyaret = adaylar.length ? new Date(Math.max(...adaylar)) : null;

    const farkT = c.totalAppointments - g.total;
    const farkC = c.completedCount - g.completed;
    const farkX = c.cancelledCount - g.cancelled;
    const ziyaretFark = (c.lastVisitAt?.getTime() ?? null) !== (gercekZiyaret?.getTime() ?? null);

    if (farkT !== 0 || farkC !== 0 || farkX !== 0 || ziyaretFark) {
      sapanMusteri += 1;
      satirlar.push(
        `  ${c.fullName} (${c.phone})\n` +
        `      totalAppointments : ${c.totalAppointments} -> ${g.total}   fark ${farkT >= 0 ? "+" : ""}${farkT}\n` +
        `      completedCount    : ${c.completedCount} -> ${g.completed}   fark ${farkC >= 0 ? "+" : ""}${farkC}\n` +
        `      cancelledCount    : ${c.cancelledCount} -> ${g.cancelled}   fark ${farkX >= 0 ? "+" : ""}${farkX}\n` +
        `      lastVisitAt       : ${c.lastVisitAt?.toISOString() ?? "null"} -> ${gercekZiyaret?.toISOString() ?? "null"}${ziyaretFark ? "   FARKLI" : ""}\n` +
        `      customerId        : ${c.id}`
      );
    }
  }

  console.log("=".repeat(70));
  console.log(`TOPLAM ${custs.length} musteri incelendi — ${sapanMusteri} musteride sapma var`);
  console.log("=".repeat(70));
  if (satirlar.length) {
    console.log("\nSAPAN KAYITLAR (mevcut -> gercek):\n");
    console.log(satirlar.join("\n\n"));
  } else {
    console.log("\nHicbir sapma yok.");
  }
  console.log("\n(Bu script salt okumadir; hicbir deger degistirilmedi.)");
  await db.$disconnect();
})().catch(async (e) => {
  console.error("HATA:", e);
  await db.$disconnect();
  process.exit(1);
});

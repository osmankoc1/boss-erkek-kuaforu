/**
 * Mevcut çakışan randevuları raporlar. SALT OKUMA — hiçbir kayıt
 * değiştirilmez veya silinmez.
 *
 * Çalıştırma:
 *   npx dotenv -e .env.local -- tsx scripts/report-overlapping-appointments.ts
 *
 * Sunucu tarafı çakışma kontrolü (Faz 1 · Sıra 7) devreye girmeden önce
 * veritabanında zaten var olan çakışmaları görmek için kullanılır; yeni
 * kural bu kayıtları geriye dönük düzeltmez.
 */

import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { BLOCKING_STATUSES, rangesOverlap, timeToMinutes } from "../lib/booking-rules";

neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL tanimli degil. dotenv -e .env.local ile calistirin.");
  process.exit(1);
}

/** Hangi endpoint'e baglandigimizi maskeli goster — yanlis veritabani guvencesi. */
function maskedHost(url: string): string {
  const match = /@([^/]+)/.exec(url);
  if (!match) return "(cozumlenemedi)";
  const [endpoint, ...rest] = match[1].split(".");
  const isPooler = endpoint.endsWith("-pooler");
  const core = endpoint.replace(/-pooler$/, "");
  const segments = core.split("-");
  const shown = segments.length > 3 ? `${segments.slice(0, 3).join("-")}-****` : core;
  return `${shown}${isPooler ? "-pooler" : ""}.${rest.join(".")}`;
}

const adapter = new PrismaNeon({ connectionString });
const db = new PrismaClient({ adapter });

type Row = {
  id: string;
  barberId: string;
  date: Date;
  startTime: string;
  endTime: string;
  status: string;
  barber: { name: string };
  customer: { fullName: string; phone: string };
};

async function main() {
  console.log("=".repeat(70));
  console.log("CAKISAN RANDEVU RAPORU (salt okuma)");
  console.log("Baglanti :", maskedHost(connectionString!));
  console.log("Aktif durumlar :", BLOCKING_STATUSES.join(", "));
  console.log("=".repeat(70));

  const appointments = (await db.appointment.findMany({
    where: { status: { in: [...BLOCKING_STATUSES] } },
    select: {
      id: true,
      barberId: true,
      date: true,
      startTime: true,
      endTime: true,
      status: true,
      barber: { select: { name: true } },
      customer: { select: { fullName: true, phone: true } },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  })) as Row[];

  console.log(`\nToplam aktif randevu: ${appointments.length}\n`);

  // barberId + gun bazinda grupla
  const groups = new Map<string, Row[]>();
  for (const row of appointments) {
    const day = row.date.toISOString().slice(0, 10);
    const key = `${row.barberId}|${day}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  type Conflict = { day: string; barber: string; a: Row; b: Row };
  const conflicts: Conflict[] = [];
  let unparsable = 0;

  for (const [key, rows] of groups) {
    const day = key.split("|")[1];
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i];
        const b = rows[j];
        const aStart = timeToMinutes(a.startTime);
        const aEnd = timeToMinutes(a.endTime);
        const bStart = timeToMinutes(b.startTime);
        const bEnd = timeToMinutes(b.endTime);
        if (aStart === null || aEnd === null || bStart === null || bEnd === null) {
          unparsable++;
          continue;
        }
        if (
          rangesOverlap(
            { startMinutes: aStart, endMinutes: aEnd },
            { startMinutes: bStart, endMinutes: bEnd }
          )
        ) {
          conflicts.push({ day, barber: a.barber.name, a, b });
        }
      }
    }
  }

  if (conflicts.length === 0) {
    console.log("SONUC: Cakisan aktif randevu BULUNAMADI.\n");
  } else {
    console.log(`SONUC: ${conflicts.length} cakisma tespit edildi.\n`);
    for (const c of conflicts) {
      const identical = c.a.startTime === c.b.startTime && c.a.endTime === c.b.endTime;
      console.log(`- ${c.day}  |  ${c.barber}  |  ${identical ? "TAM" : "KISMI"} cakisma`);
      console.log(
        `    A: ${c.a.startTime}-${c.a.endTime}  [${c.a.status}]  ${c.a.customer.fullName} (${c.a.customer.phone})  id=${c.a.id}`
      );
      console.log(
        `    B: ${c.b.startTime}-${c.b.endTime}  [${c.b.status}]  ${c.b.customer.fullName} (${c.b.customer.phone})  id=${c.b.id}`
      );
    }
    console.log("");
  }

  if (unparsable > 0) {
    console.log(`UYARI: ${unparsable} karsilastirmada saat bicimi cozumlenemedi.\n`);
  }

  // Ozet
  const byStatus: Record<string, number> = {};
  for (const row of appointments) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  console.log("Durum dagilimi:", byStatus);
  console.log("Berber+gun grubu sayisi:", groups.size);
  console.log("\nHicbir kayit degistirilmedi.");
  console.log("=".repeat(70));
}

main()
  .catch((error) => {
    console.error("Rapor calistirilamadi:", error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });

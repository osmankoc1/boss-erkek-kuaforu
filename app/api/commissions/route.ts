import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/dal";
import { startOfDay, endOfDay } from "@/lib/sale";

export async function GET(req: NextRequest) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const { searchParams } = req.nextUrl;
  const range = searchParams.get("range") ?? "today";
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const now = new Date();
  let dateFrom: Date;
  let dateTo: Date = endOfDay(now);

  if (range === "custom" && from && to) {
    dateFrom = startOfDay(new Date(from));
    dateTo = endOfDay(new Date(to));
  } else if (range === "yesterday") {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    dateFrom = startOfDay(y); dateTo = endOfDay(y);
  } else if (range === "week") {
    dateFrom = new Date(now); dateFrom.setDate(dateFrom.getDate() - 6); dateFrom.setHours(0, 0, 0, 0);
  } else if (range === "month") {
    dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  } else {
    dateFrom = startOfDay(now);
  }

  const sales = await db.sale.findMany({
    where: { saleDate: { gte: dateFrom, lte: dateTo }, saleStatus: { not: "VOIDED" } },
    include: { barber: { select: { id: true, name: true, workerType: true, commissionRate: true } } },
  });

  const barberMap = new Map<string, {
    barberId: string; barberName: string; workerType: string; commissionRate: number;
    count: number; totalSale: number; barberShare: number; businessShare: number; creditSale: number;
  }>();

  for (const s of sales) {
    if (!barberMap.has(s.barberId)) {
      barberMap.set(s.barberId, {
        barberId: s.barberId, barberName: s.barberName,
        workerType: s.barberWorkerType, commissionRate: s.barberCommissionRate,
        count: 0, totalSale: 0, barberShare: 0, businessShare: 0, creditSale: 0,
      });
    }
    const b = barberMap.get(s.barberId)!;
    b.count++;
    b.totalSale += s.saleAmount;
    b.barberShare += s.barberShare;
    b.businessShare += s.businessShare;
    if (s.saleStatus !== "PAID") b.creditSale += s.remainingAmount;
  }

  const commissions = Array.from(barberMap.values());
  const totals = commissions.reduce(
    (acc, c) => ({ totalSale: acc.totalSale + c.totalSale, barberShare: acc.barberShare + c.barberShare, businessShare: acc.businessShare + c.businessShare }),
    { totalSale: 0, barberShare: 0, businessShare: 0 }
  );

  return Response.json({ commissions, totals, range, dateFrom, dateTo });
}

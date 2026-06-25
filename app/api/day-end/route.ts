import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/dal";
import { startOfDay, endOfDay } from "@/lib/sale";

export async function GET(req: NextRequest) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const date = req.nextUrl.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const d = new Date(date);

  const [sales, expenses] = await Promise.all([
    db.sale.findMany({ where: { saleDate: { gte: startOfDay(d), lte: endOfDay(d) } } }),
    db.expense.findMany({ where: { expenseDate: { gte: startOfDay(d), lte: endOfDay(d) } } }),
  ]);

  const active = sales.filter((s) => s.saleStatus !== "VOIDED");
  const totalSales = active.reduce((s, r) => s + r.saleAmount, 0);
  const totalPaid = active.reduce((s, r) => s + r.paidAmount, 0);
  const totalCredit = active.reduce((s, r) => s + r.remainingAmount, 0);
  const totalBarberShare = active.reduce((s, r) => s + r.barberShare, 0);
  const totalBusinessShare = active.reduce((s, r) => s + r.businessShare, 0);
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const netCash = totalPaid - totalExpenses;

  const byMethod: Record<string, number> = {};
  for (const s of active) byMethod[s.paymentMethod] = (byMethod[s.paymentMethod] ?? 0) + s.paidAmount;

  // Çalışan bazlı
  const barberMap = new Map<string, {
    barberId: string; barberName: string; workerType: string; commissionRate: number;
    count: number; totalSale: number; barberShare: number; businessShare: number;
    totalPaid: number; totalCredit: number;
  }>();

  for (const s of active) {
    if (!barberMap.has(s.barberId)) {
      barberMap.set(s.barberId, {
        barberId: s.barberId, barberName: s.barberName,
        workerType: s.barberWorkerType, commissionRate: s.barberCommissionRate,
        count: 0, totalSale: 0, barberShare: 0, businessShare: 0, totalPaid: 0, totalCredit: 0,
      });
    }
    const b = barberMap.get(s.barberId)!;
    b.count++;
    b.totalSale += s.saleAmount;
    b.barberShare += s.barberShare;
    b.businessShare += s.businessShare;
    b.totalPaid += s.paidAmount;
    b.totalCredit += s.remainingAmount;
  }

  return Response.json({
    date,
    totalSales, totalPaid, totalCredit, totalBarberShare, totalBusinessShare,
    totalExpenses, netCash, byMethod,
    count: active.length, voidedCount: sales.length - active.length,
    byBarber: Array.from(barberMap.values()),
    expenses,
  });
}

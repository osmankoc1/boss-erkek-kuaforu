import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/dal";
import { startOfDay, endOfDay } from "@/lib/sale";
import { summarizeRevenue } from "@/lib/revenue";
import { istanbulDateString } from "@/lib/tz";

export async function GET(req: NextRequest) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const { searchParams } = req.nextUrl;
  const date = searchParams.get("date") ?? istanbulDateString();
  const d = date;

  const [sales, expenses, payments] = await Promise.all([
    db.sale.findMany({
      where: { saleDate: { gte: startOfDay(d), lte: endOfDay(d) } },
    }),
    db.expense.findMany({
      where: { expenseDate: { gte: startOfDay(d), lte: endOfDay(d) } },
    }),
    db.customerPayment.findMany({
      where: {
        paymentDate: { gte: startOfDay(d), lte: endOfDay(d) },
        OR: [{ saleId: null }, { sale: { saleStatus: { not: "VOIDED" } } }],
      },
      select: { amount: true, paymentMethod: true },
    }),
  ]);

  // Ciro hesabi tek yerde: lib/revenue.ts (FAZ 2 · Sira 2).
  const ozet = summarizeRevenue({ sales, payments, expenses });

  return Response.json({
    // Kanonik adlar
    // Indirim gorunurlugu (FAZ 2 · Sira 10). Uc rakam birbirini tutar:
    //   listedTotal - discount = realizedRevenue
    listedTotal: ozet.listedTotal,
    discount: ozet.discount,
    realizedRevenue: ozet.realizedRevenue,
    collected: ozet.collected,
    credit: ozet.credit,
    barberShare: ozet.barberShare,
    businessShare: ozet.businessShare,
    expenses: ozet.expenses,
    netCash: ozet.netCash,
    byMethod: ozet.byMethod,
    count: ozet.count,
    voidedCount: ozet.voidedCount,
    // Eski adlar (geriye donuk uyum)
    totalSales: ozet.realizedRevenue,
    totalPaid: ozet.collected,
    totalCredit: ozet.credit,
    totalBarberShare: ozet.barberShare,
    totalBusinessShare: ozet.businessShare,
    totalExpenses: ozet.expenses,
  });
}

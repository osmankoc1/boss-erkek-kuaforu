import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/dal";
import { sumBy, toNumber } from "@/lib/money";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const { id: secondaryId } = await ctx.params;
  const primaryId = req.nextUrl.searchParams.get("primaryId");

  if (!primaryId) return Response.json({ error: "primaryId gerekli." }, { status: 400 });

  const [primarySales, secondarySales] = await Promise.all([
    db.sale.findMany({ where: { customerId: primaryId, saleStatus: { not: "VOIDED" } }, select: { saleAmount: true, paidAmount: true, remainingAmount: true } }),
    db.sale.findMany({ where: { customerId: secondaryId, saleStatus: { not: "VOIDED" } }, select: { saleAmount: true, paidAmount: true, remainingAmount: true } }),
  ]);

  const combined = [...primarySales, ...secondarySales];
  const preview = {
    visits: combined.length,
    totalSale: toNumber(sumBy(combined, (r) => r.saleAmount)),
    totalPaid: toNumber(sumBy(combined, (r) => r.paidAmount)),
    totalDebt: toNumber(sumBy(combined, (r) => r.remainingAmount)),
  };

  return Response.json({ preview });
}

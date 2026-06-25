import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/dal";
import { startOfDay, endOfDay } from "@/lib/sale";

export async function GET(req: NextRequest) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const { searchParams } = req.nextUrl;
  const barberId = searchParams.get("barberId");
  const search = searchParams.get("search");
  const range = searchParams.get("range") ?? "all";

  const where: Record<string, unknown> = {
    saleStatus: { in: ["PARTIAL", "CREDIT"] },
  };

  if (barberId) where.barberId = barberId;
  if (search) where.customerName = { contains: search, mode: "insensitive" };

  if (range !== "all") {
    const now = new Date();
    let from: Date;
    if (range === "today") from = startOfDay(now);
    else if (range === "week") { from = new Date(now); from.setDate(from.getDate() - 7); }
    else { from = new Date(now); from.setDate(1); from.setHours(0, 0, 0, 0); }
    where.saleDate = { gte: from, lte: endOfDay(now) };
  }

  const sales = await db.sale.findMany({ where, orderBy: { saleDate: "desc" } });

  const now = new Date();
  const result = sales.map((s) => ({
    ...s,
    daysAgo: Math.floor((now.getTime() - new Date(s.saleDate).getTime()) / 86400000),
  }));

  return Response.json({ debts: result });
}

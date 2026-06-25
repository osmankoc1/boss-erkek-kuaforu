import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/dal";
import { startOfDay, endOfDay } from "@/lib/sale";

const schema = z.object({
  amount: z.number().positive(),
  category: z.string().min(1),
  description: z.string().optional().nullable(),
  expenseDate: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const { searchParams } = req.nextUrl;
  const date = searchParams.get("date");
  const category = searchParams.get("category");

  const where: Record<string, unknown> = {};
  if (date) {
    const d = new Date(date);
    where.expenseDate = { gte: startOfDay(d), lte: endOfDay(d) };
  }
  if (category) where.category = category;

  const expenses = await db.expense.findMany({ where, orderBy: { expenseDate: "desc" } });
  return Response.json({ expenses });
}

export async function POST(req: NextRequest) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Geçersiz veri." }, { status: 400 });

  const expense = await db.expense.create({
    data: {
      amount: parsed.data.amount,
      category: parsed.data.category,
      description: parsed.data.description ?? null,
      expenseDate: parsed.data.expenseDate ? new Date(parsed.data.expenseDate) : new Date(),
    },
  });

  return Response.json({ expense }, { status: 201 });
}

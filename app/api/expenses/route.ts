import { NextRequest } from "next/server";
import { createdFields, writeAudit } from "@/lib/audit";
import { adminActor } from "@/lib/audit-actor";
import { moneyAmount } from "@/lib/money-schema";
import { z } from "zod";
import { db } from "@/lib/db";
import { serializeMoney } from "@/lib/money";
import { requireAdmin } from "@/lib/dal";
import { startOfDay, endOfDay } from "@/lib/sale";

const schema = z.object({
  amount: moneyAmount.positive(),
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
    where.expenseDate = { gte: startOfDay(date), lte: endOfDay(date) };
  }
  if (category) where.category = category;

  const expenses = await db.expense.findMany({ where, orderBy: { expenseDate: "desc" } });
  return Response.json({ expenses: expenses.map((e) => serializeMoney(e, ["amount"])) });
}

export async function POST(req: NextRequest) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Geçersiz veri." }, { status: 400 });

  const actor = await adminActor();

  // Denetim izi ana islemle ayni transaction'da olmali (FAZ 2 · Sira 10b);
  // bu yuzden tek yazim da transaction'a alindi.
  const expense = await db.$transaction(async (tx) => {
    const olusan = await tx.expense.create({
      data: {
        amount: parsed.data.amount,
        category: parsed.data.category,
        description: parsed.data.description ?? null,
        expenseDate: parsed.data.expenseDate ? new Date(parsed.data.expenseDate) : new Date(),
      },
    });
    await writeAudit(tx, {
      entity: "Expense",
      entityId: olusan.id,
      action: "CREATE",
      actor,
      changes: createdFields("Expense", olusan),
    });
    return olusan;
  });

  return Response.json({ expense: serializeMoney(expense, ["amount"]) }, { status: 201 });
}

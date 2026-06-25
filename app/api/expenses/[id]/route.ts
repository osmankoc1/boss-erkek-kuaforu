import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/dal";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const existing = await db.expense.findUnique({ where: { id } });
  if (!existing) return Response.json({ error: "Gider bulunamadı." }, { status: 404 });
  await db.expense.delete({ where: { id } });
  return Response.json({ ok: true });
}

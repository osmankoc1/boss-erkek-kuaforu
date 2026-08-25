import { NextRequest } from "next/server";
import { deletedFields, writeAudit } from "@/lib/audit";
import { adminActor } from "@/lib/audit-actor";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/dal";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const existing = await db.expense.findUnique({ where: { id } });
  if (!existing) return Response.json({ error: "Gider bulunamadı." }, { status: 404 });

  const actor = await adminActor();

  // Silinen kaydin degerleri denetim izine gecmeden silme tamamlanmaz
  // (FAZ 2 · Sira 10b): audit yazilamazsa silme de geri alinir.
  await db.$transaction(async (tx) => {
    await tx.expense.delete({ where: { id } });
    await writeAudit(tx, {
      entity: "Expense",
      entityId: id,
      action: "DELETE",
      actor,
      changes: deletedFields("Expense", existing),
    });
  });

  return Response.json({ ok: true });
}

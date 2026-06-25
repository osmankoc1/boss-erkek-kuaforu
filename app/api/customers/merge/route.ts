import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/dal";

const schema = z.object({
  primaryId: z.string().min(1),
  secondaryId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Geçersiz veri." }, { status: 400 });

  const { primaryId, secondaryId } = parsed.data;
  if (primaryId === secondaryId) return Response.json({ error: "Aynı müşteri seçilemez." }, { status: 400 });

  const [primary, secondary] = await Promise.all([
    db.customer.findUnique({ where: { id: primaryId } }),
    db.customer.findUnique({ where: { id: secondaryId } }),
  ]);
  if (!primary) return Response.json({ error: "Ana müşteri bulunamadı." }, { status: 404 });
  if (!secondary) return Response.json({ error: "Birleştirilecek müşteri bulunamadı." }, { status: 404 });
  if (secondary.mergedIntoCustomerId) return Response.json({ error: "Bu müşteri zaten birleştirilmiş." }, { status: 400 });

  await db.$transaction([
    db.sale.updateMany({ where: { customerId: secondaryId }, data: { customerId: primaryId } }),
    db.customerPayment.updateMany({ where: { customerId: secondaryId }, data: { customerId: primaryId } }),
    db.appointment.updateMany({ where: { customerId: secondaryId }, data: { customerId: primaryId } }),
    db.customer.update({
      where: { id: secondaryId },
      data: {
        mergedIntoCustomerId: primaryId,
        mergedAt: new Date(),
        phone: `__merged_${secondaryId}_${secondary.phone}`,
      },
    }),
  ]);

  return Response.json({ ok: true, primaryId });
}

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/dal";
import { calcShares, calcStatus } from "@/lib/sale";

const patchSchema = z.object({
  saleAmount: z.number().min(0).optional(),
  paidAmount: z.number().min(0).optional(),
  paymentMethod: z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]).optional(),
  note: z.string().optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Geçersiz veri." }, { status: 400 });

  const existing = await db.sale.findUnique({ where: { id } });
  if (!existing) return Response.json({ error: "Satış bulunamadı." }, { status: 404 });
  if (existing.saleStatus === "VOIDED") return Response.json({ error: "İptal edilmiş satış düzenlenemez." }, { status: 400 });

  const saleAmount = parsed.data.saleAmount ?? existing.saleAmount;
  const paidAmount = parsed.data.paidAmount ?? existing.paidAmount;
  const remainingAmount = Math.round((saleAmount - paidAmount) * 100) / 100;
  const saleStatus = calcStatus(paidAmount, saleAmount);
  const { barberShare, businessShare } = calcShares(saleAmount, existing.barberWorkerType, existing.barberCommissionRate);

  const sale = await db.sale.update({
    where: { id },
    data: {
      saleAmount,
      paidAmount,
      remainingAmount,
      saleStatus,
      barberShare,
      businessShare,
      paymentMethod: parsed.data.paymentMethod ?? existing.paymentMethod,
      note: parsed.data.note !== undefined ? parsed.data.note : existing.note,
    },
  });

  return Response.json({ sale });
}

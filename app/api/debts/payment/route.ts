import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/dal";
import { calcStatus } from "@/lib/sale";

const schema = z.object({
  saleId: z.string().min(1),
  customerId: z.string().optional().nullable(),
  amount: z.number().positive(),
  paymentMethod: z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]).default("CASH"),
  note: z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Geçersiz veri." }, { status: 400 });

  const { saleId, amount, paymentMethod, note } = parsed.data;
  const customerId = parsed.data.customerId ?? null;

  const sale = await db.sale.findUnique({ where: { id: saleId } });
  if (!sale) return Response.json({ error: "Satış bulunamadı." }, { status: 404 });
  if (sale.saleStatus === "VOIDED") return Response.json({ error: "İptal edilmiş satışa ödeme yapılamaz." }, { status: 400 });

  const newPaid = Math.round((sale.paidAmount + amount) * 100) / 100;
  const capped = Math.min(newPaid, sale.saleAmount);
  const newRemaining = Math.round((sale.saleAmount - capped) * 100) / 100;
  const newStatus = calcStatus(capped, sale.saleAmount);

  const [payment, updatedSale] = await db.$transaction([
    db.customerPayment.create({
      data: {
        customerId,
        saleId,
        amount,
        paymentMethod,
        note: note ?? null,
      },
    }),
    db.sale.update({
      where: { id: saleId },
      data: {
        paidAmount: capped,
        remainingAmount: newRemaining,
        saleStatus: newStatus,
      },
    }),
  ]);

  return Response.json({ payment, sale: updatedSale }, { status: 201 });
}

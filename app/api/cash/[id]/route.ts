import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/dal";
import { calcShares, calcStatus } from "@/lib/sale";
import { round2, serializeSale, toNumber } from "@/lib/money";
import { moneyAmount } from "@/lib/money-schema";

const patchSchema = z.object({
  saleAmount: moneyAmount.min(0).optional(),
  paidAmount: moneyAmount.min(0).optional(),
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

  const saleAmount = round2(parsed.data.saleAmount ?? existing.saleAmount);
  const paidAmount = round2(parsed.data.paidAmount ?? existing.paidAmount);

  // Satis tutari, tahsil edilmis paranin ALTINA cekilemez (FAZ 2 · Sira 10).
  //
  // Onceden bu sessizce NEGATIF `remainingAmount` uretiyordu: 1000 TL tahsil
  // edilmis bir satis 400'e cekilince kalan -600 oluyor, durum "PAID"
  // kaliyordu. Musteri 600 TL fazla odemis durumda ama ne uyari cikiyor ne
  // iade izi olusuyordu.
  //
  // Iade BILINCLI olarak burada uretilmez; ayri bir is akisidir. Bu uc nokta
  // yalnizca tutarsiz durumu reddeder. (Ayni ilke Sira 6'da "kalan borctan
  // fazlasini kirpma, reddet" kararinda da uygulanmisti.)
  if (saleAmount.lessThan(paidAmount)) {
    return Response.json(
      {
        error:
          `Satış tutarı ${saleAmount.toFixed(2)} ₺, tahsil edilmiş ${paidAmount.toFixed(2)} ₺'nin altına ` +
          `çekilemez. Önce tahsilatı düzeltin ya da iade işlemini ayrıca yapın.`,
        code: "AMOUNT_BELOW_COLLECTED",
        saleAmount: toNumber(saleAmount),
        paidAmount: toNumber(paidAmount),
      },
      { status: 400 }
    );
  }

  const remainingAmount = round2(saleAmount.minus(paidAmount));
  const saleStatus = calcStatus(paidAmount, saleAmount);
  const { barberShare, businessShare } = calcShares(saleAmount, existing.barberWorkerType, existing.barberCommissionRate);

  // Odenen tutar degistiyse odeme defterine duzeltme satiri yazilir; boylece
  // Σ(odeme defteri) == sale.paidAmount degismezi korunur (FAZ 2 · Sira 3).
  const fark = round2(paidAmount.minus(existing.paidAmount));

  const [sale] = await db.$transaction([
    db.sale.update({
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
    }),
    ...(!fark.isZero()
      ? [
          db.customerPayment.create({
            data: {
              customerId: existing.customerId,
              saleId: id,
              amount: fark,
              paymentMethod: parsed.data.paymentMethod ?? existing.paymentMethod,
              note: "Satış düzenlemesi (tutar farkı)",
            },
          }),
        ]
      : []),
  ]);

  return Response.json({ sale: serializeSale(sale) });
}

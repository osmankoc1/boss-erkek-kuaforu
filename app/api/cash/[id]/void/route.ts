import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/dal";

const schema = z.object({
  voidReason: z.string().optional().nullable(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);

  const existing = await db.sale.findUnique({ where: { id } });
  if (!existing) return Response.json({ error: "Satış bulunamadı." }, { status: 404 });
  if (existing.saleStatus === "VOIDED") return Response.json({ error: "Zaten iptal edilmiş." }, { status: 400 });

  const sale = await db.sale.update({
    where: { id },
    data: {
      saleStatus: "VOIDED",
      voidedAt: new Date(),
      voidReason: parsed.success ? (parsed.data.voidReason ?? null) : null,
    },
  });

  return Response.json({ sale });
}

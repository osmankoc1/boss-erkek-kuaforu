import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { serializeMoney } from "@/lib/money";
import { getSession } from "@/lib/session";
import { barberUpdateSchema, firstIssueMessage } from "@/lib/admin-schemas";

/**
 * Çalışan değişikliği public sayfaları etkiler (FAZ 3 · Sıra 3.1).
 *
 * `/ekibimiz` ve `/` build zamanında statik üretiliyor; bu çağrı olmadan
 * yeni/güncellenen çalışan sitede görünmüyordu. `/randevu` da berber
 * listesini kullandığı için birlikte yenilenir.
 */
function calisanSayfalariniYenile() {
  revalidatePath("/ekibimiz");
  revalidatePath("/");
  revalidatePath("/randevu");
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/barbers/[id]">) {
  const session = await getSession();
  if (!session?.userId) return Response.json({ error: "Yetkisiz." }, { status: 401 });

  const { id } = await ctx.params;

  const body = await req.json().catch(() => null);
  const parsed = barberUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: firstIssueMessage(parsed.error) }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return Response.json({ error: "Güncellenecek alan yok." }, { status: 400 });
  }

  const existing = await db.barber.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return Response.json({ error: "Çalışan bulunamadı." }, { status: 404 });

  // Yalnızca doğrulanmış alanlar yazılır; `id` ve `createdAt` değiştirilemez.
  const barber = await db.barber.update({ where: { id }, data: parsed.data });
  calisanSayfalariniYenile();
  return Response.json({ barber: serializeMoney(barber, ["commissionRate"]) });
}

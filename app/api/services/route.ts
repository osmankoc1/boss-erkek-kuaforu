import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { hasValidMoneyScale, MONEY_SCALE_ERROR, serializeMoney } from "@/lib/money";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

/**
 * Hizmet değişikliği public sayfaları etkiler (FAZ 3 · Sıra 3.1).
 *
 * `/hizmetler` ve `/` build zamanında statik üretiliyor. Bu çağrı olmadan
 * yeni/güncellenen hizmet, bir sonraki deploy'a kadar sitede GÖRÜNMÜYORDU.
 */
function hizmetSayfalariniYenile() {
  revalidatePath("/hizmetler");
  revalidatePath("/");
}

export async function GET(req: NextRequest) {
  const showAll = req.nextUrl.searchParams.get("all") === "1";
  const where = showAll ? {} : { isActive: true };
  const services = await db.service.findMany({
    where,
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
  });
  return Response.json({ services: services.map((s) => serializeMoney(s, ["price"])) });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.userId) return Response.json({ error: "Yetkisiz." }, { status: 401 });

  const body = await req.json();

  // Fiyat kurusa yuvarlanmis olmali; sunucu sessizce yuvarlamaz (Sira 9a).
  const price = Number(body.price) || 0;
  if (!hasValidMoneyScale(price)) {
    return Response.json({ error: MONEY_SCALE_ERROR }, { status: 400 });
  }

  const maxOrder = await db.service.aggregate({ _max: { displayOrder: true } });
  const nextOrder = (maxOrder._max.displayOrder ?? 0) + 1;

  const service = await db.service.create({
    data: {
      name: body.name,
      description: body.description || null,
      durationMinutes: Number(body.durationMinutes) || 30,
      price,
      category: body.category || "Diğer",
      displayOrder: nextOrder,
    },
  });
  hizmetSayfalariniYenile();
  return Response.json({ service: serializeMoney(service, ["price"]) }, { status: 201 });
}

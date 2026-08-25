import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { serializeMoney } from "@/lib/money";
import { getSession } from "@/lib/session";
import { PUBLIC_BARBER_SELECT } from "@/lib/public-fields";
import { barberCreateSchema, firstIssueMessage } from "@/lib/admin-schemas";

/**
 * Public berber listesi. Yalnızca müşteriye gösterilebilen alanlar döner —
 * `commissionRate` ve `workerType` bu yanıtta asla yer almaz.
 * Admin ekranları verisini sunucu bileşenlerinden alır, bu endpoint'ten değil.
 */
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

export async function GET() {
  const barbers = await db.barber.findMany({
    where: { isActive: true },
    select: PUBLIC_BARBER_SELECT,
    orderBy: { name: "asc" },
  });
  return Response.json({ barbers });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.userId) return Response.json({ error: "Yetkisiz." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = barberCreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: firstIssueMessage(parsed.error) }, { status: 400 });
  }

  // Yalnızca doğrulanmış alanlar yazılır — `id`, `createdAt` gibi sistem
  // alanları veya şemada olmayan alanlar buraya asla ulaşamaz.
  const barber = await db.barber.create({ data: parsed.data });
  calisanSayfalariniYenile();
  return Response.json({ barber: serializeMoney(barber, ["commissionRate"]) }, { status: 201 });
}

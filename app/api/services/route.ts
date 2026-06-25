import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const showAll = req.nextUrl.searchParams.get("all") === "1";
  const where = showAll ? {} : { isActive: true };
  const services = await db.service.findMany({
    where,
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
  });
  return Response.json({ services });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.userId) return Response.json({ error: "Yetkisiz." }, { status: 401 });

  const body = await req.json();

  const maxOrder = await db.service.aggregate({ _max: { displayOrder: true } });
  const nextOrder = (maxOrder._max.displayOrder ?? 0) + 1;

  const service = await db.service.create({
    data: {
      name: body.name,
      description: body.description || null,
      durationMinutes: Number(body.durationMinutes) || 30,
      price: Number(body.price) || 0,
      category: body.category || "Diğer",
      displayOrder: nextOrder,
    },
  });
  return Response.json({ service }, { status: 201 });
}

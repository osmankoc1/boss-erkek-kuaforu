import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function GET() {
  const barbers = await db.barber.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  return Response.json({ barbers });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.userId) return Response.json({ error: "Yetkisiz." }, { status: 401 });

  const body = await req.json();
  const barber = await db.barber.create({ data: body });
  return Response.json({ barber }, { status: 201 });
}

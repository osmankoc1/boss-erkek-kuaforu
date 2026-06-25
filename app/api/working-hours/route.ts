import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.userId) return Response.json({ error: "Yetkisiz." }, { status: 401 });
  const body = await req.json();
  const wh = await db.workingHour.create({ data: body });
  return Response.json({ wh }, { status: 201 });
}

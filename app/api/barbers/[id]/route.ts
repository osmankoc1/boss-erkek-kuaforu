import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/barbers/[id]">) {
  const session = await getSession();
  if (!session?.userId) return Response.json({ error: "Yetkisiz." }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json();
  const barber = await db.barber.update({ where: { id }, data: body });
  return Response.json({ barber });
}

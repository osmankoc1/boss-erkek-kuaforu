import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  buttonText: z.string().optional().nullable(),
  buttonLink: z.string().optional().nullable(),
  priority: z.number().int().min(0).max(99).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  isActive: z.boolean().optional(),
  showOnHome: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/campaigns/[id]">) {
  const session = await getSession();
  if (!session?.userId) return Response.json({ error: "Yetkisiz." }, { status: 401 });

  const { id } = await ctx.params;
  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Geçersiz veri." }, { status: 400 });

  const { startDate, endDate, ...rest } = parsed.data;
  const data: Record<string, unknown> = { ...rest };
  if (startDate) data.startDate = new Date(startDate);
  if (endDate) data.endDate = new Date(endDate);

  const campaign = await db.campaign.update({ where: { id }, data });
  return Response.json({ campaign });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/campaigns/[id]">) {
  const session = await getSession();
  if (!session?.userId) return Response.json({ error: "Yetkisiz." }, { status: 401 });
  const { id } = await ctx.params;
  await db.campaign.delete({ where: { id } });
  return Response.json({ ok: true });
}

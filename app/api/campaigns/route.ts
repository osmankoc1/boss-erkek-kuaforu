import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

const campaignSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  buttonText: z.string().optional().nullable(),
  buttonLink: z.string().optional().nullable(),
  priority: z.number().int().min(0).max(99).optional().default(0),
  showOnHome: z.boolean().optional().default(true),
  isActive: z.boolean().optional().default(true),
});

export async function GET() {
  const campaigns = await db.campaign.findMany({ orderBy: [{ priority: "asc" }, { createdAt: "desc" }] });
  return Response.json({ campaigns });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.userId) return Response.json({ error: "Yetkisiz." }, { status: 401 });

  const body = await req.json();
  const parsed = campaignSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Geçersiz veri." }, { status: 400 });

  const { startDate, endDate, ...rest } = parsed.data;
  const campaign = await db.campaign.create({
    data: { ...rest, startDate: new Date(startDate), endDate: new Date(endDate) },
  });
  return Response.json({ campaign }, { status: 201 });
}

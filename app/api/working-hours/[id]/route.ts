import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  firstIssueMessage,
  isValidWorkWindow,
  workingHourUpdateSchema,
} from "@/lib/admin-schemas";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/working-hours/[id]">) {
  const session = await getSession();
  if (!session?.userId) return Response.json({ error: "Yetkisiz." }, { status: 401 });

  const { id } = await ctx.params;

  const body = await req.json().catch(() => null);
  const parsed = workingHourUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: firstIssueMessage(parsed.error) }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return Response.json({ error: "Güncellenecek alan yok." }, { status: 400 });
  }

  const existing = await db.workingHour.findUnique({
    where: { id },
    select: { startTime: true, endTime: true, isOff: true },
  });
  if (!existing) return Response.json({ error: "Çalışma saati kaydı bulunamadı." }, { status: 404 });

  // Kısmi güncellemede pencere kontrolü, mevcut değerlerle birleştirilerek yapılır.
  const merged = { ...existing, ...parsed.data };
  if (!isValidWorkWindow(merged.startTime, merged.endTime, merged.isOff)) {
    return Response.json({ error: "Bitiş saati başlangıç saatinden sonra olmalıdır." }, { status: 400 });
  }

  // `barberId` ve `dayOfWeek` şemada yok — bir kaydın sahibi/günü değiştirilemez.
  const wh = await db.workingHour.update({ where: { id }, data: parsed.data });
  return Response.json({ wh });
}

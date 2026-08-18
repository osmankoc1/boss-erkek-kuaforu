import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  firstIssueMessage,
  isValidWorkWindow,
  workingHourCreateSchema,
} from "@/lib/admin-schemas";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.userId) return Response.json({ error: "Yetkisiz." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = workingHourCreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: firstIssueMessage(parsed.error) }, { status: 400 });
  }

  const { barberId, dayOfWeek, startTime, endTime, isOff = false } = parsed.data;

  if (!isValidWorkWindow(startTime, endTime, isOff)) {
    return Response.json({ error: "Bitiş saati başlangıç saatinden sonra olmalıdır." }, { status: 400 });
  }

  // Var olmayan çalışan için yabancı anahtar hatası 500'e düşmesin.
  const barber = await db.barber.findUnique({ where: { id: barberId }, select: { id: true } });
  if (!barber) return Response.json({ error: "Çalışan bulunamadı." }, { status: 400 });

  const wh = await db.workingHour.create({
    data: { barberId, dayOfWeek, startTime, endTime, isOff },
  });
  return Response.json({ wh }, { status: 201 });
}

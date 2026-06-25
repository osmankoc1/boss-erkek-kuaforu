import { NextRequest } from "next/server";
import { getAvailableSlots } from "@/lib/availability";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const barberId = searchParams.get("barberId");
  const date = searchParams.get("date");
  const serviceId = searchParams.get("serviceId");
  const serviceIdsParam = searchParams.get("serviceIds");
  const totalDurationParam = searchParams.get("totalDuration");

  if (!barberId || !date) {
    return Response.json({ error: "Eksik parametre." }, { status: 400 });
  }

  let durationMinutes = 30;

  if (totalDurationParam) {
    durationMinutes = parseInt(totalDurationParam, 10) || 30;
  } else if (serviceIdsParam) {
    const ids = serviceIdsParam.split(",").filter(Boolean);
    const svcs = await db.service.findMany({ where: { id: { in: ids } } });
    durationMinutes = svcs.reduce((s, sv) => s + sv.durationMinutes, 0) || 30;
  } else if (serviceId) {
    const service = await db.service.findUnique({ where: { id: serviceId } });
    if (!service) return Response.json({ slots: [] });
    durationMinutes = service.durationMinutes;
  } else {
    return Response.json({ error: "serviceId, serviceIds veya totalDuration gerekli." }, { status: 400 });
  }

  const slots = await getAvailableSlots(barberId, date, durationMinutes);
  return Response.json({ slots });
}

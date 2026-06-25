import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron-auth";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const expired = await db.appointment.findMany({
    where: {
      status: "pending_verification",
      createdAt: { lt: cutoff },
    },
    select: { id: true, notes: true },
  });

  if (expired.length === 0) {
    return Response.json({ cancelled: 0 });
  }

  await Promise.all(
    expired.map((a) =>
      db.appointment.update({
        where: { id: a.id },
        data: {
          status: "cancelled",
          notes: a.notes
            ? `${a.notes}\n[Sistem] E-posta 24 saat içinde doğrulanmadı.`
            : "[Sistem] E-posta 24 saat içinde doğrulanmadı.",
        },
      })
    )
  );

  return Response.json({ cancelled: expired.length });
}

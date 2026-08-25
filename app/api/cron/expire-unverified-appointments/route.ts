import { NextRequest } from "next/server";
import { SYSTEM_ACTOR, writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron-auth";
import { recalculateManyCustomerCounters } from "@/lib/customer-counters";

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
    select: { id: true, notes: true, customerId: true },
  });

  if (expired.length === 0) {
    return Response.json({ cancelled: 0 });
  }

  // Iptal + sayac guncellemesi tek transaction icinde (FAZ 2 · Sira 7).
  // Onceden cron randevuyu iptal ediyor ama cancelledCount'a dokunmuyordu;
  // uretim verisindeki sapmanin kaynagi buydu.
  await db.$transaction(async (tx) => {
    await Promise.all(
      expired.map((a) =>
        tx.appointment.update({
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
    await recalculateManyCustomerCounters(tx, expired.map((a) => a.customerId));

    // Denetim izi -- kaynak SYSTEM (FAZ 2 · Sira 10b). Iptal isletme
    // acisindan onemli bir gecistir; kimin yaptigi sorusunun cevabi
    // "zamanlanmis is"tir ve bu ayri bir `source` degeriyle belirtilir.
    for (const a of expired) {
      await writeAudit(tx, {
        entity: "Appointment",
        entityId: a.id,
        action: "STATUS_CHANGE",
        actor: SYSTEM_ACTOR,
        changes: { status: { before: "pending_verification", after: "cancelled" } },
      });
    }
  }, { maxWait: 10_000, timeout: 30_000 });

  return Response.json({ cancelled: expired.length });
}

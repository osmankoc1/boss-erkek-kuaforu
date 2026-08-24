import { db } from "@/lib/db";
import { serializeMoney } from "@/lib/money";
import BarberManager from "./BarberManager";

export const metadata = { title: "Çalışanlar — BOSS Admin" };

const WORKER_TYPES = ["OWNER", "COMMISSION", "FIXED_SALARY"] as const;
type WorkerType = (typeof WORKER_TYPES)[number];

/** Sema `workerType`'i String tutar; ekran birlesim tipi bekler. */
function workerType(value: string): WorkerType {
  return (WORKER_TYPES as readonly string[]).includes(value) ? (value as WorkerType) : "OWNER";
}

/** Berber satirini Client Component'e verilebilir hale getirir. */
function sunumaHazirla<T extends { workerType: string; commissionRate: unknown }>(b: T) {
  return {
    ...serializeMoney(b, ["commissionRate"] as const),
    workerType: workerType(b.workerType),
  };
}

export default async function CalisanlarPage() {
  const barbers = await db.barber.findMany({
    orderBy: { createdAt: "asc" },
    include: { workingHours: true },
  });
  return (
    <div className="p-6 md:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-black">Çalışanlar</h1>
        <p className="text-[#6b7280] text-sm">Berber ekibinizi yönetin.</p>
      </div>
      {/* commissionRate Decimal'dir; Client Component'e number olarak gecer.
          Onceden `as any` cast'i vardi ve iki ayri hatayi birden gizliyordu:
          Decimal istemcide SESSIZCE bosaliyordu ve workerType daraltilmiyordu
          (FAZ 2 · Sira 9a). */}
      <BarberManager barbers={barbers.map(sunumaHazirla)} />
    </div>
  );
}

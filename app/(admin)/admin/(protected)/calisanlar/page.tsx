import { db } from "@/lib/db";
import BarberManager from "./BarberManager";

export const metadata = { title: "Çalışanlar — BOSS Admin" };

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
      <BarberManager barbers={barbers as any} />
    </div>
  );
}

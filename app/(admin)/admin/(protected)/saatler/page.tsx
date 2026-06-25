import { db } from "@/lib/db";
import WorkingHoursManager from "./WorkingHoursManager";

export const metadata = { title: "Çalışma Saatleri — BOSS Admin" };

export default async function SaatlerPage() {
  const barbers = await db.barber.findMany({
    where: { isActive: true },
    include: { workingHours: { orderBy: { dayOfWeek: "asc" } } },
  });
  return (
    <div className="p-6 md:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-black">Çalışma Saatleri</h1>
        <p className="text-[#6b7280] text-sm">Her çalışan için gün bazlı çalışma saatlerini ayarlayın.</p>
      </div>
      <WorkingHoursManager barbers={barbers as any} />
    </div>
  );
}

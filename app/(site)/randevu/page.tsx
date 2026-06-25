import { db } from "@/lib/db";
import BookingForm from "./BookingForm";

export const metadata = { title: "Randevu Al — BOSS Erkek Kuaförü" };

export default async function RandevuPage({ searchParams }: { searchParams: Promise<{ berber?: string }> }) {
  const params = await searchParams;
  const [services, barbers] = await Promise.all([
    db.service.findMany({ where: { isActive: true }, orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }] }),
    db.barber.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] py-16 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-10">
          <p className="text-[#c9762c] text-xs font-semibold tracking-[0.4em] uppercase mb-3">Online Rezervasyon</p>
          <h1 className="text-4xl font-black mb-3">Randevu Al</h1>
          <p className="text-[#6b7280] text-sm">Adımları takip ederek randevunuzu oluşturun.</p>
        </div>
        <BookingForm services={services} barbers={barbers} defaultBarberId={params.berber} />
      </div>
    </div>
  );
}

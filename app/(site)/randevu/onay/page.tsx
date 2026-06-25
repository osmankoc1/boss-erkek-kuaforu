import Link from "next/link";
import { db } from "@/lib/db";
import { formatPrice } from "@/lib/utils";
import AnimatedCheckmark from "@/components/site/AnimatedCheckmark";
import CopyButton from "./CopyButton";

export const metadata = { title: "Randevu Alındı — BOSS Erkek Kuaförü" };

export default async function OnayPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  if (!id) return <NotFound />;

  const appt = await db.appointment.findUnique({
    where: { id },
    include: { barber: true, service: true, customer: true, services: true },
  });
  if (!appt) return <NotFound />;

  const initials = appt.barber.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  const isPendingVerification = appt.status === "pending_verification";

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4 py-20">
      <div className="max-w-md w-full">

        {/* Başlık kartı */}
        <div className="relative bg-[#141414] border border-[#2a2a2a] rounded-2xl overflow-hidden mb-4">
          <div
            className="absolute inset-0 opacity-[0.05]"
            style={{ background: "radial-gradient(ellipse at 50% 0%, #c9762c, transparent 65%)" }}
          />
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#c9762c]/50 to-transparent" />

          <div className="relative px-8 py-10 text-center">
            {isPendingVerification ? (
              <>
                <div className="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-5">
                  <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <h1 className="text-2xl font-black text-white mb-2">E-postanızı Doğrulayın</h1>
                <p className="text-[#6b7280] text-sm leading-relaxed">
                  {appt.customer.email
                    ? <>Doğrulama bağlantısı <strong className="text-[#9ca3af]">{appt.customer.email}</strong> adresine gönderildi. Lütfen gelen kutunuzu kontrol edin.</>
                    : "Doğrulama e-postası gönderildi. Lütfen gelen kutunuzu kontrol edin."}
                </p>
                <p className="text-[#4b5563] text-xs mt-3">Link 24 saat geçerlidir. Spam klasörünü de kontrol etmeyi unutmayın.</p>
              </>
            ) : (
              <>
                <AnimatedCheckmark />
                <h1 className="text-2xl font-black text-white mb-2">Randevunuz Alındı!</h1>
                <p className="text-[#6b7280] text-sm leading-relaxed">
                  Randevunuz oluşturuldu. Onay için kısa süre içinde bildirim gönderilecektir.
                </p>
              </>
            )}
          </div>
        </div>

        {/* Detay kartı */}
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl overflow-hidden mb-4">
          {/* Berber satırı */}
          <div className="flex items-center gap-4 px-6 py-5 border-b border-[#1e1e1e]">
            <div className="w-10 h-10 rounded-full bg-[#c9762c]/10 border border-[#c9762c]/20 flex items-center justify-center shrink-0">
              <span className="text-[#c9762c] text-xs font-black">{initials}</span>
            </div>
            <div>
              <p className="text-white font-bold text-sm">{appt.barber.name}</p>
              {appt.barber.specialty && (
                <p className="text-[#c9762c] text-xs mt-0.5">{appt.barber.specialty}</p>
              )}
            </div>
            <div className="ml-auto text-right">
              {isPendingVerification ? (
                <span className="text-[10px] px-2 py-0.5 bg-blue-500/8 border border-blue-500/15 text-blue-400 rounded-full font-semibold">
                  E-posta Bekleniyor
                </span>
              ) : (
                <span className="text-[10px] px-2 py-0.5 bg-yellow-500/8 border border-yellow-500/15 text-yellow-400 rounded-full font-semibold">
                  Onay Bekleniyor
                </span>
              )}
            </div>
          </div>

          {/* Detaylar */}
          <div className="px-6 py-5 space-y-3.5">
            <DetailRow
              icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />}
              label="Hizmet"
              value={appt.services?.length > 0 ? appt.services.map(s => s.serviceName).join(", ") : appt.service?.name ?? "—"}
            />
            <DetailRow
              icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />}
              label="Müşteri"
              value={appt.customer.fullName}
            />
            <DetailRow
              icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />}
              label="Tarih"
              value={new Date(appt.date).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", weekday: "long" })}
            />
            <DetailRow
              icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />}
              label="Saat"
              value={`${appt.startTime} – ${appt.endTime}`}
              accent
            />
          </div>

          {/* Tutar */}
          <div className="mx-6 mb-5 px-4 py-3.5 bg-[#c9762c]/6 border border-[#c9762c]/15 rounded-xl flex items-center justify-between">
            <div>
              <p className="text-[#5a5a5a] text-[10px] uppercase tracking-wider">Hizmet Tutarı</p>
              <p className="text-[#9ca3af] text-xs mt-0.5">{appt.services?.length > 0 ? appt.services.reduce((s, i) => s + i.durationMinutes, 0) : (appt.service?.durationMinutes ?? 0)} dakika</p>
            </div>
            <span className="text-[#c9762c] font-black text-2xl">{formatPrice(appt.appointmentPrice)}</span>
          </div>
        </div>

        {/* Aksiyonlar */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            href="/"
            className="flex-1 py-3 text-center border border-[#2a2a2a] text-[#9ca3af] font-semibold rounded-xl hover:border-[#c9762c]/35 hover:text-white transition-all text-sm"
          >
            Ana Sayfaya Dön
          </Link>
          <Link
            href="/randevu-sorgula"
            className="flex-1 py-3 text-center bg-[#c9762c] text-white font-bold rounded-xl hover:bg-[#e8913a] transition-all hover:shadow-[0_0_20px_rgba(201,118,44,0.3)] text-sm"
          >
            Randevumu Sorgula
          </Link>
        </div>

        {/* Bilgi notu */}
        <p className="text-center text-[#3a3a3a] text-xs mt-6">
          Randevu kodunuz:{" "}
          <span className="text-[#5a5a5a] font-mono">{appt.id.slice(-8).toUpperCase()}</span>
          <CopyButton text={appt.id.slice(-8).toUpperCase()} />
        </p>
      </div>
    </div>
  );
}

function DetailRow({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <svg className="w-4 h-4 shrink-0 text-[#3a3a3a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        {icon}
      </svg>
      <span className="text-[#5a5a5a] text-xs w-16 shrink-0">{label}</span>
      <span className={`text-sm font-semibold ${accent ? "text-[#c9762c]" : "text-white"}`}>{value}</span>
    </div>
  );
}

function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center text-center px-4">
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-10">
        <div className="w-12 h-12 rounded-full bg-[#1e1e1e] flex items-center justify-center mx-auto mb-4">
          <svg className="w-5 h-5 text-[#5a5a5a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-lg font-bold text-white mb-2">Randevu bulunamadı</h1>
        <p className="text-[#6b7280] text-sm mb-5">Bu randevu kodu geçersiz veya süresi dolmuş olabilir.</p>
        <Link href="/randevu" className="inline-block px-6 py-2.5 bg-[#c9762c] text-white text-sm font-bold rounded-lg hover:bg-[#e8913a] transition-colors">
          Yeni Randevu Al
        </Link>
      </div>
    </div>
  );
}

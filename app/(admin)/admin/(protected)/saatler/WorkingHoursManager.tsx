"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getDayName } from "@/lib/utils";

type WorkingHour = { id: string; dayOfWeek: number; startTime: string; endTime: string; isOff: boolean };
type Barber = { id: string; name: string; workingHours: WorkingHour[] };
type DayState = { startTime: string; endTime: string; isOff: boolean };

const DAYS = [1, 2, 3, 4, 5, 6, 0];

export default function WorkingHoursManager({ barbers }: { barbers: Barber[] }) {
  const [selectedBarber, setSelectedBarber] = useState(barbers[0]?.id ?? "");
  const barber = barbers.find((b) => b.id === selectedBarber);

  if (barbers.length === 0) {
    return (
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-10 text-center">
        <p className="text-[#6b7280] mb-4">Çalışma saati ayarlayabilmek için önce en az bir çalışan eklemeniz gerekiyor.</p>
        <Link
          href="/admin/calisanlar"
          className="inline-block px-6 py-2 bg-[#c9762c] hover:bg-[#e8913a] text-white text-sm font-bold rounded-lg transition-colors"
        >
          Çalışanlar Sayfasına Git
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        {barbers.map((b) => (
          <button
            key={b.id}
            onClick={() => setSelectedBarber(b.id)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all border ${
              selectedBarber === b.id
                ? "bg-[#c9762c] border-[#c9762c] text-white"
                : "border-[#2a2a2a] text-[#6b7280] hover:border-[#c9762c]/40"
            }`}
          >
            {b.name}
          </button>
        ))}
      </div>

      {barber && (
        <BarberHoursEditor key={selectedBarber} barber={barber} />
      )}
    </div>
  );
}

function BarberHoursEditor({ barber }: { barber: Barber }) {
  const router = useRouter();
  const [saving, setSaving] = useState<number | "all" | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  const hoursMap = Object.fromEntries(barber.workingHours.map((h) => [h.dayOfWeek, h]));

  const [hours, setHours] = useState<Record<number, DayState>>(() =>
    Object.fromEntries(
      DAYS.map((day) => {
        const h = hoursMap[day];
        return [day, { startTime: h?.startTime ?? "09:00", endTime: h?.endTime ?? "19:00", isOff: h?.isOff ?? false }];
      })
    )
  );

  function showToast(ok: boolean, msg: string) {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 3500);
  }

  async function saveDay(day: number) {
    setSaving(day);
    try {
      const { startTime, endTime, isOff } = hours[day];
      const existing = hoursMap[day];
      const res = existing
        ? await fetch(`/api/working-hours/${existing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ startTime, endTime, isOff }),
          })
        : await fetch("/api/working-hours", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ barberId: barber.id, dayOfWeek: day, startTime, endTime, isOff }),
          });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(false, data.error ?? `Kayıt başarısız (${res.status}).`);
      } else {
        showToast(true, `${getDayName(day)} saatleri kaydedildi.`);
        router.refresh();
      }
    } catch {
      showToast(false, "Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setSaving(null);
    }
  }

  async function saveAll() {
    setSaving("all");
    let successCount = 0;
    let failCount = 0;

    for (const day of DAYS) {
      try {
        const { startTime, endTime, isOff } = hours[day];
        const existing = hoursMap[day];
        const res = existing
          ? await fetch(`/api/working-hours/${existing.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ startTime, endTime, isOff }),
            })
          : await fetch("/api/working-hours", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ barberId: barber.id, dayOfWeek: day, startTime, endTime, isOff }),
            });
        if (res.ok) successCount++;
        else failCount++;
      } catch {
        failCount++;
      }
    }

    setSaving(null);
    if (failCount === 0) {
      showToast(true, `Tüm ${successCount} gün başarıyla kaydedildi.`);
    } else {
      showToast(false, `${successCount} gün kaydedildi, ${failCount} günde hata oluştu.`);
    }
    router.refresh();
  }

  const unsavedCount = DAYS.filter((d) => !hoursMap[d]).length;

  return (
    <div className="space-y-3">
      {toast && (
        <div className={`px-4 py-3 rounded-lg text-sm font-medium ${
          toast.ok
            ? "bg-green-500/10 border border-green-500/30 text-green-400"
            : "bg-red-500/10 border border-red-500/30 text-red-400"
        }`}>
          {toast.msg}
        </div>
      )}

      {unsavedCount > 0 && (
        <div className="flex items-start gap-3 px-4 py-3 bg-amber-500/8 border border-amber-500/25 rounded-lg">
          <svg className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3m0 3h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-amber-400 text-xs font-semibold">
              {unsavedCount} gün henüz kaydedilmemiş
            </p>
            <p className="text-amber-400/70 text-xs mt-0.5">
              Turuncu işaretli günler veritabanında yok. Kaydet butonuna basın veya "Tüm Haftayı Kaydet" kullanın.
            </p>
          </div>
          <button
            onClick={saveAll}
            disabled={saving !== null}
            className="shrink-0 px-4 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-400 text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
          >
            {saving === "all" ? "Kaydediliyor..." : "Tüm Haftayı Kaydet"}
          </button>
        </div>
      )}

      {unsavedCount === 0 && (
        <div className="flex justify-end">
          <button
            onClick={saveAll}
            disabled={saving !== null}
            className="px-5 py-2 bg-[#1e1e1e] hover:bg-[#2a2a2a] border border-[#2a2a2a] hover:border-[#c9762c]/40 text-[#9ca3af] hover:text-white text-xs font-semibold rounded-lg transition-all disabled:opacity-50"
          >
            {saving === "all" ? "Kaydediliyor..." : "Tüm Haftayı Kaydet"}
          </button>
        </div>
      )}

      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#2a2a2a]">
              <th className="text-left px-4 py-3 text-[#6b7280] text-xs uppercase">Gün</th>
              <th className="text-left px-4 py-3 text-[#6b7280] text-xs uppercase">Açılış</th>
              <th className="text-left px-4 py-3 text-[#6b7280] text-xs uppercase">Kapanış</th>
              <th className="text-left px-4 py-3 text-[#6b7280] text-xs uppercase">Kapalı</th>
              <th className="text-left px-4 py-3 text-[#6b7280] text-xs uppercase">Kaydet</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2a2a2a]">
            {DAYS.map((day) => {
              const isUnsaved = !hoursMap[day];
              const state = hours[day];
              const isSavingThis = saving === day || saving === "all";
              return (
                <tr
                  key={day}
                  className={`hover:bg-[#1a1a1a] transition-colors ${
                    isUnsaved ? "border-l-2 border-amber-500/50" : ""
                  }`}
                >
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      <span className={isUnsaved ? "text-amber-300/80" : "text-white"}>
                        {getDayName(day)}
                      </span>
                      {isUnsaved && (
                        <span className="px-1.5 py-0.5 bg-amber-500/15 border border-amber-500/25 text-amber-400 text-[10px] rounded font-semibold leading-none">
                          Kaydedilmedi
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="time"
                      value={state.startTime}
                      onChange={(e) => setHours({ ...hours, [day]: { ...state, startTime: e.target.value } })}
                      disabled={state.isOff || isSavingThis}
                      className="bg-[#1e1e1e] border border-[#2a2a2a] rounded px-2 py-1 text-white text-sm outline-none disabled:opacity-40 focus:border-[#c9762c]/50"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="time"
                      value={state.endTime}
                      onChange={(e) => setHours({ ...hours, [day]: { ...state, endTime: e.target.value } })}
                      disabled={state.isOff || isSavingThis}
                      className="bg-[#1e1e1e] border border-[#2a2a2a] rounded px-2 py-1 text-white text-sm outline-none disabled:opacity-40 focus:border-[#c9762c]/50"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={state.isOff}
                      onChange={(e) => setHours({ ...hours, [day]: { ...state, isOff: e.target.checked } })}
                      disabled={isSavingThis}
                      className="w-4 h-4 accent-[#c9762c] disabled:opacity-40"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => saveDay(day)}
                      disabled={saving !== null}
                      className="px-3 py-1 bg-[#c9762c] text-white text-xs font-semibold rounded disabled:opacity-50 hover:bg-[#e8913a] transition-colors"
                    >
                      {saving === day ? "..." : "Kaydet"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

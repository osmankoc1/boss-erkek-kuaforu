"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { getDayName } from "@/lib/utils";

type WorkingHour = { id: string; dayOfWeek: number; startTime: string; endTime: string; isOff: boolean };
type Barber = { id: string; name: string; workingHours: WorkingHour[] };

const DAYS = [1, 2, 3, 4, 5, 6, 0];

export default function WorkingHoursManager({ barbers }: { barbers: Barber[] }) {
  const router = useRouter();
  const [selectedBarber, setSelectedBarber] = useState(barbers[0]?.id ?? "");
  const [saving, setSaving] = useState(false);

  const barber = barbers.find((b) => b.id === selectedBarber);
  const hoursMap = Object.fromEntries((barber?.workingHours ?? []).map((h) => [h.dayOfWeek, h]));

  async function saveHour(day: number, startTime: string, endTime: string, isOff: boolean) {
    setSaving(true);
    const existing = hoursMap[day];
    if (existing) {
      await fetch(`/api/working-hours/${existing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startTime, endTime, isOff }),
      });
    } else {
      await fetch("/api/working-hours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barberId: selectedBarber, dayOfWeek: day, startTime, endTime, isOff }),
      });
    }
    router.refresh();
    setSaving(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        {barbers.map((b) => (
          <button
            key={b.id}
            onClick={() => setSelectedBarber(b.id)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all border ${selectedBarber === b.id ? "bg-[#c9762c] border-[#c9762c] text-white" : "border-[#2a2a2a] text-[#6b7280] hover:border-[#c9762c]/40"}`}
          >
            {b.name}
          </button>
        ))}
      </div>

      {barber && (
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
              {DAYS.map((day) => (
                <DayRow key={day} day={day} hour={hoursMap[day] ?? null} onSave={saveHour} saving={saving} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DayRow({ day, hour, onSave, saving }: {
  day: number;
  hour: WorkingHour | null;
  onSave: (d: number, s: string, e: string, off: boolean) => void;
  saving: boolean;
}) {
  const [start, setStart] = useState(hour?.startTime ?? "09:00");
  const [end, setEnd] = useState(hour?.endTime ?? "19:00");
  const [isOff, setIsOff] = useState(hour?.isOff ?? false);

  return (
    <tr className="hover:bg-[#1e1e1e]">
      <td className="px-4 py-3 font-medium">{getDayName(day)}</td>
      <td className="px-4 py-3">
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)} disabled={isOff}
          className="bg-[#1e1e1e] border border-[#2a2a2a] rounded px-2 py-1 text-white text-sm outline-none disabled:opacity-40" />
      </td>
      <td className="px-4 py-3">
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} disabled={isOff}
          className="bg-[#1e1e1e] border border-[#2a2a2a] rounded px-2 py-1 text-white text-sm outline-none disabled:opacity-40" />
      </td>
      <td className="px-4 py-3">
        <input type="checkbox" checked={isOff} onChange={(e) => setIsOff(e.target.checked)} className="w-4 h-4 accent-[#c9762c]" />
      </td>
      <td className="px-4 py-3">
        <button onClick={() => onSave(day, start, end, isOff)} disabled={saving}
          className="px-3 py-1 bg-[#c9762c] text-white text-xs font-semibold rounded disabled:opacity-50 hover:bg-[#e8913a] transition-colors">
          Kaydet
        </button>
      </td>
    </tr>
  );
}

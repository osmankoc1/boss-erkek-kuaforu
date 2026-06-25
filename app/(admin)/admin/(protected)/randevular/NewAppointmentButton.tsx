"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import AdminAppointmentModal from "./AdminAppointmentModal";

import type { PickerService } from "@/components/admin/ServicePicker";
type Barber = { id: string; name: string; calendarColor: string };

export default function NewAppointmentButton({
  barbers,
  services,
  defaultDate,
}: {
  barbers: Barber[];
  services: PickerService[];
  defaultDate?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 bg-[#c9762c] hover:bg-[#e8913a] text-white text-sm font-bold rounded-lg transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Yeni Randevu
      </button>

      {open && (
        <AdminAppointmentModal
          barbers={barbers}
          services={services}
          defaultDate={defaultDate}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

"use client";
import { useState } from "react";

export type AuditRow = {
  id: string;
  entity: string;
  entityId: string;
  action: string;
  source: string;
  userEmail: string | null;
  changes: Record<string, { before: unknown; after: unknown }> | null;
  createdAt: string;
};

const ENTITY_LABELS: Record<string, string> = {
  Sale: "Satış",
  CustomerPayment: "Tahsilat",
  BarberPayout: "Hakediş Ödemesi",
  Expense: "Gider",
  Customer: "Müşteri",
  Appointment: "Randevu",
  Setting: "Ayar",
};

const ACTION_STYLE: Record<string, string> = {
  CREATE: "text-emerald-400 border-emerald-400/30 bg-emerald-400/8",
  UPDATE: "text-sky-400 border-sky-400/30 bg-sky-400/8",
  VOID: "text-red-400 border-red-400/30 bg-red-400/8",
  DELETE: "text-red-400 border-red-400/30 bg-red-400/8",
  MERGE: "text-purple-400 border-purple-400/30 bg-purple-400/8",
  STATUS_CHANGE: "text-yellow-400 border-yellow-400/30 bg-yellow-400/8",
};

const ACTION_LABELS: Record<string, string> = {
  CREATE: "Oluşturma",
  UPDATE: "Düzenleme",
  VOID: "İptal (Void)",
  DELETE: "Silme",
  MERGE: "Birleştirme",
  STATUS_CHANGE: "Durum Değişikliği",
};

const SOURCE_STYLE: Record<string, string> = {
  ADMIN: "text-[#c9762c] border-[#c9762c]/30 bg-[#c9762c]/8",
  PUBLIC: "text-sky-400 border-sky-400/30 bg-sky-400/8",
  SYSTEM: "text-[#9ca3af] border-[#3a3a3a] bg-[#1a1a1a]",
};

const SOURCE_LABELS: Record<string, string> = {
  ADMIN: "Yönetici",
  PUBLIC: "Müşteri",
  SYSTEM: "Sistem",
};

/** Alan adlarının okunabilir karşılığı. */
const FIELD_LABELS: Record<string, string> = {
  saleAmount: "Satış tutarı",
  paidAmount: "Tahsil edilen",
  remainingAmount: "Kalan",
  listedPrice: "Liste fiyatı",
  saleStatus: "Satış durumu",
  paymentMethod: "Ödeme yöntemi",
  barberShare: "Hakediş",
  businessShare: "İşletme payı",
  amount: "Tutar",
  status: "Durum",
  value: "Değer",
  note: "Not",
  voidReason: "İptal gerekçesi",
  category: "Kategori",
  description: "Açıklama",
  mergedIntoCustomerId: "Birleştirildiği müşteri",
  fullName: "Ad soyad",
  phone: "Telefon",
};

const goster = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

const tarih = (iso: string) =>
  new Date(iso).toLocaleString("tr-TR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

export default function AuditTable({ logs }: { logs: AuditRow[] }) {
  const [acik, setAcik] = useState<string | null>(null);

  if (logs.length === 0) {
    return (
      <div className="bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl p-12 text-center">
        <p className="text-[#6b7280] text-sm">Bu filtrelerle eşleşen denetim kaydı yok.</p>
      </div>
    );
  }

  return (
    <div className="bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#1a1a1a]">
              {["Tarih / Saat", "Kaynak", "Aktör", "İşlem", "Varlık", "İlgili Kayıt", "Değişiklik Özeti"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => {
              const alanlar = l.changes ? Object.entries(l.changes) : [];
              const genisletilebilir = alanlar.length > 2;
              const gosterilecek = acik === l.id ? alanlar : alanlar.slice(0, 2);
              return (
                <tr key={l.id} className="border-b border-[#111] hover:bg-[#111] transition-colors align-top">
                  <td className="px-4 py-3 text-[12px] text-white whitespace-nowrap">{tarih(l.createdAt)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`text-[11px] px-2 py-0.5 rounded border ${SOURCE_STYLE[l.source] ?? "text-[#9ca3af] border-[#2a2a2a]"}`}>
                      {SOURCE_LABELS[l.source] ?? l.source}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-[#9ca3af] whitespace-nowrap">{l.userEmail ?? "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`text-[11px] px-2 py-0.5 rounded border ${ACTION_STYLE[l.action] ?? "text-[#9ca3af] border-[#2a2a2a]"}`}>
                      {ACTION_LABELS[l.action] ?? l.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-white whitespace-nowrap">{ENTITY_LABELS[l.entity] ?? l.entity}</td>
                  <td className="px-4 py-3 text-[11px] text-[#6b7280] font-mono whitespace-nowrap" title={l.entityId}>
                    {l.entityId.length > 14 ? `${l.entityId.slice(0, 14)}…` : l.entityId}
                  </td>
                  <td className="px-4 py-3 text-[12px]">
                    {alanlar.length === 0 ? (
                      <span className="text-[#6b7280]">—</span>
                    ) : (
                      <div className="space-y-0.5">
                        {gosterilecek.map(([alan, d]) => (
                          <div key={alan} className="whitespace-nowrap">
                            <span className="text-[#6b7280]">{FIELD_LABELS[alan] ?? alan}: </span>
                            <span className="text-[#9ca3af] line-through">{goster(d.before)}</span>
                            <span className="text-[#6b7280]"> → </span>
                            <span className="text-white font-medium">{goster(d.after)}</span>
                          </div>
                        ))}
                        {genisletilebilir && (
                          <button
                            onClick={() => setAcik(acik === l.id ? null : l.id)}
                            className="text-[11px] text-[#c9762c] hover:text-[#e8913a] transition-colors">
                            {acik === l.id ? "daha az" : `+${alanlar.length - 2} alan daha`}
                          </button>
                        )}
                      </div>
                    )}
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

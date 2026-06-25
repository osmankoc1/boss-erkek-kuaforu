"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend,
} from "recharts";
import { formatPrice } from "@/lib/utils";

type CategoryStat = { category: string; count: number; revenue: number };
type ServiceStat  = { serviceId: string | null; serviceName: string; category: string; count: number; revenue: number; avgPrice: number; lastUsed: string };
type DayPoint     = { date: string; revenue: number; count: number };
type BarberStat   = { barberName: string; count: number; revenue: number };
type Summary      = { totalRevenue: number; totalCount: number; uniqueSales: number; avgTicket: number };

type Props = {
  range: string;
  from?: string;
  to?: string;
  summary: Summary;
  categoryRevenue: CategoryStat[];
  topServices: ServiceStat[];
  dailySeries: DayPoint[];
  barberStats: BarberStat[];
};

const RANGES = [
  { key: "7d",    label: "Son 7 Gün" },
  { key: "30d",   label: "Son 30 Gün" },
  { key: "month", label: "Bu Ay" },
  { key: "custom",label: "Özel" },
];

const PIE_COLORS = ["#c9762c", "#3b82f6", "#8b5cf6", "#10b981", "#ec4899", "#6b7280"];

function fmtDate(iso: string) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
}

export default function HizmetAnalitikClient(props: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [range, setRange] = useState(props.range);
  const [from, setFrom] = useState(props.from ?? "");
  const [to, setTo]     = useState(props.to ?? "");

  function applyFilter(r: string, f?: string, t?: string) {
    const params = new URLSearchParams({ range: r });
    if (r === "custom" && f && t) { params.set("from", f); params.set("to", t); }
    startTransition(() => router.push(`/admin/hizmet-analitik?${params.toString()}`));
  }

  const { summary, categoryRevenue, topServices, dailySeries, barberStats } = props;

  return (
    <div className="space-y-6">
      {/* ── Filtre ── */}
      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <button key={r.key} onClick={() => { setRange(r.key); if (r.key !== "custom") applyFilter(r.key); }}
            className={`px-3 py-1.5 text-[12px] font-medium rounded-md border transition-all ${
              range === r.key
                ? "bg-[#c9762c]/15 border-[#c9762c]/40 text-[#c9762c]"
                : "bg-[#1a1a1a] border-[#2a2a2a] text-[#9ca3af] hover:text-white hover:border-[#3a3a3a]"
            }`}>
            {r.label}
          </button>
        ))}
        {range === "custom" && (
          <div className="flex items-center gap-2 ml-1">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-2 py-1 text-[12px] text-white focus:outline-none focus:border-[#c9762c]/50" />
            <span className="text-[#6b7280] text-xs">—</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-2 py-1 text-[12px] text-white focus:outline-none focus:border-[#c9762c]/50" />
            <button onClick={() => applyFilter("custom", from, to)}
              disabled={!from || !to}
              className="px-3 py-1 bg-[#c9762c] hover:bg-[#e8913a] text-white text-[12px] font-medium rounded-md disabled:opacity-40 transition-all">
              Uygula
            </button>
          </div>
        )}
      </div>

      {/* ── Özet kartlar ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Toplam Ciro",    value: formatPrice(summary.totalRevenue),         color: "text-[#c9762c]" },
          { label: "Hizmet Adedi",   value: String(summary.totalCount),                 color: "text-white" },
          { label: "Satış Sayısı",   value: String(summary.uniqueSales),                color: "text-blue-400" },
          { label: "Ort. Sepet",     value: formatPrice(summary.avgTicket),             color: "text-green-400" },
        ].map((c) => (
          <div key={c.label} className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
            <p className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1">{c.label}</p>
            <p className={`text-xl font-black ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Günlük gelir çizgisi ── */}
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-5">
          <h3 className="text-sm font-bold text-white mb-4">Günlük Gelir</h3>
          {dailySeries.length === 0 ? (
            <p className="text-center py-8 text-[#6b7280] text-sm">Veri yok.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={dailySeries} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" />
                <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} width={50}
                  tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : String(v)} />
                <Tooltip
                  contentStyle={{ background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 8, fontSize: 12 }}
                  labelFormatter={(l) => new Date(String(l)).toLocaleDateString("tr-TR")}
                  formatter={(v) => [formatPrice(Number(v)), "Gelir"]} />
                <Line type="monotone" dataKey="revenue" stroke="#c9762c" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* ── Kategori pasta ── */}
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-5">
          <h3 className="text-sm font-bold text-white mb-4">Kategori Dağılımı</h3>
          {categoryRevenue.length === 0 ? (
            <p className="text-center py-8 text-[#6b7280] text-sm">Veri yok.</p>
          ) : (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="55%" height={180}>
                <PieChart>
                  <Pie data={categoryRevenue} dataKey="revenue" cx="50%" cy="50%" outerRadius={75} innerRadius={45}>
                    {categoryRevenue.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 8, fontSize: 12 }}
                    formatter={(v, _name, entry) => [formatPrice(Number(v)), (entry as { payload: CategoryStat }).payload.category]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2 min-w-0">
                {categoryRevenue.map((c, i) => (
                  <div key={c.category} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="text-[12px] text-[#9ca3af] truncate">{c.category}</span>
                    </div>
                    <span className="text-[12px] font-semibold text-white shrink-0">{formatPrice(c.revenue)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Çalışan bazlı ciro ── */}
      {barberStats.length > 0 && (
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-5">
          <h3 className="text-sm font-bold text-white mb-4">Çalışan Bazlı Hizmet Cirosu</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={barberStats} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" vertical={false} />
              <XAxis dataKey="barberName" tick={{ fill: "#9ca3af", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} width={50}
                tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : String(v)} />
              <Tooltip
                contentStyle={{ background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 8, fontSize: 12 }}
                formatter={(v) => [formatPrice(Number(v)), "Ciro"]} />
              <Bar dataKey="revenue" fill="#c9762c" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── En çok satılan hizmetler tablosu ── */}
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#2a2a2a]">
          <h3 className="text-sm font-bold text-white">Hizmet Performansı</h3>
        </div>
        {topServices.length === 0 ? (
          <p className="text-center py-8 text-[#6b7280] text-sm">Veri yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#2a2a2a]">
                  {["Hizmet", "Kategori", "Satış", "Toplam Ciro", "Ort. Fiyat", "Son Kullanım"].map((h) => (
                    <th key={h} className="text-left px-5 py-3 text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topServices.map((s, i) => (
                  <tr key={i} className="border-b border-[#1e1e1e] hover:bg-[#1a1a1a] transition-colors">
                    <td className="px-5 py-3 font-medium text-white">{s.serviceName}</td>
                    <td className="px-5 py-3">
                      <span className="text-xs px-2 py-0.5 rounded border text-[#9ca3af] border-[#2a2a2a]">{s.category}</span>
                    </td>
                    <td className="px-5 py-3 font-semibold text-white">{s.count}</td>
                    <td className="px-5 py-3 font-semibold text-green-400">{formatPrice(s.revenue)}</td>
                    <td className="px-5 py-3 text-[#c9762c] font-semibold">{formatPrice(s.avgPrice)}</td>
                    <td className="px-5 py-3 text-[#9ca3af] text-xs">
                      {s.lastUsed ? new Date(s.lastUsed).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

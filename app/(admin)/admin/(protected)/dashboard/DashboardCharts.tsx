"use client";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

const TOOLTIP_STYLE = {
  contentStyle: { background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 8, color: "#fff", fontSize: 12 },
  labelStyle: { color: "#9ca3af" },
  cursor: { fill: "rgba(201,118,44,0.05)" },
};

export function AppointmentAreaChart({ data }: { data: { date: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#c9762c" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#c9762c" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" tick={{ fill: "#5a5a5a", fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fill: "#5a5a5a", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} width={24} />
        <Tooltip {...TOOLTIP_STYLE} />
        <Area type="monotone" dataKey="count" stroke="#c9762c" strokeWidth={1.5} fill="url(#areaGrad)" name="Randevu" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function HoursBarChart({ data }: { data: { hour: string; count: number }[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} barSize={14}>
        <XAxis dataKey="hour" tick={{ fill: "#5a5a5a", fontSize: 10 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fill: "#5a5a5a", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} width={24} />
        <Tooltip {...TOOLTIP_STYLE} />
        <Bar dataKey="count" name="Randevu" radius={[3, 3, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.count === max ? "#c9762c" : "#2a2a2a"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DaysBarChart({ data }: { data: { day: string; count: number }[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={data} barSize={20}>
        <XAxis dataKey="day" tick={{ fill: "#5a5a5a", fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis hide allowDecimals={false} />
        <Tooltip {...TOOLTIP_STYLE} />
        <Bar dataKey="count" name="Randevu" radius={[3, 3, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.count === max ? "#c9762c" : "#2a2a2a"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Legacy default export — dashboard page uses named exports now
export default AppointmentAreaChart;

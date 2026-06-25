import Link from "next/link";
import { db } from "@/lib/db";
import { formatDate, TAG_LABELS } from "@/lib/utils";

export const metadata = { title: "Müşteriler — BOSS Admin" };

export default async function MusterilerPage({ searchParams }: { searchParams: Promise<{ q?: string; tag?: string }> }) {
  const params = await searchParams;
  const search = params.q ?? "";
  const tag = params.tag ?? "";

  const customers = await db.customer.findMany({
    where: {
      mergedIntoCustomerId: null,
      ...(search ? { OR: [{ fullName: { contains: search, mode: "insensitive" } }, { phone: { contains: search, mode: "insensitive" } }] } : {}),
      ...(tag ? { tag } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const tagColors: Record<string, string> = {
    normal: "text-[#6b7280] border-[#2a2a2a]",
    düzenli: "text-blue-400 border-blue-500/20 bg-blue-500/5",
    VIP: "text-[#c9762c] border-[#c9762c]/30 bg-[#c9762c]/5",
    sorunlu: "text-red-400 border-red-500/20 bg-red-500/5",
  };

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black">Müşteriler</h1>
          <p className="text-[#6b7280] text-sm">{customers.length} müşteri</p>
        </div>
      </div>

      {/* Filtreler */}
      <form className="flex flex-wrap gap-3 mb-6">
        <input
          name="q"
          defaultValue={search}
          placeholder="İsim veya telefon ara..."
          className="bg-[#141414] border border-[#2a2a2a] focus:border-[#c9762c] rounded-lg px-4 py-2 text-white outline-none text-sm"
        />
        <select name="tag" defaultValue={tag} className="bg-[#141414] border border-[#2a2a2a] rounded-lg px-4 py-2 text-[#9ca3af] outline-none text-sm">
          <option value="">Tüm Etiketler</option>
          {Object.entries(TAG_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button type="submit" className="px-4 py-2 bg-[#c9762c] text-white text-sm font-semibold rounded-lg">Filtrele</button>
      </form>

      {customers.length === 0 ? (
        <div className="text-center py-20 text-[#6b7280]">Müşteri bulunamadı.</div>
      ) : (
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a2a2a]">
                {["Müşteri", "Telefon", "Etiket", "Toplam", "Son Ziyaret", ""].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-[#6b7280] text-xs font-semibold uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2a2a2a]">
              {customers.map((c) => (
                <tr key={c.id} className="hover:bg-[#1e1e1e] transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-semibold">{c.fullName}</div>
                    {c.email && <div className="text-[#6b7280] text-xs">{c.email}</div>}
                  </td>
                  <td className="px-4 py-3 text-[#9ca3af]">{c.phone}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded border text-xs font-semibold ${tagColors[c.tag] ?? ""}`}>
                      {TAG_LABELS[c.tag] ?? c.tag}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#9ca3af]">{c.totalAppointments}</td>
                  <td className="px-4 py-3 text-[#6b7280] text-xs">{c.lastVisitAt ? formatDate(c.lastVisitAt) : "—"}</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/musteriler/${c.id}`} className="text-xs text-[#c9762c] hover:underline">Detay</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

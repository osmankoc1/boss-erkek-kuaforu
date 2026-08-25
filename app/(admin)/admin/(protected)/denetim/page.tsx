import { db } from "@/lib/db";
import { AUDIT_ACTIONS, AUDIT_ENTITIES, AUDIT_SOURCES } from "@/lib/audit";
import { startOfDay, endOfDay } from "@/lib/sale";
import { istanbulDateString } from "@/lib/tz";
import AuditTable, { type AuditRow } from "./AuditTable";

export const metadata = { title: "Denetim Geçmişi — BOSS Admin" };

/**
 * Denetim Geçmişi ekranı (FAZ 2 · Sıra 10b).
 *
 * Yalnızca admin erişebilir — `(protected)` layout'u oturum kontrolünü yapar.
 * Ekran SALT OKUMADIR: denetim izini silen ya da düzenleyen hiçbir eylem
 * sunulmaz; aksi hâlde denetim izi olmazdı.
 */

type SearchParams = Promise<{
  entity?: string;
  action?: string;
  source?: string;
  from?: string;
  to?: string;
}>;

/** Tek sayfada gösterilecek azami kayıt. */
const LIMIT = 100;

export default async function DenetimPage({ searchParams }: { searchParams: SearchParams }) {
  const p = await searchParams;

  // Filtreler yalnızca TANINAN değerleri kabul eder; serbest metin geçmez.
  const entity = AUDIT_ENTITIES.includes(p.entity as never) ? p.entity : undefined;
  const action = AUDIT_ACTIONS.includes(p.action as never) ? p.action : undefined;
  const source = AUDIT_SOURCES.includes(p.source as never) ? p.source : undefined;

  const where: Record<string, unknown> = {};
  if (entity) where.entity = entity;
  if (action) where.action = action;
  if (source) where.source = source;
  if (p.from || p.to) {
    const aralik: Record<string, Date> = {};
    if (p.from) aralik.gte = startOfDay(p.from);
    if (p.to) aralik.lte = endOfDay(p.to);
    where.createdAt = aralik;
  }

  const [rows, toplam] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: LIMIT }),
    db.auditLog.count({ where }),
  ]);

  const logs: AuditRow[] = rows.map((l) => ({
    id: l.id,
    entity: l.entity,
    entityId: l.entityId,
    action: l.action,
    source: l.source,
    userEmail: l.userEmail,
    changes: (l.changes ?? null) as AuditRow["changes"],
    createdAt: l.createdAt.toISOString(),
  }));

  const bugun = istanbulDateString();

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-white tracking-tight">Denetim Geçmişi</h1>
        <p className="text-[#9ca3af] text-sm mt-1">
          Para hareketleri ve kritik işlemlerin kim tarafından, ne zaman, neyi neye çevirerek
          yapıldığının kaydı. Bu kayıtlar silinemez ve düzenlenemez.
        </p>
      </div>

      {/* Filtreler */}
      <form method="GET" className="flex items-end gap-3 flex-wrap mb-6 bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl p-4">
        <div>
          <label className="block text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1.5">Varlık</label>
          <select name="entity" defaultValue={entity ?? ""}
            className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#c9762c]/50">
            <option value="">Tümü</option>
            {AUDIT_ENTITIES.map((e) => <option key={e} value={e}>{ENTITY_LABELS[e] ?? e}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1.5">İşlem</label>
          <select name="action" defaultValue={action ?? ""}
            className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#c9762c]/50">
            <option value="">Tümü</option>
            {AUDIT_ACTIONS.map((a) => <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1.5">Kaynak</label>
          <select name="source" defaultValue={source ?? ""}
            className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#c9762c]/50">
            <option value="">Tümü</option>
            {AUDIT_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s] ?? s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1.5">Başlangıç</label>
          <input type="date" name="from" defaultValue={p.from ?? ""} max={bugun}
            className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#c9762c]/50" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1.5">Bitiş</label>
          <input type="date" name="to" defaultValue={p.to ?? ""} max={bugun}
            className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#c9762c]/50" />
        </div>
        <button type="submit"
          className="px-4 py-2 bg-[#c9762c] hover:bg-[#e8913a] rounded-md text-[13px] font-bold text-white transition-all">
          Filtrele
        </button>
        <a href="/admin/denetim"
          className="px-4 py-2 border border-[#2a2a2a] rounded-md text-[13px] text-[#9ca3af] hover:text-white hover:border-[#3a3a3a] transition-all">
          Temizle
        </a>
      </form>

      <p className="text-[12px] text-[#6b7280] mb-3">
        {toplam} kayıt{toplam > LIMIT ? ` — en yeni ${LIMIT} tanesi gösteriliyor` : ""}
      </p>

      <AuditTable logs={logs} />
    </div>
  );
}

const ENTITY_LABELS: Record<string, string> = {
  Sale: "Satış",
  CustomerPayment: "Tahsilat",
  BarberPayout: "Hakediş Ödemesi",
  Expense: "Gider",
  Customer: "Müşteri",
  Appointment: "Randevu",
  Setting: "Ayar",
};

const ACTION_LABELS: Record<string, string> = {
  CREATE: "Oluşturma",
  UPDATE: "Düzenleme",
  VOID: "İptal (Void)",
  DELETE: "Silme",
  MERGE: "Birleştirme",
  STATUS_CHANGE: "Durum Değişikliği",
};

const SOURCE_LABELS: Record<string, string> = {
  ADMIN: "Yönetici",
  PUBLIC: "Müşteri",
  SYSTEM: "Sistem",
};

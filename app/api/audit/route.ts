import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/dal";
import { AUDIT_ACTIONS, AUDIT_ENTITIES, AUDIT_SOURCES } from "@/lib/audit";
import { startOfDay, endOfDay } from "@/lib/sale";

/**
 * Denetim geçmişi — SALT OKUMA, yalnızca admin (FAZ 2 · Sıra 10b).
 *
 * Bu uç nokta denetim izini yalnızca OKUR. Silme/düzenleme uçları bilinçli
 * olarak yoktur: saklama süresi sınırsızdır ve denetim izi değiştirilebilir
 * olsaydı denetim izi olmazdı.
 */

/** Tek sayfada dönen azami kayıt. */
const SAYFA_BOYUTU = 100;

export async function GET(req: NextRequest) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const { searchParams } = req.nextUrl;
  const entity = searchParams.get("entity");
  const action = searchParams.get("action");
  const source = searchParams.get("source");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const entityId = searchParams.get("entityId");
  const cursor = searchParams.get("cursor");

  const where: Record<string, unknown> = {};

  // Filtreler yalnızca TANINAN değerleri kabul eder; serbest metin geçmez.
  if (entity && (AUDIT_ENTITIES as readonly string[]).includes(entity)) where.entity = entity;
  if (action && (AUDIT_ACTIONS as readonly string[]).includes(action)) where.action = action;
  if (source && (AUDIT_SOURCES as readonly string[]).includes(source)) where.source = source;
  if (entityId) where.entityId = entityId;

  // Tarih sınırları Europe/Istanbul takvimine göre (bkz. lib/tz.ts).
  if (from || to) {
    const aralik: Record<string, Date> = {};
    if (from) aralik.gte = startOfDay(from);
    if (to) aralik.lte = endOfDay(to);
    where.createdAt = aralik;
  }

  const rows = await db.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: SAYFA_BOYUTU + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const devamVar = rows.length > SAYFA_BOYUTU;
  const sayfa = devamVar ? rows.slice(0, SAYFA_BOYUTU) : rows;

  return Response.json({
    logs: sayfa.map((l) => ({
      id: l.id,
      entity: l.entity,
      entityId: l.entityId,
      action: l.action,
      source: l.source,
      userId: l.userId,
      userEmail: l.userEmail,
      changes: l.changes,
      createdAt: l.createdAt.toISOString(),
    })),
    nextCursor: devamVar ? sayfa[sayfa.length - 1]?.id : null,
    filters: {
      entities: AUDIT_ENTITIES,
      actions: AUDIT_ACTIONS,
      sources: AUDIT_SOURCES,
    },
  });
}

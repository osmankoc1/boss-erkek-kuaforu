import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

async function requireAdmin() {
  const session = await getSession();
  return session?.userId ?? null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAdmin();
  if (!userId) return Response.json({ error: "Yetkisiz." }, { status: 401 });

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Geçersiz JSON." }, { status: 400 });
  }

  // Whitelist — sadece izin verilen alanları al
  const data: Record<string, unknown> = {};
  if (body.name !== undefined)            data.name            = String(body.name);
  if (body.description !== undefined)     data.description     = body.description ? String(body.description) : null;
  if (body.durationMinutes !== undefined) data.durationMinutes = Number(body.durationMinutes) || 30;
  if (body.price !== undefined)           data.price           = Number(body.price) || 0;
  if (body.category !== undefined)        data.category        = String(body.category);
  if (body.displayOrder !== undefined)    data.displayOrder    = Number(body.displayOrder);
  if (body.isActive !== undefined)        data.isActive        = Boolean(body.isActive);

  if (Object.keys(data).length === 0) {
    return Response.json({ error: "Güncellenecek alan yok." }, { status: 400 });
  }

  try {
    const service = await db.service.update({ where: { id }, data });
    return Response.json({ service });
  } catch (err) {
    console.error("Service PATCH error:", err);
    return Response.json({ error: "Güncelleme başarısız." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAdmin();
  if (!userId) return Response.json({ error: "Yetkisiz." }, { status: 401 });

  const { id } = await params;

  try {
    await db.service.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (err) {
    console.error("Service DELETE error:", err);
    return Response.json({ error: "Silme başarısız." }, { status: 500 });
  }
}

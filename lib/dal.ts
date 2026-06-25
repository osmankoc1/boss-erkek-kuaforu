import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getSession } from "./session";
import { db } from "./db";

export const verifySession = cache(async () => {
  const session = await getSession();
  if (!session?.userId) redirect("/admin/login");
  return session;
});

export const getAdminUser = cache(async () => {
  const session = await getSession();
  if (!session?.userId) return null;
  return db.user.findUnique({ where: { id: session.userId }, select: { id: true, name: true, email: true } });
});

/**
 * For API route handlers (not pages). Returns a 401 Response if there is no
 * admin session, or null if the caller is authenticated and may proceed.
 */
export async function requireAdmin() {
  const session = await getSession();
  if (!session?.userId) {
    return Response.json({ error: "Yetkisiz." }, { status: 401 });
  }
  return null;
}

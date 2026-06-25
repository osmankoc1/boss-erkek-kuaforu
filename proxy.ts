import { NextRequest, NextResponse } from "next/server";
import { decrypt } from "@/lib/session";

const adminRoutes = ["/admin/dashboard", "/admin/randevular", "/admin/musteriler", "/admin/kampanyalar", "/admin/calisanlar", "/admin/hizmetler", "/admin/saatler", "/admin/ayarlar"];

export default async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isAdminRoute = adminRoutes.some((r) => path.startsWith(r));

  if (!isAdminRoute) return NextResponse.next();

  const cookie = req.cookies.get("session")?.value;
  const session = await decrypt(cookie);

  if (!session?.userId) {
    return NextResponse.redirect(new URL("/admin/login", req.nextUrl));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};

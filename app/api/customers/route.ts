import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.userId) return Response.json({ error: "Yetkisiz." }, { status: 401 });

  const search = req.nextUrl.searchParams.get("q") ?? "";
  const tag = req.nextUrl.searchParams.get("tag") ?? "";

  const customers = await db.customer.findMany({
    where: {
      mergedIntoCustomerId: null,
      ...(search ? { OR: [{ fullName: { contains: search, mode: "insensitive" } }, { phone: { contains: search, mode: "insensitive" } }] } : {}),
      ...(tag ? { tag } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return Response.json({ customers });
}

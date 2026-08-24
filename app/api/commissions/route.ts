import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/dal";
import { buildCommissionReport } from "@/lib/commission-report";

/**
 * Hakediş raporu.
 *
 * Hesap `lib/commission-report.ts` içinde tek yerde durur; `/admin/hakedisler`
 * sayfası da aynı fonksiyonu çağırır. Böylece rapor ile ekran aynı rakamı
 * göstermek zorundadır (FAZ 2 · Sıra 8).
 *
 * Yanıt üç kavramı AYRI AYRI verir:
 *   accrued  → tahakkuk eden hakediş (iş yapıldı, tahsilattan bağımsız)
 *   paid     → berbere gerçekten ödenen
 *   remaining→ kalan (dönem içi ve tüm zamanlar ayrı ayrı)
 */
export async function GET(req: NextRequest) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const { searchParams } = req.nextUrl;
  const report = await buildCommissionReport({
    range: searchParams.get("range"),
    from: searchParams.get("from"),
    to: searchParams.get("to"),
  });

  return Response.json(report);
}

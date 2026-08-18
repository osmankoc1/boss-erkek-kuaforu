import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { PUBLIC_SETTING_KEYS } from "@/lib/public-fields";

/**
 * Ayarlar. Admin oturumu varsa tümü, yoksa yalnızca public işletme bilgileri
 * döner — dahili yapılandırma (bildirim adresi, Resend, entegrasyon anahtarları)
 * oturumsuz çağrılara sızmaz.
 *
 * Not: Public site sayfaları ayarları zaten sunucu tarafında `db.setting`
 * üzerinden okuyor; bu endpoint'e bağımlı değiller.
 */
export async function GET() {
  const session = await getSession();
  const isAdmin = !!session?.userId;

  const settings = await db.setting.findMany(
    isAdmin ? undefined : { where: { key: { in: [...PUBLIC_SETTING_KEYS] } } }
  );
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  return Response.json({ settings: map });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.userId) return Response.json({ error: "Yetkisiz." }, { status: 401 });

  const body = await req.json() as Record<string, string>;

  await Promise.all(
    Object.entries(body).map(([key, value]) =>
      db.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
    )
  );

  revalidatePath("/");
  revalidatePath("/iletisim");
  revalidatePath("/hizmetler");
  revalidatePath("/ekibimiz");
  revalidatePath("/randevu");
  revalidatePath("/randevu-sorgula");

  return Response.json({ ok: true });
}

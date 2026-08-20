import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { PUBLIC_SETTING_KEYS } from "@/lib/public-fields";
import { settingsUpdateSchema } from "@/lib/settings-schema";

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

  const body = await req.json().catch(() => null);
  const parsed = settingsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".");
    return Response.json(
      { error: path ? `${path}: ${issue.message}` : (issue?.message ?? "Geçersiz veri.") },
      { status: 400 }
    );
  }

  // Yalnızca şemadaki anahtarlar yazılır. Şemada olmayanlar Zod tarafından
  // atılır (strip) — reddetmek yerine atmak bilinçli: arayüz, veritabanında
  // duran eski anahtarları da geri gönderiyor ve katı reddetme kaydetmeyi
  // tamamen kilitlerdi.
  const entries = Object.entries(parsed.data).filter(([, value]) => value !== undefined) as [string, string][];

  if (entries.length === 0) {
    return Response.json({ error: "Güncellenecek geçerli bir ayar alanı yok." }, { status: 400 });
  }

  await Promise.all(
    entries.map(([key, value]) =>
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

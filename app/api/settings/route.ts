import { NextRequest } from "next/server";
import { writeAudit } from "@/lib/audit";
import { adminActor } from "@/lib/audit-actor";
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

  const actor = await adminActor();

  // Onceden `Promise.all` ile ayri ayri yaziliyordu; artik TEK TRANSACTION
  // (FAZ 2 · Sira 10b). Denetim izi ana islemle ayni transaction'da olmali.
  //
  // Onceki degerler ayni transaction icinde okunur ki `changes` gercek
  // before/after gostersin.
  await db.$transaction(async (tx) => {
    const oncekiler = await tx.setting.findMany({
      where: { key: { in: entries.map(([k]) => k) } },
      select: { key: true, value: true },
    });
    const oncekiMap = new Map(oncekiler.map((o) => [o.key, o.value]));

    for (const [key, value] of entries) {
      const onceki = oncekiMap.get(key) ?? null;
      await tx.setting.upsert({ where: { key }, update: { value }, create: { key, value } });

      // Degeri degismeyen ayar icin kayit yazilmaz -- gurultu olurdu.
      if (onceki === value) continue;
      await writeAudit(tx, {
        entity: "Setting",
        entityId: key,
        action: onceki === null ? "CREATE" : "UPDATE",
        actor,
        changes: { value: { before: onceki, after: value } },
      });
    }
  });

  revalidatePath("/");
  revalidatePath("/iletisim");
  revalidatePath("/hizmetler");
  revalidatePath("/ekibimiz");
  revalidatePath("/randevu");
  revalidatePath("/randevu-sorgula");

  return Response.json({ ok: true });
}

import "server-only";
import { getAdminUser } from "./dal";
import { PUBLIC_ACTOR, type AuditActor } from "./audit";

/**
 * Oturumdan aktör çözümü (FAZ 2 · Sıra 10b).
 *
 * `lib/audit.ts` bilinçli olarak saf tutuldu (test script'lerinden
 * doğrulanabilsin diye); oturum katmanına bağımlı olan tek parça burada.
 */
/**
 * Oturumdaki admini aktör olarak döndürür.
 *
 * `getAdminUser()` React `cache()` ile sarılıdır; aynı istek içinde kaç kez
 * çağrılırsa çağrılsın veritabanına tek kez gider. Bu yüzden mevcut ~30
 * `requireAdmin()` çağrı yerinin hiçbirini değiştirmek gerekmedi.
 *
 * Oturum yoksa `PUBLIC` döner — çağıran zaten `requireAdmin()` ile korunuyorsa
 * bu duruma düşmez.
 */
export async function adminActor(): Promise<AuditActor> {
  const u = await getAdminUser();
  if (!u) return PUBLIC_ACTOR;
  return { source: "ADMIN", userId: u.id, userEmail: u.email };
}

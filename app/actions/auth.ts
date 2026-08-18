"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createSession, deleteSession } from "@/lib/session";
import {
  LOGIN_RATE_LIMIT_MESSAGE,
  checkLoginRateLimit,
  clearFailedLogins,
  recordFailedLogin,
} from "@/lib/login-rate-limit";

/** Hesabın var olup olmadığını ifşa etmeyen tek tip hata mesajı. */
const INVALID_CREDENTIALS = "Geçersiz email veya şifre.";

/**
 * Kullanıcı bulunamadığında da bcrypt çalıştırmak için sabit hash.
 *
 * Aksi halde var olmayan bir e-posta anında, var olan bir e-posta ~100 ms
 * sonra yanıt döner ve bu fark hesap sayımı (enumeration) için kullanılabilir.
 * Rastgele bir değerin hash'idir; hiçbir şifreyle eşleşmez.
 */
const DUMMY_PASSWORD_HASH = "$2b$12$6.G7YqMfMxL3bMuYwU1uZ.vCqTmw0eMBaLF/e5dItkmU7mLYkG4EG";

async function getClientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0].trim() ??
    h.get("x-real-ip") ??
    "unknown"
  );
}

export async function login(state: { error?: string } | undefined, formData: FormData) {
  const emailInput = ((formData.get("email") as string) ?? "").trim();
  const password = (formData.get("password") as string) ?? "";

  if (!emailInput || !password) return { error: "Email ve şifre gereklidir." };

  const ip = await getClientIp();

  // Şifre doğrulanmadan önce kontrol edilir; aksi halde limit dolmuşken bile
  // her istek bir bcrypt karşılaştırması maliyeti yaratırdı.
  const blocked = await checkLoginRateLimit(ip, emailInput);
  if (blocked) return { error: LOGIN_RATE_LIMIT_MESSAGE };

  const user = await db.user.findUnique({ where: { email: emailInput } });

  // Kullanıcı yoksa da karşılaştırma yapılır — zamanlama farkı oluşmasın.
  const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);

  if (!user || !valid) {
    await recordFailedLogin(ip, emailInput);
    return { error: INVALID_CREDENTIALS };
  }

  await clearFailedLogins(emailInput);
  await createSession(user.id);
  redirect("/admin/dashboard");
}

export async function logout() {
  await deleteSession();
  redirect("/admin/login");
}

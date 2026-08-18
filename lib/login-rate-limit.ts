import "server-only";
import { db } from "./db";

/**
 * Admin girişi için kaba kuvvet koruması.
 *
 * Mevcut `RateLimit` modeli kullanılır — yeni tablo veya migration yoktur.
 * Sayım pencere bazlıdır: eski kayıtlar sorgu sırasında zaman filtresiyle
 * dışarıda kalır, dolayısıyla kimse kalıcı olarak kilitlenmez.
 *
 * İki ayrı limit birlikte çalışır:
 * - IP: tek bir kaynaktan farklı hesaplara yapılan taramayı yavaşlatır.
 * - E-posta: botnet/proxy ile IP değiştirerek tek bir hesaba yapılan
 *   saldırıyı yavaşlatır. IP limiti tek başına buna karşı yetersizdir.
 */

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_IP_LIMIT = 10;
export const LOGIN_EMAIL_LIMIT = 5;
export const LOGIN_ACTION = "login";

/** Kullanıcıya gösterilen mesaj — hesabın var olup olmadığını ifşa etmez. */
export const LOGIN_RATE_LIMIT_MESSAGE =
  "Çok fazla başarısız giriş denemesi yapıldı. Lütfen 15 dakika sonra tekrar deneyin.";

export type LoginBlockReason = "ip" | "email" | null;

/** E-posta anahtarı büyük/küçük harften bağımsız olmalı. */
function emailKey(email: string): string {
  return `login-email:${email.trim().toLowerCase()}`;
}

function ipKey(ip: string): string {
  return `login-ip:${ip}`;
}

function windowStart(): Date {
  return new Date(Date.now() - LOGIN_WINDOW_MS);
}

/**
 * Giriş denemesine izin verilip verilmediğini söyler.
 * Şifre doğrulanmadan ÖNCE çağrılmalıdır.
 */
export async function checkLoginRateLimit(ip: string, email: string): Promise<LoginBlockReason> {
  const createdAt = { gte: windowStart() };

  const [ipCount, emailCount] = await Promise.all([
    db.rateLimit.count({ where: { key: ipKey(ip), action: LOGIN_ACTION, createdAt } }),
    db.rateLimit.count({ where: { key: emailKey(email), action: LOGIN_ACTION, createdAt } }),
  ]);

  if (emailCount >= LOGIN_EMAIL_LIMIT) return "email";
  if (ipCount >= LOGIN_IP_LIMIT) return "ip";
  return null;
}

/**
 * Başarısız denemeyi hem IP hem e-posta anahtarına yazar.
 *
 * E-posta veritabanında olmasa bile kayıt tutulur; aksi halde "limit
 * tetiklendi mi" farkı üzerinden hesap varlığı çıkarımı yapılabilirdi.
 */
export async function recordFailedLogin(ip: string, email: string): Promise<void> {
  await db.rateLimit.createMany({
    data: [
      { key: ipKey(ip), action: LOGIN_ACTION },
      { key: emailKey(email), action: LOGIN_ACTION },
    ],
  });
}

/**
 * Başarılı giriş sonrası o e-postaya ait başarısız deneme kayıtlarını siler.
 *
 * IP kayıtları bilinçli olarak KORUNUR: aynı IP paylaşımlı bir ağ olabilir ve
 * o kaynaktan başka hesaplara süren bir tarama varsa, tek bir başarılı giriş
 * bunu sıfırlamamalıdır.
 */
export async function clearFailedLogins(email: string): Promise<void> {
  await db.rateLimit.deleteMany({ where: { key: emailKey(email), action: LOGIN_ACTION } });
}

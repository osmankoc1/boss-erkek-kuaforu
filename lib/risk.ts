import { db } from "@/lib/db";

const BOT_UA_PATTERNS = [/curl/i, /python/i, /wget/i, /scrapy/i, /headless/i, /phantom/i, /selenium/i];
const DISPOSABLE_DOMAINS = ["mailinator.com", "guerrillamail.com", "tempmail.com", "throwam.com", "yopmail.com"];

export async function calcRiskScore(params: {
  ip: string;
  userAgent: string;
  phone: string;
  email: string;
  customerName: string;
}): Promise<{ score: number; reasons: string[] }> {
  const reasons: string[] = [];
  let score = 0;

  // Bot user-agent
  if (BOT_UA_PATTERNS.some((p) => p.test(params.userAgent))) {
    score += 40;
    reasons.push("bot_user_agent");
  }

  // Disposable email domain
  const emailDomain = params.email.split("@")[1]?.toLowerCase();
  if (emailDomain && DISPOSABLE_DOMAINS.includes(emailDomain)) {
    score += 20;
    reasons.push("disposable_email");
  }

  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const cutoff10m = new Date(Date.now() - 10 * 60 * 1000);

  // High IP volume in last 24h
  const ipCount24h = await db.rateLimit.count({
    where: { key: `ip:${params.ip}`, action: "appointment", createdAt: { gte: cutoff24h } },
  });
  if (ipCount24h >= 5) {
    score += 30;
    reasons.push("high_ip_volume");
  }

  // IP burst in last 10m
  const ipCount10m = await db.rateLimit.count({
    where: { key: `ip:${params.ip}`, action: "appointment", createdAt: { gte: cutoff10m } },
  });
  if (ipCount10m >= 2) {
    score += 15;
    reasons.push("ip_burst");
  }

  // Same phone, different customer name
  const existingCustomer = await db.customer.findUnique({ where: { phone: params.phone } });
  if (existingCustomer && existingCustomer.fullName.toLowerCase() !== params.customerName.toLowerCase()) {
    score += 20;
    reasons.push("phone_name_mismatch");
  }

  return { score: Math.min(score, 100), reasons };
}

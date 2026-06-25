export function normalizePhone(raw: string): string {
  const cleaned = raw.replace(/[\s\-().]/g, "");
  if (cleaned.startsWith("+90")) return cleaned;
  if (cleaned.startsWith("0090")) return "+" + cleaned.slice(2);
  if (cleaned.startsWith("00")) return "+" + cleaned.slice(2);
  if (cleaned.startsWith("0")) return "+90" + cleaned.slice(1);
  if (cleaned.startsWith("5")) return "+90" + cleaned;
  return cleaned;
}

export function validatePhone(phone: string): boolean {
  return /^\+90[5][0-9]{9}$/.test(phone);
}

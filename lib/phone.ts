export const PHONE_ERROR =
  "Telefon numarası 10 haneli olmalı ve başında 0 veya +90 olmadan yazılmalıdır. Örnek: 5551234567";

export function validatePhone(phone: string): boolean {
  return /^5[0-9]{9}$/.test(phone);
}

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string) {
  return new Date(date).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function formatTime(time: string) {
  return time;
}

export function formatPrice(price: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    minimumFractionDigits: 0,
  }).format(price);
}

export function getDayName(day: number) {
  const days = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
  return days[day];
}

export const STATUS_LABELS: Record<string, string> = {
  pending_verification: "E-posta Doğrulama",
  pending: "Bekliyor",
  confirmed: "Onaylandı",
  cancelled: "İptal Edildi",
  completed: "Tamamlandı",
};

export const TAG_LABELS: Record<string, string> = {
  normal: "Normal",
  düzenli: "Düzenli",
  VIP: "VIP",
  sorunlu: "Sorunlu",
};

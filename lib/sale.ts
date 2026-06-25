export function calcShares(
  saleAmount: number,
  workerType: string,
  commissionRate: number
): { barberShare: number; businessShare: number } {
  const barberShare =
    workerType === "COMMISSION"
      ? Math.round(saleAmount * (commissionRate / 100) * 100) / 100
      : 0;
  return { barberShare, businessShare: Math.round((saleAmount - barberShare) * 100) / 100 };
}

export function calcStatus(paidAmount: number, saleAmount: number): string {
  if (paidAmount >= saleAmount) return "PAID";
  if (paidAmount > 0) return "PARTIAL";
  return "CREDIT";
}

export function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

export function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

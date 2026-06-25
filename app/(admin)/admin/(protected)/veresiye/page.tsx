import { db } from "@/lib/db";
import VeresiyeClient from "./VeresiyeClient";

export const metadata = { title: "Veresiye Defteri — BOSS Admin" };

export default async function VeresiyePage() {
  const sales = await db.sale.findMany({
    where: { saleStatus: { in: ["PARTIAL", "CREDIT"] } },
    orderBy: { saleDate: "desc" },
  });

  const now = new Date();
  const debts = sales.map((s) => ({
    id: s.id,
    customerName: s.customerName,
    customerPhone: s.customerPhone,
    serviceName: s.serviceName,
    barberName: s.barberName,
    saleAmount: s.saleAmount,
    paidAmount: s.paidAmount,
    remainingAmount: s.remainingAmount,
    saleStatus: s.saleStatus,
    saleDate: s.saleDate.toISOString(),
    daysAgo: Math.floor((now.getTime() - s.saleDate.getTime()) / 86400000),
    customerId: s.customerId,
  }));

  const totalDebt = debts.reduce((s, d) => s + d.remainingAmount, 0);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-black text-white tracking-tight">Veresiye Defteri</h1>
        <p className="text-[#9ca3af] text-sm mt-1">
          {debts.length} açık kayıt — Toplam borç: <span className="text-orange-400 font-bold">{totalDebt.toFixed(2)} ₺</span>
        </p>
      </div>
      <VeresiyeClient initialDebts={debts} />
    </div>
  );
}

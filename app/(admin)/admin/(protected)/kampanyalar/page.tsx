import { db } from "@/lib/db";
import CampaignManager from "./CampaignManager";

export const metadata = { title: "Kampanyalar — BOSS Admin" };

export default async function KampanyalarPage() {
  const campaigns = await db.campaign.findMany({ orderBy: [{ priority: "asc" }, { createdAt: "desc" }] });
  return (
    <div className="p-6 md:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-black">Kampanyalar</h1>
        <p className="text-[#6b7280] text-sm">Aktif kampanyaları yönetin.</p>
      </div>
      <CampaignManager campaigns={campaigns} />
    </div>
  );
}

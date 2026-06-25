import { db } from "@/lib/db";
import SettingsForm from "./SettingsForm";

export const metadata = { title: "Ayarlar — BOSS Admin" };

export default async function AyarlarPage() {
  const settings = await db.setting.findMany();
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  return (
    <div className="p-6 md:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-black">Ayarlar</h1>
        <p className="text-[#6b7280] text-sm">İşletme bilgileri ve entegrasyonlar.</p>
      </div>
      <SettingsForm settings={map} />
    </div>
  );
}

import { db } from "@/lib/db";
import { WRITABLE_SETTING_KEYS } from "@/lib/settings-schema";
import SettingsForm from "./SettingsForm";
import PasswordChangeForm from "./PasswordChangeForm";

export const metadata = { title: "Ayarlar — BOSS Admin" };

export default async function AyarlarPage() {
  // YALNIZCA düzenlenebilir anahtarlar okunur (FAZ 3 · Sıra 3.3).
  //
  // Önceden `findMany()` bütün satırları çekip client bileşenine veriyordu.
  // Bir alanı arayüzden kaldırmak, değerinin tarayıcıya gitmesini
  // engellemiyordu: form `settings` nesnesinin tamamını props olarak alıyor.
  // Eski kurulumlardan kalan ölü satırlar da böyle taşınıyordu. Kaynağı
  // yazma şemasıyla aynı listeye bağlamak bu sapmayı imkânsız kılar.
  const settings = await db.setting.findMany({
    where: { key: { in: [...WRITABLE_SETTING_KEYS] } },
  });
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  return (
    <div className="p-6 md:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-black">Ayarlar</h1>
        <p className="text-[#6b7280] text-sm">İşletme bilgileri ve sosyal medya bağlantıları.</p>
      </div>
      <div className="space-y-8">
        <SettingsForm settings={map} />
        <PasswordChangeForm />
      </div>
    </div>
  );
}

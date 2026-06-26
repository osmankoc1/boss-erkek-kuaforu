"use client";
import { useState } from "react";

const FIELDS = [
  { key: "business_name", label: "İşletme Adı", section: "İşletme Bilgileri" },
  { key: "business_phone", label: "Telefon", section: "İşletme Bilgileri" },
  { key: "business_email", label: "E-posta", section: "İşletme Bilgileri" },
  { key: "business_address", label: "Adres", section: "İşletme Bilgileri" },
  { key: "maps_link", label: "Google Maps Embed URL", section: "İşletme Bilgileri" },
  { key: "instagram_url", label: "Instagram URL", section: "Sosyal Medya" },
  { key: "facebook_url", label: "Facebook URL", section: "Sosyal Medya" },
  { key: "resend_from_email", label: "Gönderici E-posta (Resend)", section: "Bildirimler" },
  { key: "google_calendar_enabled", label: "Google Calendar Aktif (true/false)", section: "Google Calendar" },
  { key: "google_calendar_id", label: "Google Calendar ID", section: "Google Calendar" },
];

export default function SettingsForm({ settings }: { settings: Record<string, string> }) {
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const sections = [...new Set(FIELDS.map((f) => f.section))];

  return (
    <form onSubmit={handleSave} className="space-y-8">
      {sections.map((section) => (
        <div key={section} className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-6">
          <h2 className="text-sm font-semibold text-[#9ca3af] uppercase tracking-wider mb-4">{section}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {FIELDS.filter((f) => f.section === section).map((f) => (
              <div key={f.key}>
                <label className="block text-xs text-[#9ca3af] mb-1 uppercase tracking-wider">{f.label}</label>
                <input
                  value={form[f.key] ?? ""}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  className="w-full bg-[#1e1e1e] border border-[#2a2a2a] focus:border-[#c9762c] rounded-lg px-3 py-2 text-white outline-none text-sm"
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      <button
        type="submit"
        disabled={saving}
        className="px-8 py-3 bg-[#c9762c] hover:bg-[#e8913a] disabled:opacity-50 text-white font-bold rounded-lg transition-colors"
      >
        {saving ? "Kaydediliyor..." : saved ? "✓ Kaydedildi!" : "Kaydet"}
      </button>
    </form>
  );
}

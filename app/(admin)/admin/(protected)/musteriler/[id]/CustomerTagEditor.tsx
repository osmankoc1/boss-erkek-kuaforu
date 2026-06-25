"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { TAG_LABELS } from "@/lib/utils";

export default function CustomerTagEditor({ id, currentTag, notes }: { id: string; currentTag: string; notes: string }) {
  const router = useRouter();
  const [tag, setTag] = useState(currentTag);
  const [note, setNote] = useState(notes);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await fetch(`/api/customers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag, notes: note }),
    });
    router.refresh();
    setSaving(false);
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-[#6b7280] uppercase tracking-wider block mb-1">Etiket</label>
        <select
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          className="w-full bg-[#1e1e1e] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm outline-none"
        >
          {Object.entries(TAG_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div>
        <label className="text-xs text-[#6b7280] uppercase tracking-wider block mb-1">Notlar</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="w-full bg-[#1e1e1e] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm outline-none resize-none"
          placeholder="Admin notu..."
        />
      </div>
      <button
        onClick={save}
        disabled={saving}
        className="w-full py-2 bg-[#c9762c] hover:bg-[#e8913a] disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
      >
        {saving ? "Kaydediliyor..." : "Kaydet"}
      </button>
    </div>
  );
}

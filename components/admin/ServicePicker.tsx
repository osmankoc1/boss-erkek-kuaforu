"use client";

export type PickerService = {
  id: string;
  name: string;
  price: number;
  durationMinutes: number;
  category: string;
  displayOrder: number;
};

export type SelectedItem = {
  serviceId: string;
  serviceName: string;
  category: string;
  price: number;
  durationMinutes: number;
};

type Props = {
  services: PickerService[];
  selected: SelectedItem[];
  onChange: (items: SelectedItem[]) => void;
  editablePrices?: boolean;
};

const CATEGORY_ORDER = ["Saç", "Sakal", "Bakım", "Paket", "Çocuk", "Diğer"];

function groupByCategory(services: PickerService[]): Record<string, PickerService[]> {
  const groups: Record<string, PickerService[]> = {};
  for (const s of services) {
    const cat = s.category || "Diğer";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(s);
  }
  return groups;
}

function sortedCategories(groups: Record<string, PickerService[]>): string[] {
  const keys = Object.keys(groups);
  return keys.sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

export default function ServicePicker({ services, selected, onChange, editablePrices = false }: Props) {
  const groups = groupByCategory(services);
  const categories = sortedCategories(groups);

  const totalPrice = selected.reduce((s, i) => s + i.price, 0);
  const totalDuration = selected.reduce((s, i) => s + i.durationMinutes, 0);

  function toggle(svc: PickerService) {
    const exists = selected.find((i) => i.serviceId === svc.id);
    if (exists) {
      onChange(selected.filter((i) => i.serviceId !== svc.id));
    } else {
      onChange([...selected, {
        serviceId: svc.id,
        serviceName: svc.name,
        category: svc.category,
        price: svc.price,
        durationMinutes: svc.durationMinutes,
      }]);
    }
  }

  function updatePrice(serviceId: string, price: number) {
    onChange(selected.map((i) => i.serviceId === serviceId ? { ...i, price } : i));
  }

  return (
    <div className="space-y-3">
      {/* Kategori grupları */}
      {categories.map((cat) => (
        <div key={cat}>
          <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1.5">{cat}</p>
          <div className="space-y-1">
            {groups[cat].map((svc) => {
              const isSelected = !!selected.find((i) => i.serviceId === svc.id);
              const selectedItem = selected.find((i) => i.serviceId === svc.id);
              return (
                <div key={svc.id}>
                  <button
                    type="button"
                    onClick={() => toggle(svc)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-left transition-all ${
                      isSelected
                        ? "bg-[#c9762c]/10 border-[#c9762c]/40 text-white"
                        : "bg-[#1a1a1a] border-[#2a2a2a] text-[#9ca3af] hover:border-[#3a3a3a] hover:text-white"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all ${
                        isSelected ? "bg-[#c9762c] border-[#c9762c]" : "border-[#3a3a3a]"
                      }`}>
                        {isSelected && (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <span className="text-[13px] font-medium">{svc.name}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[11px] text-[#6b7280]">{svc.durationMinutes} dk</span>
                      <span className={`text-[13px] font-semibold ${isSelected ? "text-[#c9762c]" : "text-[#9ca3af]"}`}>
                        {svc.price.toFixed(2)} ₺
                      </span>
                    </div>
                  </button>

                  {/* Fiyat düzenleme (sadece editablePrices=true ve seçiliyse) */}
                  {editablePrices && isSelected && selectedItem && (
                    <div className="flex items-center gap-2 mt-1 pl-9 pr-1">
                      <span className="text-[11px] text-[#6b7280] shrink-0">Fiyat:</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={selectedItem.price}
                        onChange={(e) => updatePrice(svc.id, parseFloat(e.target.value) || 0)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-28 bg-[#111] border border-[#c9762c]/30 rounded px-2 py-1 text-[12px] text-white focus:outline-none focus:border-[#c9762c]/60"
                      />
                      <span className="text-[11px] text-[#6b7280]">₺</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Özet */}
      {selected.length > 0 && (
        <div className="mt-3 px-3 py-2.5 bg-[#111] border border-[#2a2a2a] rounded-lg flex items-center justify-between">
          <span className="text-[12px] text-[#9ca3af]">
            {selected.length} hizmet · {totalDuration} dk
          </span>
          <span className="text-[14px] font-black text-[#c9762c]">{totalPrice.toFixed(2)} ₺</span>
        </div>
      )}

      {selected.length === 0 && (
        <p className="text-[12px] text-[#6b7280] text-center py-2">Henüz hizmet seçilmedi.</p>
      )}
    </div>
  );
}

import { useState, useRef, useEffect } from "react";
import { MapPin, ChevronDown, Check } from "lucide-react";

export default function LocationFilter({ locations, selectedIds, setSelectedIds }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function toggle(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const label =
    selectedIds.length === 0
      ? "All Locations"
      : selectedIds.length === 1
      ? locations.find((l) => l.id === selectedIds[0])?.name || "1 Location"
      : `${selectedIds.length} Locations Selected`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
      >
        <MapPin size={14} className="text-slate-400" />
        {label}
        <ChevronDown size={14} className="text-slate-400" />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
          <button
            onClick={() => setSelectedIds([])}
            className="mb-1 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-slate-50"
          >
            <span className={selectedIds.length === 0 ? "font-medium text-brand-700" : "text-slate-700"}>All Locations (combined)</span>
            {selectedIds.length === 0 && <Check size={14} className="text-brand-600" />}
          </button>
          <div className="my-1 border-t border-slate-100" />
          {locations.map((loc) => (
            <button
              key={loc.id}
              onClick={() => toggle(loc.id)}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-slate-50"
            >
              <span className={selectedIds.includes(loc.id) ? "font-medium text-brand-700" : "text-slate-700"}>{loc.name}</span>
              {selectedIds.includes(loc.id) && <Check size={14} className="text-brand-600" />}
            </button>
          ))}
          {selectedIds.length > 0 && (
            <>
              <div className="my-1 border-t border-slate-100" />
              <button onClick={() => setSelectedIds([])} className="w-full rounded-md px-2 py-1.5 text-left text-xs text-slate-400 hover:bg-slate-50">
                Clear selection
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

import { useRef, useState } from "react";
import { Camera, X, Loader2, AlertCircle } from "lucide-react";
import { api } from "../api.js";

export default function PhotoUpload({ label, kind, required, url, onUploaded, hint }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const publicUrl = await api.uploadTransactionPhoto(file, kind);
      onUploaded(publicUrl);
    } catch (err) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <label className="mb-1 flex items-center gap-1 text-xs text-slate-500">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>

      {url ? (
        <div className="relative w-fit">
          <img src={url} alt={label} className="h-24 w-24 rounded-lg border border-slate-200 object-cover" />
          <button type="button" onClick={() => onUploaded(null)} className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white hover:bg-rose-600">
            <X size={12} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className={`flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-xs disabled:opacity-60 ${
            required ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100" : "border-slate-200 bg-slate-50 text-slate-400 hover:bg-slate-100"
          }`}
        >
          {uploading ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
          {uploading ? "Uploading..." : "Add photo"}
        </button>
      )}

      <input ref={inputRef} type="file" accept="image/*" capture="environment" onChange={handleFile} className="hidden" />
      {hint && !url && <p className="mt-1 max-w-[10rem] text-[11px] text-slate-400">{hint}</p>}
      {error && <p className="mt-1 flex items-center gap-1 text-[11px] text-rose-500"><AlertCircle size={11} /> {error}</p>}
    </div>
  );
}

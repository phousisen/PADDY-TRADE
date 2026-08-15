import { Settings } from "lucide-react";
import Topbar from "../components/Topbar.jsx";

export default function SettingsPage() {
  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title="Settings" />
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <Settings className="mx-auto mb-3 text-slate-300" size={32} />
          <p className="text-sm text-slate-500">Company-wide settings (default tax rate, receipt details, branding) aren't built yet — tell me what you'd like to be able to configure here and I'll add it.</p>
        </div>
      </main>
    </div>
  );
}

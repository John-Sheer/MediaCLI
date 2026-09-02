import { Trash2, X } from "lucide-react";

export default function ConfirmModal({ open, title = "Confirmer la suppression", message = "", confirmText = "Supprimer", danger = true, onConfirm, onClose }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10040] flex items-center justify-center animate-fade-in">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-[min(19rem,calc(100vw-48px))] rounded-2xl bg-surface border border-white/10 p-5 shadow-2xl animate-slide-up">
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-xl shrink-0 flex items-center justify-center ${danger ? "bg-red-500/10 ring-1 ring-red-500/30 text-red-400" : "bg-white/[0.06] ring-1 ring-white/[0.12] text-white/80"}`}>
            {danger ? <Trash2 className="w-4 h-4" /> : <X className="w-4 h-4" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white leading-snug">{title}</p>
            {message ? <p className="mt-1 text-[11px] text-white/70 leading-snug">{message}</p> : null}
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-white/50 hover:text-white/80 hover:bg-white/[0.08] transition-colors shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="mt-4 flex gap-2.5">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-xl bg-white/[0.07] text-white/90 text-[11px] font-medium ring-1 ring-white/[0.1] hover:bg-white/[0.12] transition-colors active:scale-95"
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            className={`flex-[1.4] py-2 rounded-xl text-white text-[11px] font-semibold transition-colors active:scale-95 ${danger ? "bg-red-500/90 hover:bg-red-500" : "bg-white/[0.1] hover:bg-white/[0.16] ring-1 ring-white/[0.14]"}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
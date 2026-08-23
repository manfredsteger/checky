import { useEffect } from 'react';
import { useOverlayDismiss } from './useOverlayDismiss';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open, title, message, confirmLabel = 'Bestätigen', cancelLabel = 'Abbrechen',
  danger = false, loading = false, onConfirm, onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  const overlay = useOverlayDismiss(onCancel);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      {...overlay}
    >
      <div
        className="bg-[#111827] border border-[#1f2937] rounded-2xl shadow-2xl w-full max-w-md p-6 animate-[fadeIn_0.15s_ease-out]"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h3 className="text-lg font-bold text-white">{title}</h3>
        {message && <p className="text-sm text-[#9ca3af] mt-2">{message}</p>}
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-[#1f2937] hover:bg-[#374151] text-white transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            autoFocus
            className={`px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50 ${danger ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}
          >
            {loading ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

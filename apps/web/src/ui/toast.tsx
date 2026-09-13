import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: ToastKind; message: string }

const ToastCtx = createContext<(kind: ToastKind, message: string, durationMs?: number) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

const STYLES: Record<ToastKind, { border: string; icon: ReactNode }> = {
  success: { border: 'border-emerald-500/40', icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" /> },
  error: { border: 'border-red-500/40', icon: <AlertCircle className="w-4 h-4 text-red-400" /> },
  info: { border: 'border-sky-500/40', icon: <Info className="w-4 h-4 text-sky-400" /> },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => setToasts(t => t.filter(x => x.id !== id)), []);

  const push = useCallback((kind: ToastKind, message: string, durationMs = 4500) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, kind, message }]);
    setTimeout(() => remove(id), durationMs);
  }, [remove]);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm">
        {toasts.map(t => (
          <div key={t.id}
            className={`flex items-start gap-2 bg-[#111827] border ${STYLES[t.kind].border} rounded-lg shadow-2xl px-4 py-3 text-sm text-white animate-[fadeIn_0.15s_ease-out]`}>
            <span className="mt-0.5 shrink-0">{STYLES[t.kind].icon}</span>
            <span className="flex-1">{t.message}</span>
            <button onClick={() => remove(t.id)} className="text-[#6b7280] hover:text-white shrink-0"><X className="w-4 h-4" /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

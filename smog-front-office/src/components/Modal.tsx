import { useEffect, type ReactNode } from 'react';

export function Modal({ title, onClose, children, footer, wide }: {
  title: string; onClose?: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && onClose) onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-2 sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`w-full ${wide ? 'max-w-5xl' : 'max-w-lg'} rounded-lg bg-white shadow-xl`}>
        <div className="flex items-center justify-between rounded-t-lg bg-cobalt px-4 py-2.5 text-white">
          <h2 className="text-base font-bold">{title}</h2>
          {onClose && <button className="rounded px-2 text-xl leading-none hover:bg-white/20" onClick={onClose} aria-label="Close">×</button>}
        </div>
        <div className="p-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="mb-2 rounded border border-brandred/30 bg-brandred/10 px-3 py-2 text-sm text-brandred" role="alert">{error}</div>;
}

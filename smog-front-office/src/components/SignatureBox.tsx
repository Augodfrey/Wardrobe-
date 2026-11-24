import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import SignaturePad from 'signature_pad';

export interface SignatureHandle { isEmpty: () => boolean; clear: () => void; toPng: () => string }

/** Finger/stylus signature capture that survives resizes and rotation. */
export const SignatureBox = forwardRef<SignatureHandle, { label: string; clearLabel: string }>(function SignatureBox({ label, clearLabel }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pad = useRef<SignaturePad | null>(null);

  useEffect(() => {
    const c = canvas.current!;
    const p = new SignaturePad(c, { penColor: '#0b1f44', minWidth: 1.2, maxWidth: 3, backgroundColor: 'rgba(255,255,255,0)' });
    pad.current = p;
    const resize = () => {
      const data = p.toData();
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      c.width = c.offsetWidth * ratio; c.height = c.offsetHeight * ratio;
      c.getContext('2d')!.scale(ratio, ratio);
      p.clear(); p.fromData(data);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); p.off(); };
  }, []);

  useImperativeHandle(ref, () => ({
    isEmpty: () => pad.current?.isEmpty() ?? true,
    clear: () => pad.current?.clear(),
    toPng: () => pad.current?.toDataURL('image/png') ?? '',
  }));

  return (
    <div>
      <div className="relative rounded-lg border-2 border-dashed border-cobalt/50 bg-white">
        <canvas ref={canvas} className="h-56 w-full touch-none sm:h-64" aria-label={label} />
        <div className="pointer-events-none absolute bottom-10 left-6 right-6 border-b border-slate-400" />
        <span className="pointer-events-none absolute bottom-3 left-6 text-xs text-slate-400">✕ {label}</span>
      </div>
      <button type="button" className="btn-ghost mt-2" onClick={() => pad.current?.clear()}>{clearLabel}</button>
    </div>
  );
});

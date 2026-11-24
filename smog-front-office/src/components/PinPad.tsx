import { useState } from 'react';

export function PinPad({ title, onSubmit, error }: { title: string; onSubmit: (pin: string) => void; error?: string | null }) {
  const [pin, setPin] = useState('');
  const press = (d: string) => setPin((p) => (p.length < 8 ? p + d : p));
  return (
    <div className="mx-auto w-full max-w-xs text-center">
      <p className="mb-2 text-sm font-semibold text-slate-600">{title}</p>
      <div className="mb-3 h-10 rounded border border-slate-300 bg-white text-2xl tracking-[0.5em] leading-10" aria-label="PIN">{'•'.repeat(pin.length)}</div>
      {error && <p className="mb-2 text-sm text-brandred">{error}</p>}
      <div className="grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} className="btn-ghost h-14 text-xl" onClick={() => press(d)}>{d}</button>
        ))}
        <button className="btn-ghost h-14" onClick={() => setPin('')}>Clear</button>
        <button className="btn-ghost h-14 text-xl" onClick={() => press('0')}>0</button>
        <button className="btn-primary h-14" disabled={pin.length < 4} onClick={() => { onSubmit(pin); setPin(''); }}>OK</button>
      </div>
    </div>
  );
}

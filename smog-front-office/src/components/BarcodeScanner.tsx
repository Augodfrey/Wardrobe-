import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';

/**
 * Camera barcode scanner. Uses the native BarcodeDetector where available
 * (Chrome/Android, recent iPadOS) and falls back to ZXing. Also accepts input
 * from USB / Bluetooth 2D scanners that type like a keyboard.
 */
type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

export function BarcodeScanner({ title, hint, onResult, onClose }: {
  title: string; hint: string; onResult: (text: string) => void; onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const done = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let zxingControls: { stop: () => void } | null = null;
    const finish = (text: string) => {
      if (done.current || !text) return;
      done.current = true;
      onResult(text);
    };
    (async () => {
      try {
        const BD = (window as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> } }).BarcodeDetector;
        const supported = BD ? await BD.getSupportedFormats().catch(() => [] as string[]) : [];
        if (BD && supported.includes('pdf417')) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } });
          if (!video.current) return;
          video.current.srcObject = stream;
          await video.current.play();
          const det = new BD({ formats: ['pdf417', 'code_39', 'code_128', 'data_matrix', 'qr_code'].filter((f) => supported.includes(f)) });
          const tick = async () => {
            if (done.current || !video.current) return;
            try {
              const codes = await det.detect(video.current);
              if (codes[0]?.rawValue) return finish(codes[0].rawValue);
            } catch { /* frame not ready */ }
            raf = requestAnimationFrame(tick);
          };
          tick();
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          const { BarcodeFormat, DecodeHintType } = await import('@zxing/library');
          const hints = new Map();
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.PDF_417, BarcodeFormat.CODE_39, BarcodeFormat.CODE_128,
            BarcodeFormat.DATA_MATRIX, BarcodeFormat.QR_CODE]);
          hints.set(DecodeHintType.TRY_HARDER, true);
          const reader = new BrowserMultiFormatReader(hints);
          if (!video.current) return;
          zxingControls = await reader.decodeFromConstraints({ video: { facingMode: 'environment', width: { ideal: 1920 } } }, video.current,
            (res) => { if (res) finish(res.getText()); });
        }
      } catch (e) {
        setError(e instanceof Error && e.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access, or use a handheld scanner / type below.'
          : 'No camera available. Use a handheld scanner or type the information below.');
      }
    })();
    return () => {
      done.current = true;
      cancelAnimationFrame(raf);
      zxingControls?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  return (
    <Modal title={title} onClose={onClose} wide>
      <p className="mb-2 text-sm text-slate-600">{hint}</p>
      {error ? (
        <div className="mb-3 rounded bg-amber-50 p-3 text-sm text-amber-800">{error}</div>
      ) : (
        <div className="relative mb-3 overflow-hidden rounded bg-black">
          <video ref={video} className="aspect-video w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-x-[10%] inset-y-[25%] rounded border-2 border-white/80" />
        </div>
      )}
      <label className="field-label" htmlFor="scan-manual">Handheld scanner input (or paste barcode text)</label>
      <textarea id="scan-manual" className="input h-20 font-mono text-xs" value={manual} onChange={(e) => setManual(e.target.value)}
        placeholder="Click here, then scan with a USB/Bluetooth scanner" />
      <div className="mt-3 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel — I'll type it</button>
        <button className="btn-primary" disabled={!manual.trim()} onClick={() => { done.current = true; onResult(manual); }}>Use scanned text</button>
      </div>
    </Modal>
  );
}

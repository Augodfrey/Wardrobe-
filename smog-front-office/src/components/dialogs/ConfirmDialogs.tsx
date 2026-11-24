import { useState } from 'react';
import { Field, Modal } from '../Modal';

export function VoidDialog({ number, onClose, onConfirm }: { number: string; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  return (
    <Modal title={`Void #${number}?`} onClose={onClose} footer={<>
      <button className="btn-ghost" onClick={onClose}>Keep it</button>
      <button className="btn-danger" disabled={typed.toUpperCase() !== 'VOID' || !reason.trim()} onClick={() => onConfirm(reason)}>Void document</button>
    </>}>
      <p className="mb-3 text-sm text-slate-700">Voiding cancels this document permanently. It stays in the Document List marked VOID.</p>
      <Field label="Reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <Field label='Type "VOID" to confirm' className="mt-2"><input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} /></Field>
    </Modal>
  );
}

/** Smog Master's exact warning when leaving an estimate that was never issued. */
export function LeaveWarningDialog({ onKeep, onDelete }: { onKeep: () => void; onDelete: () => void }) {
  return (
    <Modal title="Estimate not issued" footer={<>
      <button className="btn-primary" autoFocus onClick={onKeep}>Don't Delete</button>
      <button className="btn-danger" onClick={onDelete}>Delete</button>
    </>}>
      <p className="text-base">This Estimate has not been issued so it will be deleted! Click Don't Delete if you want to keep this Estimate.</p>
    </Modal>
  );
}

'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Issue { row: number | null; column: string | null; code: string; message: string }
interface Staged {
  batchId: string;
  status: 'Validated' | 'Rejected';
  rowCount: number;
  errors: Issue[];
  warnings: Issue[];
  summary: { created: number; updated: number; unchanged: number };
}

export function UploadPanel() {
  const router = useRouter();
  const [kind, setKind] = useState<'master' | 'owners'>('master');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const validate = async () => {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    setStaged(null);
    const fd = new FormData();
    fd.set('kind', kind);
    fd.set('file', file);
    const res = await fetch('/api/admin/upload', { method: 'POST', body: fd });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setMessage({ ok: false, text: data.error ?? 'Upload failed' });
    setStaged(data);
    router.refresh();
  };

  const act = async (action: 'publish' | 'discard') => {
    if (!staged) return;
    setBusy(true);
    const res = await fetch(`/api/admin/upload/${staged.batchId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    setBusy(false);
    if (action === 'discard') {
      setStaged(null);
      setMessage({ ok: true, text: 'Upload discarded. Nothing was changed.' });
    } else if (data.published) {
      setStaged(null);
      const s = data.summary;
      setMessage({ ok: true, text: `Published: ${s.created} new, ${s.updated} updated, ${s.unchanged} unchanged. Changes are in the audit log.` });
    } else {
      setStaged({ ...staged, status: 'Rejected', errors: data.errors ?? [] });
      setMessage({ ok: false, text: data.error ?? 'Publishing blocked: the master changed since validation. Fix the errors below and upload again.' });
    }
    router.refresh();
  };

  const issues = staged ? [...staged.errors.map((e) => ({ ...e, sev: 'Error' })), ...staged.warnings.map((w) => ({ ...w, sev: 'Warning' }))] : [];

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Upload type</span>
          <select value={kind} onChange={(e) => { setKind(e.target.value as 'master' | 'owners'); setStaged(null); }} className="surface rounded-md px-3 py-2">
            <option value="master">Cost Centre Master</option>
            <option value="owners">Owner Mapping</option>
          </select>
        </label>
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-xs text-muted">File (.xlsx or .csv, max 5 MB)</span>
          <input type="file" accept=".xlsx,.csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setStaged(null); }}
            className="surface w-full rounded-md px-3 py-1.5 file:mr-3 file:rounded file:border-0 file:bg-brand file:px-3 file:py-1 file:text-white" />
        </label>
        <button type="button" onClick={validate} disabled={!file || busy} className="btn-primary">
          {busy ? 'Working…' : 'Validate'}
        </button>
      </div>

      {message && (
        <p role="status" className={`rounded-md px-3 py-2 text-sm ${message.ok ? 'bg-brand/10 text-brand dark:text-brand-light' : 'bg-accent/10 text-accent'}`}>{message.text}</p>
      )}

      {staged && (
        <div className="space-y-3">
          {staged.status === 'Rejected' ? (
            <p className="rounded-md bg-accent/10 px-3 py-2 text-sm font-semibold text-accent">
              Rejected — {staged.errors.length} error(s) in {staged.rowCount} row(s). Nothing was saved. Fix the file and upload again.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-md bg-brand/10 px-3 py-2 text-sm">
              <span className="font-semibold text-brand dark:text-brand-light">
                ✓ Validated {staged.rowCount} row(s): {staged.summary.created} new, {staged.summary.updated} updated, {staged.summary.unchanged} unchanged.
              </span>
              <span className="ml-auto flex gap-2">
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => act('discard')}>Discard</button>
                <button type="button" className="btn-primary" disabled={busy || staged.summary.created + staged.summary.updated === 0} onClick={() => act('publish')}>Publish</button>
              </span>
            </div>
          )}
          {issues.length > 0 && (
            <div className="max-h-96 overflow-auto rounded-md border border-gray-200 dark:border-gray-700">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="sticky top-0 bg-gray-50 text-xs text-muted dark:bg-gray-800">
                  <tr><th className="px-3 py-2">Row</th><th className="px-3">Column</th><th className="px-3">Severity</th><th className="px-3">Issue</th></tr>
                </thead>
                <tbody>
                  {issues.map((i, n) => (
                    <tr key={n} className="border-t border-gray-100 dark:border-gray-700">
                      <td className="px-3 py-1.5">{i.row ?? 'File'}</td>
                      <td className="px-3">{i.column ?? '—'}</td>
                      <td className={`px-3 font-semibold ${i.sev === 'Error' ? 'text-accent' : 'text-muted'}`}>{i.sev}</td>
                      <td className="px-3">{i.message} <span className="text-xs text-muted">({i.code})</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

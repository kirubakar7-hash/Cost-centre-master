'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { IssueTable } from './admin/IssueTable';
import { ReconTable } from './admin/ReconTable';
import { KIND_LABEL, type Issue, type Kind, type PeriodSummary, type ReconLine } from './admin/types';

interface Staged {
  batchId: string;
  kind: Kind;
  status: 'Validated' | 'Rejected';
  rowCount: number;
  errors: Issue[];
  warnings: Issue[];
  summary: { created: number; updated: number; unchanged: number; periods?: PeriodSummary[] };
}

type Msg = { ok: boolean; text: string } | null;

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: res.ok, data: await res.json() };
}

/** Maker step: upload -> validate -> (financials: enter trial balance) -> submit or publish. */
export function UploadPanel({ makerChecker }: { makerChecker: boolean }) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>('master');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [tb, setTb] = useState<Record<string, string>>({});
  const [recon, setRecon] = useState<ReconLine[] | undefined>();
  const [message, setMessage] = useState<Msg>(null);

  const reset = () => {
    setStaged(null);
    setRecon(undefined);
    setTb({});
  };

  const validate = async () => {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    reset();
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

  const reconcile = async () => {
    if (!staged) return;
    setBusy(true);
    const { ok, data } = await post(`/api/admin/upload/${staged.batchId}`, { action: 'reconcile', tb });
    setBusy(false);
    if (!ok) return setMessage({ ok: false, text: data.error ?? 'Reconciliation failed' });
    setRecon(data.reconciliation);
    setMessage(
      data.reconciled
        ? { ok: true, text: makerChecker ? 'Reconciled to the trial balance. Submitted for approval — another Finance user must publish it.' : 'Reconciled to the trial balance. You can publish.' }
        : { ok: false, text: 'Does not reconcile. Publishing is blocked until CC actuals equal the trial balance for every period. Correct the TB total or fix the file and upload again.' },
    );
    router.refresh();
  };

  const act = async (action: 'publish' | 'discard') => {
    if (!staged) return;
    setBusy(true);
    const { data } = await post(`/api/admin/upload/${staged.batchId}`, { action });
    setBusy(false);
    if (action === 'discard') {
      reset();
      setMessage({ ok: true, text: 'Upload discarded. Nothing was changed.' });
    } else if (data.published) {
      reset();
      setMessage({ ok: true, text: 'Published. Changes are recorded in the audit log.' });
    } else {
      if (data.errors?.length) setStaged({ ...staged, status: 'Rejected', errors: data.errors });
      if (data.reconciliation) setRecon(data.reconciliation);
      setMessage({ ok: false, text: data.error ?? 'Publishing blocked. See the issues below.' });
    }
    router.refresh();
  };

  const periods = staged?.summary.periods ?? [];
  const needsTb = periods.some((p) => p.actualTotal !== null);
  const reconciled = !needsTb || (recon?.length ? recon.every((r) => r.matched) : false);
  const nothingToChange = staged?.kind !== 'financials' && staged && staged.summary.created + staged.summary.updated === 0;

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Upload type</span>
          <select value={kind} onChange={(e) => { setKind(e.target.value as Kind); reset(); setMessage(null); }} className="surface rounded-md px-3 py-2">
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-xs text-muted">File (.xlsx or .csv, max 5 MB)</span>
          <input type="file" accept=".xlsx,.csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }}
            className="surface w-full rounded-md px-3 py-1.5 file:mr-3 file:rounded file:border-0 file:bg-brand file:px-3 file:py-1 file:text-white" />
        </label>
        <button type="button" onClick={validate} disabled={!file || busy} className="btn-primary">
          {busy ? 'Working…' : 'Validate'}
        </button>
      </div>
      {kind === 'financials' && !staged && (
        <p className="text-xs text-muted">
          Tally export mapped by CC_Code. Each upload <strong>replaces every line for every period it contains</strong>. Periods with
          actuals must reconcile to the trial balance before they can be published.
        </p>
      )}

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
                ✓ Validated {staged.rowCount} row(s)
                {staged.kind === 'financials'
                  ? ` across ${periods.length} period(s).`
                  : `: ${staged.summary.created} new, ${staged.summary.updated} updated, ${staged.summary.unchanged} unchanged.`}
              </span>
              <span className="ml-auto flex flex-wrap gap-2">
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => act('discard')}>Discard</button>
                {staged.kind === 'financials' && needsTb && (
                  <button type="button" className="btn-primary" disabled={busy || periods.some((p) => p.actualTotal !== null && !tb[p.period])} onClick={reconcile}>
                    Reconcile to TB
                  </button>
                )}
                {!makerChecker && (
                  <button type="button" className="btn-primary" disabled={busy || !reconciled || Boolean(nothingToChange)} onClick={() => act('publish')}>
                    Publish
                  </button>
                )}
              </span>
            </div>
          )}
          {staged.status === 'Validated' && makerChecker && (staged.kind !== 'financials' || !needsTb) && (
            <p className="text-sm text-muted">
              {nothingToChange
                ? 'Nothing would change — discard this upload.'
                : 'Submitted for approval. Maker-checker is on: another Finance user must review and publish it under “Awaiting approval”.'}
            </p>
          )}
          {staged.kind === 'financials' && staged.status === 'Validated' && periods.length > 0 && (
            <ReconTable periods={periods} recon={recon} tb={tb} onTbChange={(p, v) => setTb((t) => ({ ...t, [p]: v }))} />
          )}
          <IssueTable errors={staged.errors} warnings={staged.warnings} />
        </div>
      )}
    </div>
  );
}

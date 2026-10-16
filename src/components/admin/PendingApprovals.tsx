'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ReconTable } from './ReconTable';
import { KIND_LABEL, type Issue, type Kind, type PeriodSummary, type ReconLine } from './types';

export interface Pending {
  id: string;
  kind: Kind;
  file_name: string;
  file_sha256: string;
  uploaded_by: string;
  uploaded_at: string;
  row_count: number;
  summary: {
    created: number; updated: number; unchanged: number;
    periods?: PeriodSummary[]; reconciliation?: ReconLine[]; reconciled?: boolean; warnings?: Issue[];
  };
}

/** Checker step: review a validated upload and publish (or discard) it. */
export function PendingApprovals({ items, me, makerChecker }: { items: Pending[]; me: string; makerChecker: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [tb, setTb] = useState<Record<string, Record<string, string>>>({});

  // Preparer can (re)enter the trial balance here after leaving the upload screen
  const reconcile = async (id: string) => {
    setBusy(id);
    const res = await fetch(`/api/admin/upload/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reconcile', tb: tb[id] ?? {} }),
    });
    const data = await res.json();
    setBusy(null);
    setMsg((m) => ({
      ...m,
      [id]: res.ok
        ? { ok: data.reconciled, text: data.reconciled ? 'Reconciled to the trial balance.' : 'Does not reconcile — publishing stays blocked.' }
        : { ok: false, text: data.error ?? 'Reconciliation failed' },
    }));
    router.refresh();
  };

  const act = async (id: string, action: 'publish' | 'discard') => {
    setBusy(id);
    const res = await fetch(`/api/admin/upload/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    setBusy(null);
    const text = data.published
      ? 'Published. Changes are recorded in the audit log.'
      : action === 'discard'
        ? 'Discarded.'
        : data.error ?? (data.errors?.length ? `Blocked: ${data.errors.length} error(s) on re-validation — the batch was rejected.` : 'Publishing blocked.');
    setMsg((m) => ({ ...m, [id]: { ok: Boolean(data.published) || action === 'discard', text } }));
    router.refresh();
  };

  if (items.length === 0) return <p className="mt-2 text-sm text-muted">Nothing awaiting approval.</p>;

  return (
    <div className="mt-3 space-y-4">
      {items.map((b) => {
        const own = b.uploaded_by === me;
        const periods = b.summary.periods ?? [];
        const needsTb = periods.some((p) => p.actualTotal !== null);
        const reconciled = !needsTb || b.summary.reconciled === true;
        const blockedReason = makerChecker && own
          ? 'You uploaded this — another Finance user must publish it (segregation of duties).'
          : !reconciled
            ? 'Waiting for the preparer to reconcile it to the trial balance.'
            : null;
        return (
          <div key={b.id} className="rounded-md border border-gray-200 p-4 dark:border-gray-700">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-semibold">{KIND_LABEL[b.kind]} · {b.file_name}</div>
                <div className="text-xs text-muted">
                  Uploaded by {b.uploaded_by} on {b.uploaded_at} · {b.row_count} rows · SHA-256 {b.file_sha256.slice(0, 12)}… · Batch {b.id.slice(0, 8)}
                </div>
                {b.kind !== 'financials' && (
                  <div className="mt-1">{b.summary.created} new, {b.summary.updated} updated, {b.summary.unchanged} unchanged</div>
                )}
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" disabled={busy === b.id} onClick={() => act(b.id, 'discard')}>Discard</button>
                <button type="button" className="btn-primary" disabled={busy === b.id || Boolean(blockedReason)} onClick={() => act(b.id, 'publish')}>
                  Approve &amp; publish
                </button>
              </div>
            </div>
            {blockedReason && <p className="mt-2 text-xs text-muted">{blockedReason}</p>}
            {periods.length > 0 && (
              <div className="mt-3 space-y-2">
                {own && needsTb && !reconciled ? (
                  <>
                    <ReconTable
                      periods={periods}
                      recon={b.summary.reconciliation}
                      tb={tb[b.id]}
                      onTbChange={(p, v) => setTb((t) => ({ ...t, [b.id]: { ...(t[b.id] ?? {}), [p]: v } }))}
                    />
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={busy === b.id || periods.some((p) => p.actualTotal !== null && !tb[b.id]?.[p.period])}
                      onClick={() => reconcile(b.id)}
                    >
                      Reconcile to TB
                    </button>
                  </>
                ) : (
                  <ReconTable periods={periods} recon={b.summary.reconciliation} />
                )}
              </div>
            )}
            {msg[b.id] && (
              <p role="status" className={`mt-2 rounded-md px-3 py-2 text-sm ${msg[b.id].ok ? 'bg-brand/10 text-brand dark:text-brand-light' : 'bg-accent/10 text-accent'}`}>
                {msg[b.id].text}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';

interface Result {
  cc_code: string;
  cc_alias: string;
  bu: string;
  department: string;
  entity: string;
  owner_name: string | null;
}

export function Finder({ financeEmail }: { financeEmail: string }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Result[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults(null);
      return;
    }
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { cache: 'no-store' });
        if (res.status === 401) {
          window.location.href = '/login?reason=idle';
          return;
        }
        const data = await res.json();
        if (id === reqId.current) setResults(data.results ?? []);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setToast(`Copied ${code}`);
    setTimeout(() => setToast(null), 1800);
  };

  return (
    <div className="mt-6">
      <label htmlFor="cc-search" className="sr-only">Search cost centres</label>
      <div className="relative">
        <input
          id="cc-search"
          type="search"
          autoFocus
          autoComplete="off"
          maxLength={120}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, code, BU, owner or keyword…"
          className="surface w-full rounded-lg px-4 py-3.5 text-base shadow-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
        {loading && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-muted">Searching…</span>}
      </div>
      <p className="mt-2 text-xs text-muted">
        Tip: type parts of several words in any order — e.g. <em>chen des</em> finds <em>Design Chennai</em>.
      </p>

      <div className="mt-6 space-y-3" aria-live="polite">
        {results && results.length === 0 && !loading && (
          <div className="surface rounded-lg border-l-4 !border-l-accent p-4 text-sm">
            <strong className="text-accent">No match found.</strong> Contact Finance at{' '}
            <a className="font-semibold text-brand underline dark:text-brand-light" href={`mailto:${financeEmail}?subject=Cost%20centre%20query`}>
              {financeEmail}
            </a>
            .
          </div>
        )}
        {results?.map((r) => (
          <article key={r.cc_code} className="surface flex flex-col gap-3 rounded-lg p-4 shadow-sm sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-xl font-bold tracking-wide text-brand dark:text-brand-light sm:text-2xl">{r.cc_code}</div>
              <div className="mt-0.5 text-base font-semibold">{r.cc_alias}</div>
              <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                <div><dt className="inline">BU: </dt><dd className="inline">{r.bu}</dd></div>
                <div><dt className="inline">Dept: </dt><dd className="inline">{r.department}</dd></div>
                <div><dt className="inline">Owner: </dt><dd className="inline">{r.owner_name ?? '—'}</dd></div>
                <div><dt className="inline">Entity: </dt><dd className="inline">{r.entity}</dd></div>
              </dl>
            </div>
            <button type="button" onClick={() => copy(r.cc_code)} className="btn-primary shrink-0" aria-label={`Copy code ${r.cc_code}`}>
              Copy code
            </button>
          </article>
        ))}
      </div>

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow-lg">
          ✓ {toast}
        </div>
      )}
    </div>
  );
}

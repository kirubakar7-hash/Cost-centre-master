'use client';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';

export interface GlOption {
  gl: string;
  flagged: boolean;
  /** Number of explanations already recorded for this line and period */
  comments: number;
}

const MAX = 2000;

/**
 * Add a variance explanation (owner, backup owner, BU head, Finance).
 * Posts JSON to /api/cc/[code]/comments, then refreshes the server-rendered
 * page so the list, counts and "Explanation needed" markers update.
 */
export function CommentForm({
  code,
  period,
  periodLabel,
  options,
  defaultGl,
}: {
  code: string;
  period: string;
  periodLabel: string;
  options: GlOption[];
  defaultGl: string;
}) {
  const router = useRouter();
  const id = useId();
  const [gl, setGl] = useState(defaultGl);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const trimmed = text.trim();
  const over = trimmed.length > MAX;
  const pending = busy || refreshing;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed || over || pending) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/cc/${encodeURIComponent(code)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, glGroup: gl, comment: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMessage({ ok: false, text: data.error ?? 'Could not save the explanation. Please try again.' });
        return;
      }
      setText('');
      setMessage({ ok: true, text: `Explanation saved for ${gl}.` });
      startTransition(() => router.refresh());
    } catch {
      setMessage({ ok: false, text: 'Could not reach the server. Check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3" aria-describedby={`${id}-note`}>
      <h3 className="text-sm font-semibold">Add an explanation · {periodLabel}</h3>
      <div>
        <label htmlFor={`${id}-gl`} className="block text-xs font-medium text-muted">
          GL group
        </label>
        <select
          id={`${id}-gl`}
          value={gl}
          onChange={(e) => setGl(e.target.value)}
          className="surface mt-0.5 w-full rounded-md px-2.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        >
          {options.map((o) => (
            <option key={o.gl} value={o.gl}>
              {o.gl}
              {o.flagged ? (o.comments === 0 ? ' — over ±10%, explanation needed' : ' — over ±10%') : ''}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-text`} className="block text-xs font-medium text-muted">
          Explanation
        </label>
        <textarea
          id={`${id}-text`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          required
          aria-invalid={over || undefined}
          aria-describedby={`${id}-count`}
          placeholder="What caused the variance, and is it one-off or expected to continue?"
          className="surface mt-0.5 block w-full resize-y rounded-md px-2.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
        <p id={`${id}-count`} className={`mt-1 text-right text-xs ${over ? 'font-semibold text-accent dark:text-[#ff6b70]' : 'text-muted'}`}>
          {trimmed.length.toLocaleString('en-US')} / {MAX.toLocaleString('en-US')}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending || !trimmed || over}>
          {pending ? 'Saving…' : 'Submit'}
        </button>
        <p id={`${id}-note`} className="text-xs text-muted">
          Explanations are permanent and cannot be edited or deleted.
        </p>
      </div>
      <p role="status" aria-live="polite" className="text-sm">
        {message && (
          <span className={message.ok ? 'font-medium text-brand dark:text-brand-light' : 'font-medium text-accent dark:text-[#ff6b70]'}>
            {message.text}
          </span>
        )}
      </p>
    </form>
  );
}

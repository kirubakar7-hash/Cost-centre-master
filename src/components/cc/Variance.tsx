import { FLAG_TEXT, flagDirection, fmtPct, fmtSigned } from './format';

/** ▲ / ▼ marker for a flagged variance; the text alternative says which way. */
export function FlagMarker({ amount }: { amount: number }) {
  const over = flagDirection(amount) === 'over';
  return (
    <span className={`${FLAG_TEXT} mr-1 text-[0.7em]`} title={over ? 'Over budget by more than 10%' : 'Under budget by more than 10%'}>
      <span aria-hidden="true">{over ? '▲' : '▼'}</span>
      <span className="sr-only">{over ? 'Over budget: ' : 'Under budget: '}</span>
    </span>
  );
}

/** Variance amount, red with a marker when flagged. */
export function VarianceAmount({ amount, flagged, currency }: { amount: number; flagged: boolean; currency?: string }) {
  return (
    <span className={flagged ? `${FLAG_TEXT} font-semibold` : ''}>
      {flagged && <FlagMarker amount={amount} />}
      {fmtSigned(amount, currency)}
    </span>
  );
}

/** Variance percentage, red when flagged. */
export function VariancePct({ pct, flagged }: { pct: number | null; flagged: boolean }) {
  return <span className={flagged ? `${FLAG_TEXT} font-semibold` : ''}>{fmtPct(pct)}</span>;
}

/** "Over budget" / "Under budget" pill for flagged lines. */
export function FlagBadge({ amount }: { amount: number }) {
  const over = flagDirection(amount) === 'over';
  return (
    <span
      className={`${FLAG_TEXT} inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold dark:bg-accent/20`}
    >
      <span aria-hidden="true">{over ? '▲' : '▼'}</span>
      {over ? 'Over budget' : 'Under budget'}
    </span>
  );
}

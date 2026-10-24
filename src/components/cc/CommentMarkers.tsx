import { FLAG_TEXT } from './format';

function BubbleIcon({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" className={className} fill="currentColor">
      <path d="M2.5 2h11A1.5 1.5 0 0 1 15 3.5v7a1.5 1.5 0 0 1-1.5 1.5H6.2l-3.4 2.6a.5.5 0 0 1-.8-.4V12h.5A1.5 1.5 0 0 1 1 10.5v-7A1.5 1.5 0 0 1 2.5 2Z" />
    </svg>
  );
}

/** Number of explanations on a GL line for the selected month (brand blue — informational). */
export function CommentCount({ count, href, periodLabel }: { count: number; href: string; periodLabel: string }) {
  const label = `${count} explanation${count === 1 ? '' : 's'} for ${periodLabel}`;
  return (
    <a
      href={href}
      title={label}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand hover:underline dark:bg-brand-light/15 dark:text-brand-light"
    >
      <BubbleIcon />
      {count}
      <span className="sr-only"> {label}</span>
    </a>
  );
}

/** Red marker on a flagged line with no explanation yet (shown only to people who can add one). */
export function ExplanationNeeded({ href, glGroup }: { href: string; glGroup: string }) {
  return (
    <a
      href={href}
      className={`${FLAG_TEXT} inline-flex items-center gap-1 whitespace-nowrap rounded border border-current px-1.5 py-px text-[11px] font-semibold hover:bg-accent/10`}
    >
      <span aria-hidden="true">!</span>
      Explanation needed
      <span className="sr-only"> for {glGroup}</span>
    </a>
  );
}

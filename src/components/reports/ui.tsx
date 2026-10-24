/**
 * Building blocks for the Finance report pages. Server components only:
 * filters are plain GET forms, so every report works without client JavaScript.
 */
import Link from 'next/link';
import { auditChanges, SOD_LABEL, type SodStatus } from '@/lib/reports';

/** Brand red, reserved for exceptions (lighter in dark mode for contrast). */
export const RED = 'text-accent dark:text-[#ff6b70]';
const INPUT =
  'surface mt-1 block w-full min-w-0 rounded-md px-2.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30';
export const TABLE = 'w-full text-left text-sm';
export const THEAD = 'text-xs text-muted';
/** Table row: every cell padded the same, so top-aligned cells line up. */
export const ROW = 'border-theme border-t align-top [&>td]:py-1.5 [&>th]:py-1.5';

export function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3v12m0 0-5-5m5 5 5-5M4 19h16" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ExportButton({ href, label = 'Export to Excel' }: { href: string; label?: string }) {
  return (
    <a href={href} className="btn-primary shrink-0" download>
      <DownloadIcon />
      {label}
    </a>
  );
}

export function ReportHeader({
  title,
  description,
  control,
  exportHref,
  back = { href: '/admin/reports', label: 'Reports' },
}: {
  title: string;
  description?: React.ReactNode;
  control?: string;
  exportHref?: string;
  back?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-3xl">
        <Link href={back.href} className="text-sm text-brand hover:underline dark:text-brand-light">
          ← {back.label}
        </Link>
        <h1 className="heading mt-1 break-words text-2xl sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        {control && (
          <p className="mt-1 text-xs text-muted">
            <span className="font-semibold">Control:</span> {control}
          </p>
        )}
      </div>
      {exportHref && <ExportButton href={exportHref} />}
    </div>
  );
}

/** A GET form: submitting it reloads the page with the filters in the URL. */
export function FilterForm({ action, resetHref, children }: { action: string; resetHref?: string; children: React.ReactNode }) {
  return (
    <form method="get" action={action} className="surface rounded-lg p-4" aria-label="Filters">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" className="btn-primary">
          Apply filters
        </button>
        <Link href={resetHref ?? action} className="btn-secondary">
          Reset
        </Link>
      </div>
    </form>
  );
}

export function TextField({ name, label, value, placeholder }: { name: string; label: string; value?: string | null; placeholder?: string }) {
  return (
    <label className="block min-w-0 text-xs font-medium text-muted">
      {label}
      <input type="search" name={name} defaultValue={value ?? ''} placeholder={placeholder} maxLength={100} className={INPUT} />
    </label>
  );
}

export function DateField({ name, label, value }: { name: string; label: string; value?: string | null }) {
  return (
    <label className="block min-w-0 text-xs font-medium text-muted">
      {label}
      <input type="date" name={name} defaultValue={value ?? ''} className={INPUT} />
    </label>
  );
}

export function SelectField({
  name,
  label,
  value,
  options,
  anyLabel = 'Any',
}: {
  name: string;
  label: string;
  value?: string | null;
  options: { value: string; label: string }[];
  /** First option with an empty value; null to require a choice. */
  anyLabel?: string | null;
}) {
  return (
    <label className="block min-w-0 text-xs font-medium text-muted">
      {label}
      <select name={name} defaultValue={value ?? ''} className={INPUT}>
        {anyLabel !== null && <option value="">{anyLabel}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CheckboxField({ name, label, checked }: { name: string; label: string; checked: boolean }) {
  return (
    <label className="flex items-center gap-2 self-end py-2 text-sm">
      <input type="checkbox" name={name} value="1" defaultChecked={checked} className="h-4 w-4 accent-brand" />
      {label}
    </label>
  );
}

/** Multi-select without JavaScript: a disclosure with one checkbox per value. */
export function MultiCheckField({ name, label, options, selected }: { name: string; label: string; options: string[]; selected: string[] }) {
  return (
    <div className="min-w-0 text-xs font-medium text-muted">
      <span>{label}</span>
      <details className="group relative mt-1">
        <summary className="surface flex cursor-pointer list-none items-center justify-between rounded-md px-2.5 py-2 text-sm text-[var(--text)]">
          <span className="truncate">{selected.length === 0 ? 'Any' : selected.length <= 2 ? selected.join(', ') : `${selected.length} selected`}</span>
          <span aria-hidden="true" className="ml-2 text-muted transition group-open:rotate-180">▾</span>
        </summary>
        <div className="surface mt-1 max-h-64 overflow-y-auto rounded-md p-2 shadow-sm">
          {options.length === 0 && <p className="px-1 py-1 text-muted">No values yet.</p>}
          {options.map((o) => (
            <label key={o} className="flex items-center gap-2 rounded px-1 py-1 font-mono text-xs text-[var(--text)] hover:bg-brand/10">
              <input type="checkbox" name={name} value={o} defaultChecked={selected.includes(o)} className="h-4 w-4 accent-brand" />
              {o}
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}

export function Tile({ label, value, sub, alert = false }: { label: string; value: React.ReactNode; sub?: React.ReactNode; alert?: boolean }) {
  return (
    <div className={`surface min-w-0 rounded-lg p-4 ${alert ? 'border-l-4 !border-l-accent' : ''}`}>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-1 break-words text-2xl font-semibold leading-tight ${alert ? RED : 'text-brand dark:text-brand-light'}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Section({ title, aside, children, id }: { title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section className="surface min-w-0 rounded-lg p-4 sm:p-5" aria-labelledby={id}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="heading text-lg">
          {title}
        </h2>
        {aside && <div className="text-xs text-muted">{aside}</div>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Previous / next links that keep the current filters. */
export function Pagination({ path, query, page, pageSize, total }: { path: string; query: string; page: number; pageSize: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => `${path}?${query ? `${query}&` : ''}page=${p}`;
  const link = 'rounded-md border border-brand px-3 py-1.5 font-semibold text-brand hover:bg-brand/10 dark:border-brand-light dark:text-brand-light';
  const off = 'rounded-md border border-[var(--border)] px-3 py-1.5 text-muted';
  return (
    <nav className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm" aria-label="Pagination">
      <span className="text-muted">
        Page {Math.min(page, pages)} of {pages}
      </span>
      <div className="flex gap-2">
        {page > 1 ? <Link href={href(1)} className={link}>« First</Link> : <span className={off}>« First</span>}
        {page > 1 ? <Link href={href(Math.min(page, pages) - 1)} className={link}>‹ Previous</Link> : <span className={off}>‹ Previous</span>}
        {page < pages ? <Link href={href(page + 1)} className={link}>Next ›</Link> : <span className={off}>Next ›</span>}
      </div>
    </nav>
  );
}

const MAX_SHOWN = 160;
function Val({ v, muted = false }: { v: string | null; muted?: boolean }) {
  if (v === null || v === '') return <em className="text-muted">blank</em>;
  const short = v.length > MAX_SHOWN ? `${v.slice(0, MAX_SHOWN)}…` : v;
  return (
    <span className={`break-words ${muted ? 'text-muted' : ''}`} title={short === v ? undefined : v}>
      {short}
    </span>
  );
}

/** Audit old/new values as "field: old → new" lines. */
export function Changes({ oldValue, newValue }: { oldValue: unknown; newValue: unknown }) {
  const changes = auditChanges(oldValue, newValue);
  if (changes.length === 0) return <span className="text-muted">—</span>;
  return (
    <ul className="space-y-0.5 [overflow-wrap:anywhere]">
      {changes.map((c) => (
        <li key={c.field}>
          <span className="font-medium">{c.field}</span>:{' '}
          {c.kind === 'added' ? (
            <Val v={c.after} />
          ) : (
            <>
              <Val v={c.before} muted /> <span aria-label="changed to">→</span>{' '}
              {c.kind === 'removed' ? <em className="text-muted">removed</em> : <Val v={c.after} />}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

export function SodBadge({ status }: { status: SodStatus }) {
  const cls =
    status === 'violation'
      ? `${RED} bg-accent/10 font-semibold dark:bg-accent/20`
      : status === 'ok'
        ? 'bg-brand/10 font-semibold text-brand dark:text-brand-light'
        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300';
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${cls}`}>{SOD_LABEL[status]}</span>;
}

export function Pill({ children, alert = false }: { children: React.ReactNode; alert?: boolean }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${
        alert ? `${RED} bg-accent/10 dark:bg-accent/20` : 'bg-brand/10 text-brand dark:text-brand-light'
      }`}
    >
      {children}
    </span>
  );
}

export function EmptyRow({ colSpan, children = 'Nothing matches these filters.' }: { colSpan: number; children?: React.ReactNode }) {
  return (
    <tr className="border-theme border-t">
      <td colSpan={colSpan} className="py-3 text-muted">
        {children}
      </td>
    </tr>
  );
}

/** Short batch id (first 8 hex digits) linking to the batch evidence page. */
export function BatchLink({ id }: { id: string }) {
  return (
    <Link href={`/admin/reports/uploads/${id}`} className="font-mono text-xs text-brand hover:underline dark:text-brand-light" title={id}>
      {id.slice(0, 8)}
    </Link>
  );
}

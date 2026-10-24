'use client';
import { useSyncExternalStore } from 'react';
import { fmtTimestampUtc } from './format';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const subscribe = () => () => {};

/** "24 Oct 2026, 19:35 GMT+5:30" in the viewer's own time zone (fixed month names). */
function fmtLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZoneName: 'short' }).formatToParts(d);
  const zone = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${p2(d.getHours())}:${p2(d.getMinutes())}${zone ? ` ${zone}` : ''}`;
}

/**
 * A timestamp shown in the viewer's local time. The server renders UTC (it
 * cannot know the viewer's zone); the browser switches to local time after
 * hydration without a mismatch.
 */
export function LocalTime({ iso, className }: { iso: string; className?: string }) {
  const text = useSyncExternalStore(subscribe, () => fmtLocal(iso), () => fmtTimestampUtc(iso));
  return (
    <time dateTime={iso} title={fmtTimestampUtc(iso)} className={className}>
      {text}
    </time>
  );
}

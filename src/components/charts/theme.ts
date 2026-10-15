'use client';
import { useSyncExternalStore } from 'react';

/**
 * Chart colours (SolidPro brand). Two series in an emphasis pairing:
 * Actual = brand blue (the subject), Budget = brand grey (the reference).
 * Dark mode uses its own validated steps, not an automatic flip:
 *  - light on #ffffff:  #16469D vs #939597  (CVD ΔE 26.9, contrast ≥ 3:1)
 *  - dark  on #151f35:  #4F7FD6 vs #939597  (CVD ΔE 13.8, normal ΔE 15.3, contrast ≥ 3:1)
 * Brand red is reserved for variance flags.
 */
export const CHART_THEME = {
  light: {
    actual: '#16469D',
    budget: '#939597',
    flag: '#E01A22',
    surface: '#ffffff',
    grid: '#e3e6ec',
    axis: '#6b6e73',
    text: '#1b2333',
    cursor: 'rgba(22, 70, 157, 0.06)',
  },
  dark: {
    actual: '#4F7FD6',
    budget: '#939597',
    flag: '#FF6B70',
    surface: '#151f35',
    grid: '#26324d',
    axis: '#a9b1c2',
    text: '#e8ecf4',
    cursor: 'rgba(79, 127, 214, 0.12)',
  },
} as const;

export type ChartTheme = (typeof CHART_THEME)['light' | 'dark'];

function subscribe(onChange: () => void) {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => obs.disconnect();
}

/** Follows the app's `.dark` class on <html> (set by ThemeToggle / the pre-paint script). */
export function useChartTheme(): ChartTheme {
  const dark = useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains('dark'),
    () => false,
  );
  return dark ? CHART_THEME.dark : CHART_THEME.light;
}

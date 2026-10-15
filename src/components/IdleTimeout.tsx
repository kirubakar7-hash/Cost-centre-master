'use client';
import { useEffect } from 'react';

/** Signs the user out after 30 minutes without keyboard/mouse/touch activity. */
export function IdleTimeout({ minutes = 30 }: { minutes?: number }) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        window.location.href = '/logout?reason=idle';
      }, minutes * 60 * 1000);
    };
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [minutes]);
  return null;
}

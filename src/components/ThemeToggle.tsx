'use client';

export function ThemeToggle() {
  const toggle = () => {
    const dark = document.documentElement.classList.toggle('dark');
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch {}
  };
  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-md border border-gray-200 p-1.5 text-brand hover:bg-gray-50"
      aria-label="Toggle light or dark mode"
      title="Toggle light / dark mode"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" />
      </svg>
    </button>
  );
}

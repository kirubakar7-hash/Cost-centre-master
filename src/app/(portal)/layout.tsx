import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { Footer } from '@/components/Footer';
import { ThemeToggle } from '@/components/ThemeToggle';
import { IdleTimeout } from '@/components/IdleTimeout';
import { demoLoginEnabled } from '@/lib/config';
import { requireUser, roleLabel } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const nav = [
    { href: '/', label: 'Cost Centre Finder', show: true },
    { href: '/my', label: 'My Cost Centres', show: user.primaryRole !== 'Employee' },
    { href: '/admin', label: 'Admin', show: user.isFinance },
    { href: '/admin/reports', label: 'Reports', show: user.isFinance },
  ];
  return (
    <div className="flex min-h-screen flex-col">
      {demoLoginEnabled() && (
        <div className="bg-accent px-4 py-1 text-center text-xs font-semibold text-white">
          DEMO MODE — demo sign-in is enabled. Disable AUTH_DEMO_MODE before go-live.
        </div>
      )}
      {/* Brand rule: logo on a white header in both light and dark mode */}
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white text-gray-800 shadow-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="shrink-0" aria-label="Home">
            <Logo height={34} />
          </Link>
          <span className="hidden border-l border-gray-200 pl-4 text-sm font-semibold text-brand sm:inline">
            Cost Centre Portal
          </span>
          <nav className="order-3 flex w-full gap-1 overflow-x-auto text-sm sm:order-none sm:w-auto">
            {nav.filter((n) => n.show).map((n) => (
              <Link key={n.href} href={n.href} className="rounded-md px-3 py-1.5 font-medium text-brand hover:bg-brand/10">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-right">
            <div className="leading-tight">
              <div className="text-sm font-medium">{user.name}</div>
              <div className="text-xs text-muted">{roleLabel(user.primaryRole)}</div>
            </div>
            <ThemeToggle />
            <a href="/logout" className="text-xs font-semibold text-brand hover:underline">
              Sign out
            </a>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-10">{children}</main>
      <Footer />
      <IdleTimeout />
    </div>
  );
}

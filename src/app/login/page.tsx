import { redirect } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { Footer } from '@/components/Footer';
import { auth, signIn } from '@/lib/auth';
import { allowedDomains, demoLoginEnabled, entraConfigured } from '@/lib/config';
import { DEMO_USERS } from '@/lib/db/seed';

export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, string> = {
  AccessDenied: 'Access denied. Sign in with your SolidPro company Microsoft account.',
  idle: 'You were signed out after 30 minutes of inactivity.',
  signout: 'You have signed out.',
};

function safeCallback(url: string | undefined) {
  return url && url.startsWith('/') && !url.startsWith('//') ? url : '/';
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  if ((await auth())?.user) redirect('/');
  const callbackUrl = safeCallback(sp.callbackUrl);
  const msg = MESSAGES[sp.error ?? ''] ?? MESSAGES[sp.reason ?? ''] ?? (sp.error ? 'Sign-in failed. Please try again.' : null);

  async function microsoft() {
    'use server';
    await signIn('microsoft-entra-id', { redirectTo: callbackUrl });
  }
  async function demo(formData: FormData) {
    'use server';
    if (!demoLoginEnabled()) return;
    await signIn('demo', { email: String(formData.get('email')), redirectTo: callbackUrl });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="surface w-full max-w-md rounded-xl p-8 shadow-sm">
          <div className="rounded-md bg-white p-3">
            <Logo height={44} />
          </div>
          <h1 className="heading mt-6 text-xl">Cost Centre Portal</h1>
          <p className="mt-1 text-sm text-muted">Sign in with your SolidPro Microsoft 365 account.</p>
          {msg && (
            <p role="alert" className={`mt-4 rounded-md px-3 py-2 text-sm ${sp.error ? 'bg-accent/10 text-accent' : 'bg-brand/10 text-brand dark:text-brand-light'}`}>
              {msg}
            </p>
          )}
          <form action={microsoft} className="mt-6">
            <button type="submit" className="btn-primary w-full py-3" disabled={!entraConfigured()}>
              <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
              Sign in with Microsoft
            </button>
          </form>
          {!entraConfigured() && (
            <p className="mt-2 text-xs text-muted">Microsoft sign-in is not configured yet (see README → SSO setup).</p>
          )}
          <p className="mt-4 text-xs text-muted">
            Only {allowedDomains().map((d) => `@${d}`).join(', ')} accounts are allowed. No self-registration.
          </p>

          {demoLoginEnabled() && (
            <form action={demo} className="mt-8 border-t border-dashed border-gray-300 pt-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-accent">Demo mode — sign in as</p>
              <div className="mt-3 grid gap-2">
                {DEMO_USERS.map((u) => (
                  <button key={u.email} name="email" value={u.email} className="btn-secondary justify-between text-left">
                    <span>{u.name}</span>
                    <span className="text-xs font-normal text-muted">{u.role}</span>
                  </button>
                ))}
              </div>
            </form>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

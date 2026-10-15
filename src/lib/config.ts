export const SESSION_IDLE_SECONDS = 30 * 60; // idle timeout (rolling)
export const SESSION_ABSOLUTE_SECONDS = 10 * 60 * 60; // forced re-login after 10h

export function allowedDomains(): string[] {
  return (process.env.ALLOWED_EMAIL_DOMAINS ?? 'solidpro-es.com')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return false;
  return allowedDomains().includes(e.slice(at + 1));
}

export const financeContactEmail = () => process.env.FINANCE_CONTACT_EMAIL ?? 'finance@solidpro-es.com';

/**
 * Demo login (pick a seeded user, no password). Only ever available against the
 * embedded PGlite demo database — never when DATABASE_URL points at real data,
 * and never on a Vercel production deployment.
 */
export function demoLoginEnabled(): boolean {
  return (
    process.env.AUTH_DEMO_MODE === 'true' && !process.env.DATABASE_URL && process.env.VERCEL_ENV !== 'production'
  );
}

/** SSO is only offered when the tenant is pinned (fail closed: no multi-tenant "common" endpoint). */
export function entraConfigured(): boolean {
  return Boolean(
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID &&
      process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET &&
      process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID,
  );
}

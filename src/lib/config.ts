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

/** Demo login (pick a seeded user) — never available on a Vercel production deployment. */
export function demoLoginEnabled(): boolean {
  return process.env.AUTH_DEMO_MODE === 'true' && process.env.VERCEL_ENV !== 'production';
}

export function entraConfigured(): boolean {
  return Boolean(process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET);
}

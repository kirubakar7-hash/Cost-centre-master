import NextAuth from 'next-auth';
import { authConfig } from './auth.config';
import { isAllowedEmail } from './config';

async function logEvent(email: string, action: string, detail: Record<string, unknown>) {
  try {
    const { withUser } = await import('./db');
    await withUser(email, (tx) => tx.query(`select ccp.log_event($1, 'session', null, $2::jsonb)`, [action, JSON.stringify(detail)]));
  } catch (err) {
    console.error('audit log failed', err);
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async signIn(params) {
      const ok = await authConfig.callbacks.signIn(params);
      const email = params.user?.email?.toLowerCase();
      if (!ok && email && email.includes('@')) {
        await logEvent(email, 'LOGIN_DENIED', { provider: params.account?.provider, domainAllowed: isAllowedEmail(email) });
      }
      return ok;
    },
  },
  events: {
    async signIn({ user, account }) {
      if (user.email) await logEvent(user.email, 'LOGIN', { provider: account?.provider });
    },
  },
});

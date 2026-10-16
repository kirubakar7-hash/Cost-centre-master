/**
 * Auth.js configuration without database access (safe to import in proxy.ts).
 */
import type { NextAuthConfig } from 'next-auth';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import Credentials from 'next-auth/providers/credentials';
import { DEMO_USERS } from './db/seed';
import { SESSION_ABSOLUTE_SECONDS, SESSION_IDLE_SECONDS, demoLoginEnabled, isAllowedEmail } from './config';

const tenantId = process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID;

const providers: NextAuthConfig['providers'] = [
  MicrosoftEntraID({
    // Single-tenant issuer: only accounts from the SolidPro Entra tenant can sign in.
    issuer: `https://login.microsoftonline.com/${tenantId ?? 'tenant-id-not-configured'}/v2.0`,
    authorization: { params: { scope: 'openid profile email' } },
    // Do not fetch the Graph profile photo (keeps the session cookie small).
    profile(profile) {
      const email = String(profile.email ?? profile.preferred_username ?? '').toLowerCase();
      return { id: String(profile.sub ?? profile.oid), name: String(profile.name ?? email), email };
    },
  }),
];

if (demoLoginEnabled()) {
  providers.push(
    Credentials({
      id: 'demo',
      name: 'Demo user',
      credentials: { email: { label: 'Email' } },
      authorize(creds) {
        const email = String(creds?.email ?? '').toLowerCase();
        const user = DEMO_USERS.find((u) => u.email === email);
        return user ? { id: user.email, email: user.email, name: user.name } : null;
      },
    }),
  );
}

export const authConfig = {
  providers,
  pages: { signIn: '/login', error: '/login' },
  session: { strategy: 'jwt', maxAge: SESSION_IDLE_SECONDS },
  trustHost: true,
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === 'microsoft-entra-id') {
        // Fail closed: token must come from our tenant (blocks the "nOAuth" email-claim trick)
        if (!tenantId || (profile as { tid?: string } | undefined)?.tid !== tenantId) return false;
      }
      if (account?.provider === 'demo' && !demoLoginEnabled()) return false;
      return isAllowedEmail(user?.email);
    },
    async jwt({ token, user }) {
      const now = Math.floor(Date.now() / 1000);
      if (user) {
        token.email = user.email?.toLowerCase();
        token.name = user.name;
        token.loginAt = now;
      }
      if (!token.email || !isAllowedEmail(token.email)) return null;
      if (typeof token.loginAt === 'number' && now - token.loginAt > SESSION_ABSOLUTE_SECONDS) return null;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = token.email as string;
        session.user.name = token.name as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

/**
 * Runs before every request: enforces sign-in, rolls the 30-minute idle
 * session, and sets security headers (nonce-based CSP, HSTS, no framing).
 */
import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from '@/lib/auth.config';

const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = ['/login', '/api/auth'];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!req.auth && !isPublic) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    }
    const url = new URL('/login', req.nextUrl.origin);
    if (pathname !== '/') url.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self' https://login.microsoftonline.com`,
    `frame-ancestors 'none'`,
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|solidpro-logo.png|solidpro-mark.png).*)'],
};

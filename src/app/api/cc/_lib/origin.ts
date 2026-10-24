/**
 * CSRF defence for state-changing endpoints (private folder: not a route).
 *
 * The session cookie is SameSite=Lax, which already stops cross-site POSTs
 * carrying it. As a second layer, a request is refused when the browser says
 * it came from another site: an Origin header whose host differs from the
 * request's host, an opaque "null" Origin, or Sec-Fetch-Site cross-site /
 * same-site. Requests without these headers (non-browser clients) still need
 * a valid session cookie.
 */
export function isCrossOrigin(headers: Headers, authUrl: string | undefined = process.env.AUTH_URL): boolean {
  const site = headers.get('sec-fetch-site');
  if (site === 'cross-site' || site === 'same-site') return true;

  const origin = headers.get('origin');
  if (origin === null) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return true; // "null" (sandboxed iframe, data: URL) or malformed
  }
  if (!originHost) return true;

  const allowed = new Set<string>();
  const add = (h: string | null | undefined) => {
    const v = h?.split(',')[0]?.trim().toLowerCase();
    if (v) allowed.add(v);
  };
  add(headers.get('host'));
  add(headers.get('x-forwarded-host'));
  if (authUrl) {
    try {
      add(new URL(authUrl).host);
    } catch {
      /* ignore a malformed AUTH_URL here; Auth.js reports it */
    }
  }
  return !allowed.has(originHost);
}

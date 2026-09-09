/**
 * Vercel Edge Middleware — basic-auth gate on every request to the dashboard.
 *
 * This protects the dashboard URL with a username/password challenge that runs
 * at the CDN edge, BEFORE any HTML or JSON is served. Even attempts to fetch
 * /data/*.json directly will hit this.
 *
 * Security notes:
 *  - Credentials live in Vercel Environment Variables (encrypted at rest).
 *  - Comparison is constant-time to avoid timing side-channel leaks.
 *  - HTTPS is enforced by Vercel and the HSTS header in vercel.json.
 *  - Browsers cache Basic-Auth credentials per origin — so a single login per
 *    session, no cookies to manage.
 *
 *  For a stronger gate, swap this for Cloudflare Access or Vercel Pro's
 *  Password Protection. Either is a drop-in replacement; this is the free path.
 */

import { next } from '@vercel/edge';

export const config = {
  // Apply to all routes except Vercel internals and the favicon
  matcher: '/((?!_vercel|favicon).*)',
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export default function middleware(request: Request) {
  const auth = request.headers.get('authorization');
  const expectedUser = process.env.DASHBOARD_USER;
  const expectedPass = process.env.DASHBOARD_PASS;

  // Fail closed: if creds aren't set, deny everything.
  if (!expectedUser || !expectedPass) {
    return new Response('Dashboard auth not configured', { status: 503 });
  }

  if (auth?.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6));
      const idx = decoded.indexOf(':');
      const user = idx >= 0 ? decoded.slice(0, idx) : decoded;
      const pass = idx >= 0 ? decoded.slice(idx + 1) : '';
      if (timingSafeEqual(user, expectedUser) && timingSafeEqual(pass, expectedPass)) {
        return next();
      }
    } catch {
      // fall through to 401
    }
  }

  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Health Dashboard"',
      'Cache-Control': 'no-store',
    },
  });
}

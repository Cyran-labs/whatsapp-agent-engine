import createMiddleware from 'next-intl/middleware';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { routing } from './i18n/routing';
import { ACCESS_COOKIE } from './lib/session';

const intl = createMiddleware(routing);

const PUBLIC_SEGMENTS = ['login', 'accept-invite', 'forbidden'];

type Locale = (typeof routing.locales)[number];
const isLocale = (s: string | undefined): s is Locale =>
  routing.locales.includes(s as Locale);

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const segments = pathname.split('/').filter(Boolean); // [locale, ...rest]
  const locale = isLocale(segments[0]) ? segments[0] : routing.defaultLocale;
  const rest = isLocale(segments[0]) ? segments.slice(1) : segments;
  const isPublic = rest.length === 0 ? false : PUBLIC_SEGMENTS.includes(rest[0]);

  if (!isPublic && !request.cookies.get(ACCESS_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/login`;
    return NextResponse.redirect(url);
  }
  return intl(request);
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};

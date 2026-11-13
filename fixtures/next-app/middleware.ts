import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (pathname === '/mw-redirect') return NextResponse.redirect(new URL('/about', request.url))
  if (pathname === '/mw-rewrite') return NextResponse.rewrite(new URL('/dashboard', request.url))
  if (pathname === '/mw-blocked') return new NextResponse('blocked by middleware', { status: 403 })
  const response = NextResponse.next()
  response.cookies.set('mw-visited', 'yes')
  response.headers.set('x-noru-middleware', 'ran')
  return response
}

export const config = {
  matcher: ['/((?!api|_next/static|favicon.ico).*)'],
}

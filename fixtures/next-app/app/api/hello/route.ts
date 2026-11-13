import { NextResponse, type NextRequest } from 'next/server'
import { cookies, headers } from 'next/headers'

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get('name') ?? 'world'
  const cookieStore = await cookies()
  const headerList = await headers()
  return NextResponse.json({
    hello: name,
    // Server-side code sees every .env variable, not only NEXT_PUBLIC_*.
    secret: process.env.SECRET_TOKEN,
    visited: cookieStore.get('mw-visited')?.value ?? 'no',
    agent: headerList.has('user-agent'),
  })
}

export async function POST(request: Request) {
  const body = await request.json()
  const response = NextResponse.json({ received: body }, { status: 201 })
  response.cookies.set('posted', 'yes')
  ;(await cookies()).set('via-headers', 'yes')
  return response
}

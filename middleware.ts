import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
    // 1. Check if password gate is disabled via env var
    if (process.env.DISABLE_PASSWORD_GATE === '1') {
        return NextResponse.next()
    }

    // 2. Define paths that don't satisfy the "site-wide" password gate
    // - /unlock (the page to enter password)
    // - /_next/* (Next.js assets)
    // - /favicon.ico, /robots.txt, /sitemap.xml (Public files)
    // - /api/* (API routes are protected separately or public, EXCEPT /api/rewrite which uses the cookie too)
    //   Wait, user requirement 3 says: "/api/* (allow API routes; BUT protect /api/rewrite by requiring auth cookie too)"
    //   So middleware should ALLOW /api/* through to the route handlers.

    const { pathname } = request.nextUrl

    // Check for public paths
    if (
        pathname.startsWith('/_next') ||
        pathname.startsWith('/api') ||
        pathname === '/unlock' ||
        pathname === '/favicon.ico' ||
        pathname === '/robots.txt' ||
        pathname === '/sitemap.xml'
    ) {
        return NextResponse.next()
    }

    // 3. Check for authentication cookie
    const authCookie = request.cookies.get('cms_auth')
    const isAuthenticated = authCookie?.value === '1'

    // 4. Redirect if not authenticated
    if (!isAuthenticated) {
        const unlockUrl = new URL('/unlock', request.url)
        // Add ?next=/original-path to redirect back after login
        unlockUrl.searchParams.set('next', pathname)
        return NextResponse.redirect(unlockUrl)
    }

    return NextResponse.next()
}

// Configure middleware to match all paths except static assets (handled by logic above, but good for perf)
export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        '/((?!_next/static|_next/image|favicon.ico).*)',
    ],
}

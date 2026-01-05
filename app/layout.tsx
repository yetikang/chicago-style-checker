import type { Metadata } from 'next'
import { Inter, Crimson_Pro } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const crimsonPro = Crimson_Pro({
  subsets: ['latin'],
  variable: '--font-crimson-pro',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Chicago Style Checker (Beta)',
  description: 'CMoS-informed paragraph-level copyediting',
}

import { SessionProvider } from '@/lib/session-store'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.variable} ${crimsonPro.variable}`}>
      <head>
        <meta name="robots" content="noindex, nofollow" />
      </head>
      <body className="antialiased min-h-screen selection:bg-red-100 selection:text-red-900">
        <SessionProvider>
          {children}
        </SessionProvider>
      </body>
    </html>
  )
}

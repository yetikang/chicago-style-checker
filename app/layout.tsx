import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Chicago Style Checker (Beta)',
  description: 'CMoS-informed paragraph-level copyediting',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <meta name="robots" content="noindex, nofollow" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  )
}

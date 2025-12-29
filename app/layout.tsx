import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Chicago Style Checker',
  description: 'CMoS-informed paragraph-level copyediting',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  )
}



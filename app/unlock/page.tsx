'use client'

import React, { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { verifyPassword } from './actions'

function UnlockForm() {
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const router = useRouter()
    const searchParams = useSearchParams()
    const nextUrl = searchParams.get('next') || '/'

    async function handleSubmit(formData: FormData) {
        setLoading(true)
        setError(null)

        try {
            const result = await verifyPassword(formData)
            if (result.success) {
                router.push(nextUrl)
            } else {
                setError(result.error || 'Invalid password')
            }
        } catch (e) {
            setError('An error occurred. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="bg-white p-10 rounded-sm border border-gray-100 shadow-sm max-w-md w-full">
            <div className="flex flex-col items-center mb-10">
                <svg
                    className="w-10 h-10 text-brand-red mb-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                    />
                </svg>
                <h1 className="text-2xl font-academic font-normal text-gray-900 text-center tracking-tight">
                    Chicago Style Checker <span className="text-base text-gray-400 font-ui font-light">(Beta)</span>
                </h1>
                <p className="text-gray-500 font-ui text-[13px] mt-3 text-center uppercase tracking-widest font-medium">
                    Private Beta Access
                </p>
            </div>

            <form action={handleSubmit} className="space-y-6">
                <div>
                    <input
                        name="password"
                        type="password"
                        placeholder="Access Identifier"
                        required
                        autoFocus
                        className="w-full p-4 border border-gray-200 rounded-sm focus:outline-none focus:border-brand-red/30 focus:ring-0 font-academic text-lg transition-all placeholder:text-gray-300"
                    />
                </div>

                {error && (
                    <div className="text-red-800 text-xs bg-red-50 p-3 rounded-sm border border-red-100 font-ui">
                        {error}
                    </div>
                )}

                <button
                    type="submit"
                    disabled={loading}
                    className={`w-full py-4 rounded-sm text-white font-ui uppercase tracking-[0.2em] text-xs font-semibold shadow-sm transition-all ${loading ? 'bg-gray-200 cursor-not-allowed text-gray-400' : 'bg-brand-red hover:bg-brand-red-dark active:scale-[0.99]'
                        }`}
                >
                    {loading ? 'Verifying...' : 'Authorize Access'}
                </button>
            </form>
        </div>
    )
}

export default function UnlockPage() {
    return (
        <div className="min-h-screen bg-[#fcfbf7] flex flex-col items-center justify-center p-6">
            <Suspense fallback={<div className="font-ui text-xs uppercase tracking-widest text-gray-400 animate-pulse">Initializing...</div>}>
                <UnlockForm />
            </Suspense>
        </div>
    )
}

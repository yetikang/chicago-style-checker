'use client'

import React, { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { verifyPassword } from './actions'

export default function UnlockPage() {
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
                // Redirect to original destination
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
        <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
            <div className="bg-white p-8 rounded border border-gray-200 shadow-sm max-w-md w-full">
                <div className="flex flex-col items-center mb-6">
                    <svg
                        className="w-10 h-10 text-brand-red mb-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                        />
                    </svg>
                    <h1 className="text-2xl font-serif text-gray-900 text-center">
                        Chicago Style Checker (Beta)
                    </h1>
                    <p className="text-gray-600 text-sm mt-2 text-center">
                        This is a private beta. Enter the access password.
                    </p>
                </div>

                <form action={handleSubmit} className="space-y-4">
                    <div>
                        <input
                            name="password"
                            type="password"
                            placeholder="Password"
                            required
                            autoFocus
                            className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-brand-red focus:border-transparent font-serif"
                        />
                    </div>

                    {error && (
                        <div className="text-red-700 text-sm bg-red-50 p-2 rounded border border-red-100">
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className={`w-full py-3 rounded text-white transition-colors ${loading ? 'bg-gray-400' : 'bg-brand-red hover:bg-brand-red-dark'
                            }`}
                    >
                        {loading ? 'Verifying...' : 'Enter'}
                    </button>
                </form>
            </div>
        </div>
    )
}

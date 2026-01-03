'use server'

import { cookies } from 'next/headers'

export async function verifyPassword(formData: FormData) {
    const password = formData.get('password') as string
    const expectedPassword = process.env.SITE_PASSWORD

    if (!expectedPassword) {
        console.error('SITE_PASSWORD environment variable is not set!')
        return { success: false, error: 'Configuration error. Please contact the administrator.' }
    }

    if (password === expectedPassword) {
        // Set cookie
        cookies().set('cms_auth', '1', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 30 * 24 * 60 * 60, // 30 days
            path: '/',
        })
        return { success: true }
    }

    return { success: false, error: 'Incorrect password. access denied.' }
}

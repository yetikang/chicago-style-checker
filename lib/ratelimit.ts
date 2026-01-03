import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomUUID } from 'crypto';

// Types
export type RateLimitScope = 'global_min' | 'user_30s' | 'user_day';

export interface RateLimitResult {
    ok: boolean;
    scope?: RateLimitScope;
    retryAfterSeconds?: number;
}

// Config
const GLOBAL_RPM = parseInt(process.env.RATE_GLOBAL_RPM || '9', 10);
const USER_RPD = parseInt(process.env.RATE_USER_RPD || '20', 10);
const USER_30S = parseInt(process.env.RATE_USER_30S || '1', 10);
const RATE_TZ = process.env.RATE_TZ || 'America/Los_Angeles';

// In-memory fallback
const memoryCache = new Map<string, { count: number; expires: number }>();

// Upstash Helper
async function fetchUpstash(command: string[]) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) return null;

    try {
        const response = await fetch(`${url}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(command),
        });
        const data = await response.json();
        return data.result;
    } catch (error) {
        console.error('Upstash Redis error:', error);
        return null;
    }
}

/**
 * Anonymous ID management
 */
export function getOrSetAnonId(req: NextRequest): string {
    const cookieStore = cookies();
    const existingId = cookieStore.get('anon_id')?.value;

    if (existingId) return existingId;

    const newId = randomUUID();
    // Note: We can only set cookies on the RESPONSE. 
    // This helper should be used in conjunction with setting the header later if new.
    return newId;
}

export function setAnonIdCookie(response: NextResponse, id: string) {
    const isProd = process.env.NODE_ENV === 'production';
    response.cookies.set('anon_id', id, {
        path: '/',
        maxAge: 180 * 24 * 60 * 60, // 180 days
        sameSite: 'lax',
        secure: isProd,
        httpOnly: true,
    });
}

/**
 * Rate Limit Logic
 */
export async function consumeExpensiveCall(anonId: string): Promise<RateLimitResult> {
    const now = Math.floor(Date.now() / 1000);

    // Buckets
    const bucket30s = Math.floor(now / 30);
    const bucketMin = Math.floor(now / 60);

    // Date in TZ
    const dateStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: RATE_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());

    const keys = {
        u30: `rl:u30:${anonId}:${bucket30s}`,
        gm: `rl:gm:${bucketMin}`,
        ud: `rl:ud:${anonId}:${dateStr}`,
    };

    const hasUpstash = !!process.env.UPSTASH_REDIS_REST_URL;

    if (hasUpstash) {
        // Pipeline or parallel requests to Upstash
        // 1. Check Global Min
        const gmCount = await fetchUpstash(['INCR', keys.gm]) as number;
        if (gmCount === 1) await fetchUpstash(['EXPIRE', keys.gm, '180']);
        if (gmCount > GLOBAL_RPM) return { ok: false, scope: 'global_min', retryAfterSeconds: 60 - (now % 60) };

        // 2. Check User 30s
        const u30Count = await fetchUpstash(['INCR', keys.u30]) as number;
        if (u30Count === 1) await fetchUpstash(['EXPIRE', keys.u30, '90']);
        if (u30Count > USER_30S) return { ok: false, scope: 'user_30s', retryAfterSeconds: 30 - (now % 30) };

        // 3. Check User Daily
        const udCount = await fetchUpstash(['INCR', keys.ud]) as number;
        if (udCount === 1) await fetchUpstash(['EXPIRE', keys.ud, '172800']); // 48h
        if (udCount > USER_RPD) {
            // Find seconds until tomorrow in TZ
            const tzNow = new Date(new Date().toLocaleString('en-US', { timeZone: RATE_TZ }));
            const tzMidnight = new Date(tzNow);
            tzMidnight.setHours(24, 0, 0, 0);
            const secondsUntilReset = Math.floor((tzMidnight.getTime() - tzNow.getTime()) / 1000);
            return { ok: false, scope: 'user_day', retryAfterSeconds: secondsUntilReset };
        }

        return { ok: true };
    } else {
        // Best-effort in-memory (per instance)
        const checkMem = (key: string, limit: number, ttl: number, scope: RateLimitScope): RateLimitResult | null => {
            const entry = memoryCache.get(key) || { count: 0, expires: now + ttl };
            if (now > entry.expires) {
                entry.count = 0;
                entry.expires = now + ttl;
            }
            entry.count++;
            memoryCache.set(key, entry);

            if (entry.count > limit) {
                return { ok: false, scope, retryAfterSeconds: entry.expires - now };
            }
            return null;
        };

        const r1 = checkMem(keys.gm, GLOBAL_RPM, 60, 'global_min');
        if (r1) return r1;
        const r2 = checkMem(keys.u30, USER_30S, 30, 'user_30s');
        if (r2) return r2;
        const r3 = checkMem(keys.ud, USER_RPD, 86400, 'user_day');
        if (r3) {
            // Memory fallback approximation
            return r3;
        }

        return { ok: true };
    }
}

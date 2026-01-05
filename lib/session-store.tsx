'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { Session, HistoryItem, RewriteResponse } from '@/types'

interface SessionContextType {
    session: Session | null
    pushHistory: (input: string, output: RewriteResponse, provider?: string) => void
    clearSession: () => void
    touch: () => void
    isLoading: boolean
}

const SessionContext = createContext<SessionContextType | undefined>(undefined)

const DEFAULT_TTL = 2 * 60 * 60 * 1000 // 2 hours
const SESSION_KEY = 'cmos:session:v1'
const DRAFT_KEY = 'cmos:draft:v1'

export function SessionProvider({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState<Session | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

    const createNewSession = (): Session => ({
        sessionId: crypto.randomUUID(),
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        ttlMs: DEFAULT_TTL,
        history: []
    })

    const persist = (s: Session) => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = setTimeout(() => {
            localStorage.setItem(SESSION_KEY, JSON.stringify(s))
        }, 500)
    }

    useEffect(() => {
        const load = () => {
            try {
                const stored = localStorage.getItem(SESSION_KEY)
                if (stored) {
                    const parsed = JSON.parse(stored) as Session
                    const isExpired = Date.now() - parsed.lastActiveAt > parsed.ttlMs

                    if (isExpired || !parsed.sessionId) {
                        const next = createNewSession()
                        setSession(next)
                        localStorage.setItem(SESSION_KEY, JSON.stringify(next))
                    } else {
                        setSession(parsed)
                    }
                } else {
                    const next = createNewSession()
                    setSession(next)
                    localStorage.setItem(SESSION_KEY, JSON.stringify(next))
                }
            } catch (e) {
                const next = createNewSession()
                setSession(next)
            } finally {
                setIsLoading(false)
            }
        }
        load()
    }, [])

    const touch = useCallback(() => {
        setSession(prev => {
            if (!prev) return prev
            const next = { ...prev, lastActiveAt: Date.now() }
            persist(next)
            return next
        })
    }, [])

    const pushHistory = useCallback((input: string, output: RewriteResponse, provider?: string) => {
        setSession(prev => {
            if (!prev) return prev
            const newItem: HistoryItem = {
                id: crypto.randomUUID(),
                createdAt: Date.now(),
                input,
                output,
                provider
            }
            const next = {
                ...prev,
                lastActiveAt: Date.now(),
                history: [newItem, ...prev.history].slice(0, 20)
            }
            persist(next)
            return next
        })
    }, [])

    const clearSession = useCallback(() => {
        const next = createNewSession()
        setSession(next)
        localStorage.setItem(SESSION_KEY, JSON.stringify(next))
        sessionStorage.removeItem(DRAFT_KEY)
    }, [])

    return (
        <SessionContext.Provider value={{ session, pushHistory, clearSession, touch, isLoading }}>
            {children}
        </SessionContext.Provider>
    )
}

export function useSession() {
    const context = useContext(SessionContext)
    if (context === undefined) {
        throw new Error('useSession must be used within a SessionProvider')
    }
    return context
}

import { useState, useEffect } from 'react'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { getToken } from 'firebase/messaging'
import { auth, getMessagingInstance } from '@/lib/firebase'
import { useAppStore } from '@/lib/store'
import type { UserIdentity } from '@/types'
import { Tent, ShoppingCart, Loader2 } from 'lucide-react'

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string

// Shared app password is checked locally, then a Firebase anonymous-equivalent
// email/pass account is used. The email/pass combo is stored in env vars.
const FIREBASE_EMAIL = import.meta.env.VITE_APP_EMAIL as string
const FIREBASE_PASSWORD = import.meta.env.VITE_APP_PASSWORD as string
const APP_PIN = import.meta.env.VITE_APP_PIN as string

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, identity, setAuthenticated, setIdentity, setFcmToken } = useAppStore()
  const [step, setStep] = useState<'pin' | 'identity' | 'done'>('pin')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (isAuthenticated && identity) setStep('done')
    else if (isAuthenticated && !identity) setStep('identity')
  }, [isAuthenticated, identity])

  async function handlePin(e: React.FormEvent) {
    e.preventDefault()
    if (pin !== APP_PIN) { setError('Wrong password'); return }
    setLoading(true)
    try {
      await signInWithEmailAndPassword(auth, FIREBASE_EMAIL, FIREBASE_PASSWORD)
      setAuthenticated(true)
      setStep('identity')
    } catch {
      setError('Connection error — try again')
    } finally {
      setLoading(false)
    }
  }

  async function pickIdentity(id: UserIdentity) {
    setIdentity(id)
    setStep('done')
    try {
      const messaging = await getMessagingInstance()
      if (!messaging) return
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') return
      const token = await getToken(messaging, { vapidKey: VAPID_KEY })
      if (token) setFcmToken(token)
    } catch {
      // notifications not critical — silently ignore
    }
  }

  if (step === 'done') return <>{children}</>

  return (
    <div className="flex flex-col items-center justify-center min-h-dvh bg-[#1e3a5f] px-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <Tent className="w-16 h-16 text-white mb-2" strokeWidth={1.5} />
          <h1 className="text-3xl font-bold text-white">RV & Groceries</h1>
          <p className="text-blue-200 text-sm mt-1">Camping checklists for Diogo & Alice</p>
        </div>

        {step === 'pin' && (
          <form onSubmit={handlePin} className="bg-white rounded-2xl p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Enter app password</h2>
            <input
              type="password"
              value={pin}
              onChange={(e) => { setPin(e.target.value); setError('') }}
              placeholder="Password"
              autoComplete="current-password"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] mb-3"
            />
            {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
            <button
              type="submit"
              disabled={loading || !pin}
              className="w-full bg-[#1e3a5f] text-white py-3 rounded-xl font-semibold text-base disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Continue
            </button>
          </form>
        )}

        {step === 'identity' && (
          <div className="bg-white rounded-2xl p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-800 mb-2">Who are you?</h2>
            <p className="text-gray-500 text-sm mb-5">This device will remember your choice.</p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => pickIdentity('diogo')}
                className="flex items-center gap-3 border-2 border-[#1e3a5f] rounded-xl px-5 py-4 text-[#1e3a5f] font-semibold text-base hover:bg-blue-50 transition-colors"
              >
                <Tent className="w-5 h-5" />
                I'm Diogo
              </button>
              <button
                onClick={() => pickIdentity('alice')}
                className="flex items-center gap-3 border-2 border-pink-400 rounded-xl px-5 py-4 text-pink-600 font-semibold text-base hover:bg-pink-50 transition-colors"
              >
                <ShoppingCart className="w-5 h-5" />
                I'm Alice
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

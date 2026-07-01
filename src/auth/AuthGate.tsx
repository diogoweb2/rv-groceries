import { useState, useEffect } from 'react'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth, getMessagingInstance } from '@/lib/firebase'
import { saveFcmToken } from '@/lib/firestore'
import { useAppStore } from '@/lib/store'
import type { UserIdentity } from '@/types'
import { Tent, ShoppingCart, Loader2 } from 'lucide-react'

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string

// Obtain this device's push token and persist it mapped to the given identity so
// a Cloud Function can target the right person. `prompt` requests notification
// permission (only safe from a user gesture, e.g. picking identity); on plain app
// load we register silently and only if permission was already granted.
async function registerPushToken(
  id: UserIdentity,
  prompt: boolean,
  setFcmToken: (t: string) => void,
) {
  try {
    const messaging = await getMessagingInstance()
    if (!messaging) return
    let permission = Notification.permission
    if (permission === 'default' && prompt) permission = await Notification.requestPermission()
    if (permission !== 'granted') return
    const { getToken } = await import('firebase/messaging')
    const token = await getToken(messaging, { vapidKey: VAPID_KEY })
    if (token) {
      setFcmToken(token)
      await saveFcmToken(token, id)
    }
  } catch {
    // notifications are non-critical — silently ignore
  }
}

// Show a system notification when a push arrives while the app is foregrounded
// (FCM only auto-displays notifications when the page is backgrounded).
async function listenForegroundMessages() {
  try {
    const messaging = await getMessagingInstance()
    if (!messaging) return
    const { onMessage } = await import('firebase/messaging')
    const reg = await navigator.serviceWorker?.getRegistration()
    onMessage(messaging, (payload) => {
      const { title = 'RV & Groceries', body = '' } = payload.notification ?? {}
      if (reg) reg.showNotification(title, { body, icon: '/pwa-192x192.png', badge: '/pwa-192x192.png' })
      else if (Notification.permission === 'granted') new Notification(title, { body })
    })
  } catch {
    // non-critical
  }
}

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

  // Re-register the push token on every load for already-onboarded devices (the
  // token can rotate, and devices that signed in before this feature never saved
  // one). Also start showing foreground pushes.
  useEffect(() => {
    if (!isAuthenticated || !identity) return
    registerPushToken(identity, false, setFcmToken)
    listenForegroundMessages()
  }, [isAuthenticated, identity, setFcmToken])

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
    await registerPushToken(id, true, setFcmToken)
  }

  if (step === 'done') return <>{children}</>

  return (
    <div className="camp-sky flex flex-col items-center justify-center min-h-dvh px-6 relative overflow-hidden">
      {/* Decorative sun + hills */}
      <div className="absolute right-10 top-14 w-20 h-20 rounded-full bg-amber-100/90 blur-[1px]" aria-hidden />
      <div className="camp-hills absolute inset-x-0 bottom-0 h-40" aria-hidden />
      <div className="w-full max-w-sm relative z-10">
        <div className="flex flex-col items-center mb-8">
          <div className="bg-white/15 backdrop-blur-sm rounded-3xl p-4 mb-3">
            <Tent className="w-14 h-14 text-white" strokeWidth={1.5} />
          </div>
          <h1 className="text-3xl font-bold text-white drop-shadow-sm">RV & Groceries</h1>
          <p className="text-emerald-50/90 text-sm mt-1">🏕️ Camping checklists for Diogo & Alice</p>
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
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[#2f6b4f] mb-3"
            />
            {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
            <button
              type="submit"
              disabled={loading || !pin}
              className="w-full bg-[#2f6b4f] text-white py-3 rounded-xl font-semibold text-base disabled:opacity-50 flex items-center justify-center gap-2"
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
                className="flex items-center gap-3 border-2 border-[#2f6b4f] rounded-xl px-5 py-4 text-[#2f6b4f] font-semibold text-base hover:bg-emerald-50 transition-colors"
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

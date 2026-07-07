import { useState, useEffect } from 'react'
import { signInWithCustomToken } from 'firebase/auth'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { auth, getMessagingInstance } from '@/lib/firebase'
import { saveFcmToken } from '@/lib/firestore'
import { useAppStore } from '@/lib/store'
import type { UserIdentity } from '@/types'
import { Tent, Loader2 } from 'lucide-react'
import { RigIcon, Campfire, Stars } from '@/components/CampScenes'

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
    // Bind the token to the dedicated messaging service worker explicitly (its
    // own scope, so it coexists with the Workbox PWA SW at '/'). This guarantees
    // the push subscription lives on the SW that has the onBackgroundMessage
    // handler, so background pushes render as native notifications.
    const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
      scope: '/firebase-cloud-messaging-push-scope',
    })
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg,
    })
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
      const { title = 'RV & Groceries', body = '' } = payload.data ?? {}
      if (reg) reg.showNotification(title, { body, icon: '/pwa-192x192.png', badge: '/pwa-192x192.png' })
      else if (Notification.permission === 'granted') new Notification(title, { body })
    })
  } catch {
    // non-critical
  }
}

// The PIN is verified server-side by the `exchangePin` Cloud Function, which
// returns a Firebase custom token — no credentials ever ship in the bundle.

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
    setLoading(true)
    try {
      const exchangePin = httpsCallable<{ pin: string }, { token: string }>(
        getFunctions(auth.app),
        'exchangePin',
      )
      const { data } = await exchangePin({ pin })
      await signInWithCustomToken(auth, data.token)
      setAuthenticated(true)
      setStep('identity')
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      if (code === 'functions/permission-denied') setError('Wrong password')
      else if (code === 'functions/resource-exhausted') setError('Too many attempts — try again in 15 minutes')
      else setError('Connection error — try again')
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
    <div className="camp-sky-night flex flex-col items-center justify-center min-h-dvh px-6 relative overflow-hidden">
      {/* Night campsite: stars, moon, hills, the rig and a fire */}
      <Stars className="absolute inset-x-0 top-6 w-full h-32" />
      <div className="absolute right-10 top-14 w-14 h-14 rounded-full bg-amber-50/90 blur-[0.5px]" aria-hidden />
      <div className="camp-hills absolute inset-x-0 bottom-0 h-40" aria-hidden />
      <div className="absolute bottom-4 left-5 flex items-end gap-3 pointer-events-none" aria-hidden>
        <RigIcon className="w-28 drop-shadow" flip />
        <Campfire className="w-8 h-8 mb-1" />
      </div>
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
                className="flex items-center gap-4 border-2 border-[#2f6b4f] rounded-2xl px-5 py-4 text-[#2f6b4f] font-bold text-base hover:bg-emerald-50 transition-colors"
              >
                <span className="flex items-center justify-center w-11 h-11 rounded-full bg-emerald-50 text-2xl shrink-0">🧭</span>
                <span className="text-left">
                  I'm Diogo
                  <span className="block text-xs font-medium text-gray-400">Trip captain · tow-master</span>
                </span>
              </button>
              <button
                onClick={() => pickIdentity('alice')}
                className="flex items-center gap-4 border-2 border-pink-400 rounded-2xl px-5 py-4 text-pink-600 font-bold text-base hover:bg-pink-50 transition-colors"
              >
                <span className="flex items-center justify-center w-11 h-11 rounded-full bg-pink-50 text-2xl shrink-0">🧺</span>
                <span className="text-left">
                  I'm Alice
                  <span className="block text-xs font-medium text-gray-400">Chief provisioner · list-boss</span>
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

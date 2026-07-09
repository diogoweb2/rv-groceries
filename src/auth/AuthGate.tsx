import { useState, useEffect } from 'react'
import { signInWithCustomToken } from 'firebase/auth'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { auth, getMessagingInstance } from '@/lib/firebase'
import { saveFcmToken } from '@/lib/firestore'
import { useAppStore } from '@/lib/store'
import type { UserIdentity } from '@/types'
import { Tent, Loader2, Delete } from 'lucide-react'
import { RigIcon, Campfire, Stars } from '@/components/CampScenes'

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string

// Number of digits in the shared app PIN. Must match the `APP_PIN` secret.
const PIN_LENGTH = 4

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

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const

function Keypad({
  onDigit,
  onDelete,
  disabled,
}: {
  onDigit: (d: string) => void
  onDelete: () => void
  disabled: boolean
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {KEYS.map((key, i) =>
        key === '' ? (
          <div key={i} />
        ) : key === 'del' ? (
          <button
            key={i}
            type="button"
            onClick={onDelete}
            disabled={disabled}
            aria-label="Delete"
            className="h-16 rounded-2xl text-gray-500 flex items-center justify-center active:bg-gray-100 disabled:opacity-40 transition-colors"
          >
            <Delete className="w-6 h-6" strokeWidth={1.75} />
          </button>
        ) : (
          <button
            key={i}
            type="button"
            onClick={() => onDigit(key)}
            disabled={disabled}
            className="h-16 rounded-2xl bg-gray-50 text-2xl font-semibold text-gray-800 active:bg-gray-200 disabled:opacity-40 transition-colors"
          >
            {key}
          </button>
        ),
      )}
    </div>
  )
}

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

  async function submitPin(value: string) {
    setLoading(true)
    try {
      const exchangePin = httpsCallable<{ pin: string }, { token: string }>(
        getFunctions(auth.app),
        'exchangePin',
      )
      const { data } = await exchangePin({ pin: value })
      await signInWithCustomToken(auth, data.token)
      setAuthenticated(true)
      setStep('identity')
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      if (code === 'functions/permission-denied') setError('Wrong PIN')
      else if (code === 'functions/resource-exhausted') setError('Too many attempts — try again in 15 minutes')
      else {
        // Anything else — a server-side throw, a missing/undeployed function, a real
        // network failure — reaches the user as the same vague message, so surface the
        // underlying cause where it can actually be debugged.
        console.error('Sign-in failed:', code ?? 'unknown', err)
        setError('Sign-in failed — check the console')
      }
      setPin('')
    } finally {
      setLoading(false)
    }
  }

  // A complete PIN submits itself — no Continue button to reach for one-handed.
  function pushDigit(d: string) {
    if (loading || pin.length >= PIN_LENGTH) return
    setError('')
    const next = pin + d
    setPin(next)
    if (next.length === PIN_LENGTH) submitPin(next)
  }

  function popDigit() {
    if (loading) return
    setError('')
    setPin((p) => p.slice(0, -1))
  }

  // Physical keyboards (desktop, iPad case) should work too.
  useEffect(() => {
    if (step !== 'pin') return
    function onKey(e: KeyboardEvent) {
      if (e.key >= '0' && e.key <= '9') pushDigit(e.key)
      else if (e.key === 'Backspace') popDigit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

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
          <div className="bg-white rounded-2xl p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-800 text-center mb-5">Enter app PIN</h2>

            <div className="flex items-center justify-center gap-4 h-6" aria-live="polite">
              {loading ? (
                <Loader2 className="w-6 h-6 animate-spin text-[#2f6b4f]" />
              ) : (
                Array.from({ length: PIN_LENGTH }, (_, i) => (
                  <span
                    key={i}
                    className={`w-3.5 h-3.5 rounded-full transition-colors ${
                      i < pin.length ? 'bg-[#2f6b4f]' : 'bg-gray-200'
                    }`}
                  />
                ))
              )}
            </div>

            <p className={`text-red-500 text-sm text-center h-5 mt-3 ${error ? '' : 'invisible'}`}>
              {error || ' '}
            </p>

            <div className="mt-3">
              <Keypad onDigit={pushDigit} onDelete={popDigit} disabled={loading} />
            </div>
          </div>
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

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Dev-only console escape hatch for one-off data migrations/cleanups (e.g.
// dedupeSupermarketLists for the §15 duplicate-active-list bug). Not wired
// into any UI on purpose — run manually from devtools when needed.
if (import.meta.env.DEV) {
  import('./lib/firestore').then((m) => {
    ;(window as unknown as { checklistDevTools: unknown }).checklistDevTools = m
  })
}

// Auto-reload open tabs when a freshly deployed service worker takes control,
// so users never sit on a stale version. We skip the first install (when the SW
// claims a previously uncontrolled page) and guard against reload loops.
if ('serviceWorker' in navigator) {
  let reloading = false
  let hadController = Boolean(navigator.serviceWorker.controller)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true
      return
    }
    if (reloading) return
    reloading = true
    window.location.reload()
  })

  // Installed PWAs (esp. Android) are resumed from memory rather than
  // re-navigated, so the browser's automatic SW update check often doesn't
  // run on open. Explicitly check whenever the app comes to the foreground;
  // if a new version is found, autoUpdate activates it and the
  // controllerchange handler above reloads onto it. No-op offline.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !navigator.onLine) return
    navigator.serviceWorker.getRegistration().then((reg) => reg?.update().catch(() => {}))
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

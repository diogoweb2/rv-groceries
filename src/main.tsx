import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

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
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

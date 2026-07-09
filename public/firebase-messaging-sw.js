importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: 'AIzaSyC15-CsSeyEp5ucsNU_moavLRpiUkldwa0',
  authDomain: 'rv-groceries.firebaseapp.com',
  projectId: 'rv-groceries',
  storageBucket: 'rv-groceries.firebasestorage.app',
  messagingSenderId: '695592318019',
  appId: '1:695592318019:web:39b46075cf2130027350f6',
})

const messaging = firebase.messaging()

// Data-only messages (see functions/src/index.ts) render exactly one notification
// here, avoiding the duplicate that a top-level `notification` payload would add.
messaging.onBackgroundMessage((payload) => {
  const { title = 'RV & Groceries', body = '' } = payload.data ?? {}
  self.registration.showNotification(title, {
    body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    data: payload.data,
  })
})

// Tapping a notification opens the page it points at (e.g. the store's list),
// reusing an already-open app window rather than spawning a second one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const path = event.notification.data?.url || '/'
  const target = new URL(path, self.location.origin)
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin === target.origin) {
          return client.focus().then((c) => c.navigate(target.href))
        }
      }
      return self.clients.openWindow(target.href)
    }),
  )
})

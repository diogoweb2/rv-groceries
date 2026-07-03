// One-off: read every item name in the Firestore DB and dump the unique set,
// with where each appears, so we can build a PT->EN translation table.
// Uses the shared app email/password (same identity the client uses).
import { readFileSync } from 'node:fs'
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, getDocs, collection, collectionGroup } from 'firebase/firestore'

// Parse .env (VITE_* vars)
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    })
)

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
})
const auth = getAuth(app)
const db = getFirestore(app)

await signInWithEmailAndPassword(auth, env.VITE_APP_EMAIL, env.VITE_APP_PASSWORD)

// name (as first seen) -> Set of sources
const names = new Map()
const add = (raw, source) => {
  const name = (raw ?? '').trim()
  if (!name) return
  const key = name.toLowerCase()
  if (!names.has(key)) names.set(key, { name, sources: new Set() })
  names.get(key).sources.add(source)
}

// itemCatalog
const catalog = await getDocs(collection(db, 'itemCatalog'))
catalog.forEach((d) => add(d.data().name, 'catalog'))

// all "items" subcollections: trip checklist items + groceryLists + supermarketLists
const items = await getDocs(collectionGroup(db, 'items'))
items.forEach((d) => add(d.data().name, 'item'))

// persistentItems
const persist = await getDocs(collection(db, 'persistentItems'))
persist.forEach((d) => add(d.data().name, 'persistent'))

// pinnedChecklists item arrays
const pinned = await getDocs(collection(db, 'pinnedChecklists'))
pinned.forEach((d) => (d.data().items ?? []).forEach((it) => add(it.name, 'pinned')))

const sorted = [...names.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
console.log('COUNT', sorted.length)
console.log(JSON.stringify(sorted.map((v) => ({ name: v.name, sources: [...v.sources] })), null, 2))
process.exit(0)

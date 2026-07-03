// One-off: apply the PT->EN translations from TRANSLATIONS.md across the DB.
// Renames names in: itemCatalog, all "items" subcollections (trip/grocery/
// supermarket), persistentItems, and pinnedChecklists item arrays.
// Matching is case-insensitive on the original name.
import { readFileSync } from 'node:fs'
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import {
  getFirestore, getDocs, collection, collectionGroup, updateDoc, deleteDoc,
} from 'firebase/firestore'

const envText = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = Object.fromEntries(
  envText.split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => {
    const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
  })
)

// Parse the translation table: | # | Original | English | Notes |
const map = new Map() // origLower -> english
for (const line of readFileSync(new URL('../TRANSLATIONS.md', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\|\s*\d+\s*\|(.+?)\|(.+?)\|(.*)\|\s*$/)
  if (!m) continue
  const orig = m[1].trim()
  const eng = m[2].trim()
  if (!orig || !eng) continue
  map.set(orig.toLowerCase(), eng)
}
console.log('Translations parsed:', map.size)

const translate = (raw) => {
  const name = (raw ?? '').trim()
  const t = map.get(name.toLowerCase())
  return t && t !== name ? t : null
}

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
})
const db = getFirestore(app)
await signInWithEmailAndPassword(getAuth(app), env.VITE_APP_EMAIL, env.VITE_APP_PASSWORD)

let updates = 0, deletes = 0

// itemCatalog — dedupe on rename: if the target name already exists as another
// catalog entry, delete this doc instead of creating a duplicate.
const catalog = await getDocs(collection(db, 'itemCatalog'))
const catalogTargetNames = new Set()
catalog.forEach((d) => {
  const cur = (d.data().name ?? '').trim()
  catalogTargetNames.add((translate(cur) ?? cur).toLowerCase())
})
// Recompute presence excluding self during the loop via a live set of final names.
const finalCatalogNames = new Set(catalog.docs.map((d) => {
  const cur = (d.data().name ?? '').trim()
  return (translate(cur) ?? cur).toLowerCase()
}))
const seen = new Set()
for (const d of catalog.docs) {
  const cur = (d.data().name ?? '').trim()
  const t = translate(cur)
  const finalName = (t ?? cur)
  const key = finalName.toLowerCase()
  if (seen.has(key)) {
    // A duplicate final name (e.g. Beacon -> Bacon collides with Bacon): drop.
    await deleteDoc(d.ref); deletes++; continue
  }
  seen.add(key)
  if (t) { await updateDoc(d.ref, { name: t }); updates++ }
}
void catalogTargetNames; void finalCatalogNames

// All "items" subcollections
const items = await getDocs(collectionGroup(db, 'items'))
for (const d of items.docs) {
  const t = translate(d.data().name)
  if (t) { await updateDoc(d.ref, { name: t }); updates++ }
}

// persistentItems
const persist = await getDocs(collection(db, 'persistentItems'))
for (const d of persist.docs) {
  const t = translate(d.data().name)
  if (t) { await updateDoc(d.ref, { name: t }); updates++ }
}

// pinnedChecklists item arrays
const pinned = await getDocs(collection(db, 'pinnedChecklists'))
for (const d of pinned.docs) {
  const arr = d.data().items ?? []
  let changed = false
  const next = arr.map((it) => {
    const t = translate(it.name)
    if (t) { changed = true; return { ...it, name: t } }
    return it
  })
  if (changed) { await updateDoc(d.ref, { items: next }); updates++ }
}

console.log(`Done. Updated ${updates} docs, deleted ${deletes} duplicate catalog docs.`)
process.exit(0)

import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthGate } from '@/auth/AuthGate'
import {
  backfillCatalogFromItems, dedupeCatalog, syncTripStatuses,
  ensureDefaultStores, migrateSupermarketListsToStoreIds, migrateGroceryChecklistsToStoreIds,
} from '@/lib/firestore'
import { useTrips } from '@/hooks/useFirestore'
import { useAppStore } from '@/lib/store'
import { TabLayout } from '@/components/TabLayout'

const HomeScreen = lazy(() => import('@/features/HomeScreen').then(m => ({ default: m.HomeScreen })))
const TripsList = lazy(() => import('@/features/trips/TripsList').then(m => ({ default: m.TripsList })))
const NewTrip = lazy(() => import('@/features/trips/NewTrip').then(m => ({ default: m.NewTrip })))
const TripDetail = lazy(() => import('@/features/trips/TripDetail').then(m => ({ default: m.TripDetail })))
const SupermarketHome = lazy(() => import('@/features/supermarket/SupermarketHome').then(m => ({ default: m.SupermarketHome })))
const SupermarketDetail = lazy(() => import('@/features/supermarket/SupermarketDetail').then(m => ({ default: m.SupermarketDetail })))
const ManageHome = lazy(() => import('@/features/manage/ManageHome').then(m => ({ default: m.ManageHome })))
const AmenitiesPage = lazy(() => import('@/features/manage/AmenitiesPage').then(m => ({ default: m.AmenitiesPage })))
const StoresPage = lazy(() => import('@/features/manage/StoresPage').then(m => ({ default: m.StoresPage })))
const CatalogPage = lazy(() => import('@/features/manage/CatalogPage').then(m => ({ default: m.CatalogPage })))
const FeedbackPage = lazy(() => import('@/features/manage/FeedbackPage').then(m => ({ default: m.FeedbackPage })))

// Keeps the global catalog clean and complete, once per device: removes any
// duplicate-name entries, then seeds names from items already in lists.
function CatalogSync() {
  useEffect(() => {
    if (localStorage.getItem('catalogSyncV2')) return
    ;(async () => {
      try {
        await dedupeCatalog()
        await backfillCatalogFromItems()
        localStorage.setItem('catalogSyncV2', '1')
      } catch {
        /* non-critical — will retry next load */
      }
    })()
  }, [])
  return null
}

// Seeds the default stores and links Supermarket lists / trip grocery
// checklists to Store records. Runs every load (not gated behind a one-time
// flag) — each step only touches docs that still need it, so it's cheap and
// self-healing rather than getting permanently stuck if one run partially
// no-ops (e.g. a legacy doc that didn't match on a prior run).
function StoreSync() {
  useEffect(() => {
    ;(async () => {
      try {
        await ensureDefaultStores()
        await migrateSupermarketListsToStoreIds()
        await migrateGroceryChecklistsToStoreIds()
      } catch {
        /* non-critical — will retry next load */
      }
    })()
  }, [])
  return null
}

// Advances trips to their date-derived status (active the day before start,
// completed the day after end) whenever the trip list changes. Forward-only and
// idempotent — see syncTripStatuses.
function TripStatusSync() {
  const trips = useTrips()
  const identity = useAppStore(s => s.identity)
  useEffect(() => {
    if (!identity || trips.length === 0) return
    syncTripStatuses(trips, identity).catch(() => {
      /* non-critical — retries on next snapshot */
    })
  }, [trips, identity])
  return null
}

export default function App() {
  return (
    <AuthGate>
      <BrowserRouter>
        <CatalogSync />
        <StoreSync />
        <TripStatusSync />
        <Suspense fallback={null}>
          <Routes>
            {/* Top-level tabs — these show the bottom navigation bar */}
            <Route element={<TabLayout />}>
              <Route path="/" element={<HomeScreen />} />
              <Route path="/trips" element={<TripsList />} />
              <Route path="/supermarket" element={<SupermarketHome />} />
            </Route>

            {/* Full-screen pushed screens — no tab bar, own back button */}
            <Route path="/trips/new" element={<NewTrip />} />
            <Route path="/trips/:id" element={<TripDetail />} />
            <Route path="/supermarket/:id" element={<SupermarketDetail />} />

            {/* Manage */}
            <Route path="/manage" element={<ManageHome />} />
            <Route path="/manage/amenities" element={<AmenitiesPage />} />
            <Route path="/manage/stores" element={<StoresPage />} />
            <Route path="/manage/catalog" element={<CatalogPage />} />
            <Route path="/manage/feedback" element={<FeedbackPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthGate>
  )
}

import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthGate } from '@/auth/AuthGate'
import { backfillCatalogFromItems, dedupeCatalog } from '@/lib/firestore'
import { TabLayout } from '@/components/TabLayout'
import { HomeScreen } from '@/features/HomeScreen'
import { TripsList } from '@/features/trips/TripsList'
import { NewTrip } from '@/features/trips/NewTrip'
import { TripDetail } from '@/features/trips/TripDetail'
import { GroceryHome } from '@/features/grocery/GroceryHome'
import { GroceryDetail } from '@/features/grocery/GroceryDetail'
import { ManageHome } from '@/features/manage/ManageHome'
import { AmenitiesPage } from '@/features/manage/AmenitiesPage'
import { StoresPage } from '@/features/manage/StoresPage'
import { CatalogPage } from '@/features/manage/CatalogPage'
import { TemplatesPage } from '@/features/manage/TemplatesPage'

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

export default function App() {
  return (
    <AuthGate>
      <BrowserRouter>
        <CatalogSync />
        <Routes>
          {/* Top-level tabs — these show the bottom navigation bar */}
          <Route element={<TabLayout />}>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/trips" element={<TripsList />} />
            <Route path="/grocery" element={<GroceryHome />} />
          </Route>

          {/* Full-screen pushed screens — no tab bar, own back button */}
          <Route path="/trips/new" element={<NewTrip />} />
          <Route path="/trips/:id" element={<TripDetail />} />
          <Route path="/grocery/:id" element={<GroceryDetail />} />

          {/* Manage */}
          <Route path="/manage" element={<ManageHome />} />
          <Route path="/manage/amenities" element={<AmenitiesPage />} />
          <Route path="/manage/stores" element={<StoresPage />} />
          <Route path="/manage/catalog" element={<CatalogPage />} />
          <Route path="/manage/templates" element={<TemplatesPage />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthGate>
  )
}

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthGate } from '@/auth/AuthGate'
import { BottomNav } from '@/components/BottomNav'
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

export default function App() {
  return (
    <AuthGate>
      <BrowserRouter>
        <div className="flex flex-col flex-1 relative">
          <Routes>
            <Route path="/" element={<HomeScreen />} />

            {/* Camping */}
            <Route path="/trips" element={<TripsList />} />
            <Route path="/trips/new" element={<NewTrip />} />
            <Route path="/trips/:id" element={<TripDetail />} />

            {/* Grocery */}
            <Route path="/grocery" element={<GroceryHome />} />
            <Route path="/grocery/:id" element={<GroceryDetail />} />

            {/* Manage */}
            <Route path="/manage" element={<ManageHome />} />
            <Route path="/manage/amenities" element={<AmenitiesPage />} />
            <Route path="/manage/stores" element={<StoresPage />} />
            <Route path="/manage/catalog" element={<CatalogPage />} />
            <Route path="/manage/templates" element={<TemplatesPage />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <BottomNav />
        </div>
      </BrowserRouter>
    </AuthGate>
  )
}

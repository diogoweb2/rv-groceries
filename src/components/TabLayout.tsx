import { Outlet } from 'react-router-dom'
import { BottomNav } from './BottomNav'

// Shell for the three top-level tab screens (Home, Camping, Supermarket).
// The tab bar lives in normal flow below a scrollable content area, so it never
// overlaps screen content. Detail and form screens render outside this layout
// and therefore show no tab bar.
export function TabLayout() {
  return (
    <div className="flex flex-col h-full min-h-0">
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}

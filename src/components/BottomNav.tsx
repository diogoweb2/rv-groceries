import { useLocation, useNavigate } from 'react-router-dom'
import { Home, Tent, ShoppingCart } from 'lucide-react'
import { cn } from '@/lib/cn'

const TABS = [
  { path: '/', icon: Home, label: 'Home', exact: true },
  { path: '/trips', icon: Tent, label: 'Camping', exact: false },
  { path: '/supermarket', icon: ShoppingCart, label: 'Supermarket', exact: false },
]

export function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <nav className="shrink-0 bg-white border-t border-gray-100 flex pb-[env(safe-area-inset-bottom)]">
      {TABS.map(tab => {
        const active = tab.exact
          ? location.pathname === tab.path
          : location.pathname.startsWith(tab.path)
        return (
          <button
            key={tab.path}
            onClick={() => navigate(tab.path)}
            className={cn(
              'flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors',
              active ? 'text-[#2f6b4f]' : 'text-gray-400'
            )}
          >
            <tab.icon className={cn('w-6 h-6', active && 'fill-current opacity-20')} />
            <span className="text-xs font-medium">{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

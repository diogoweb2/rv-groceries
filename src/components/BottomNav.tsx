import { useLocation, useNavigate } from 'react-router-dom'
import { Home, Caravan, ShoppingCart } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useSupermarketPendingCount } from '@/hooks/useFirestore'

const TABS = [
  { path: '/', icon: Home, label: 'Home', exact: true },
  { path: '/trips', icon: Caravan, label: 'Camping', exact: false },
  { path: '/supermarket', icon: ShoppingCart, label: 'Supermarket', exact: false },
]

export function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const pending = useSupermarketPendingCount()

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
              'flex-1 flex flex-col items-center gap-0.5 py-2 transition-colors',
              active ? 'text-[#2f6b4f]' : 'text-gray-400'
            )}
          >
            <span
              className={cn(
                'relative flex items-center justify-center px-4 py-1 rounded-full transition-colors',
                active && 'bg-emerald-50 animate-tab-pop'
              )}
            >
              <tab.icon className="w-6 h-6" />
              {tab.path === '/supermarket' && pending > 0 && (
                <span
                  className="absolute top-0 right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center"
                  aria-label={`${pending} items to buy`}
                >
                  {pending > 99 ? '99+' : pending}
                </span>
              )}
            </span>
            <span className={cn('text-xs', active ? 'font-bold' : 'font-medium')}>{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

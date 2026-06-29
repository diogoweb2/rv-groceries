import { useLocation, useNavigate } from 'react-router-dom'
import { Home, Tent, ShoppingCart } from 'lucide-react'
import { cn } from '@/lib/cn'

const TABS = [
  { path: '/', icon: Home, label: 'Home', exact: true },
  { path: '/trips', icon: Tent, label: 'Camping', exact: false },
  { path: '/grocery', icon: ShoppingCart, label: 'Supermarket', exact: false },
]

export function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()

  const isManage = location.pathname.startsWith('/manage')
  if (isManage) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-100 flex pb-safe">
      {TABS.map(tab => {
        const active = tab.exact
          ? location.pathname === tab.path
          : location.pathname.startsWith(tab.path)
        return (
          <button
            key={tab.path}
            onClick={() => navigate(tab.path)}
            className={cn(
              'flex-1 flex flex-col items-center gap-1 py-3 transition-colors',
              active ? 'text-[#1e3a5f]' : 'text-gray-400'
            )}
          >
            <tab.icon className={cn('w-6 h-6', active && 'fill-current opacity-20')} />
            <span className="text-xs font-medium">{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}

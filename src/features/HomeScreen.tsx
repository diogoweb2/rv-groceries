import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/lib/store'
import { Tent, ShoppingCart, Settings } from 'lucide-react'

export function HomeScreen() {
  const navigate = useNavigate()
  const identity = useAppStore(s => s.identity)

  return (
    <div className="flex flex-col min-h-dvh bg-[#1e3a5f]">
      {/* Top */}
      <div className="flex items-center justify-between px-5 pt-12 pb-6">
        <div>
          <p className="text-blue-200 text-sm">Welcome back,</p>
          <h1 className="text-3xl font-bold text-white capitalize">{identity}</h1>
        </div>
        <button onClick={() => navigate('/manage')} className="text-blue-200 p-2">
          <Settings className="w-6 h-6" />
        </button>
      </div>

      {/* Cards */}
      <div className="flex-1 bg-gray-50 rounded-t-3xl px-5 pt-8 flex flex-col gap-4">
        <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">What do you need?</p>

        <button
          onClick={() => navigate('/trips')}
          className="bg-[#1e3a5f] rounded-2xl p-6 text-left shadow-md active:scale-[0.98] transition-transform"
        >
          <Tent className="w-10 h-10 text-white mb-3" strokeWidth={1.5} />
          <h2 className="text-2xl font-bold text-white">Camping</h2>
          <p className="text-blue-200 text-sm mt-1">Trips, checklists & RV maintenance</p>
        </button>

        <button
          onClick={() => navigate('/grocery')}
          className="bg-pink-500 rounded-2xl p-6 text-left shadow-md active:scale-[0.98] transition-transform"
        >
          <ShoppingCart className="w-10 h-10 text-white mb-3" strokeWidth={1.5} />
          <h2 className="text-2xl font-bold text-white">Supermarket</h2>
          <p className="text-pink-100 text-sm mt-1">Grocery lists & shopping</p>
        </button>
      </div>
    </div>
  )
}

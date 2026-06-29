import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/lib/store'
import { Tent, ShoppingCart, Settings, Users } from 'lucide-react'

export function HomeScreen() {
  const navigate = useNavigate()
  const identity = useAppStore(s => s.identity)
  const clearIdentity = useAppStore(s => s.clearIdentity)

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto bg-[#1e3a5f]">
      {/* Top */}
      <div className="flex items-center justify-between px-5 pt-12 pb-6">
        <div>
          <p className="text-blue-200 text-sm">Welcome back,</p>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold text-white capitalize">{identity}</h1>
            <button onClick={clearIdentity} className="text-blue-300 opacity-60 hover:opacity-100 transition-opacity mt-1" title="Switch user">
              <Users className="w-5 h-5" />
            </button>
          </div>
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

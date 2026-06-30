import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSupermarketLists, useSupermarketItems, useNotifications } from '@/hooks/useFirestore'
import {
  addSupermarketList, markNotificationRead, SUPERMARKET_STORES, supermarketStoreLabel,
} from '@/lib/firestore'
import { useAppStore } from '@/lib/store'
import { Dialog } from '@/components/ui/dialog'
import { Plus, ShoppingCart, ChevronRight, Bell, X } from 'lucide-react'
import type { SupermarketList, SupermarketStore } from '@/types'

// One active-list card; subscribes its items to show bought/total progress.
function ListCard({ list, onOpen }: { list: SupermarketList; onOpen: () => void }) {
  const items = useSupermarketItems(list.id)
  const bought = items.filter(i => i.checked).length

  return (
    <button
      onClick={onOpen}
      className="flex items-center gap-3 bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-4 text-left active:bg-gray-50 w-full"
    >
      <div className="bg-pink-50 rounded-xl p-2.5">
        <ShoppingCart className="w-5 h-5 text-pink-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-800">{supermarketStoreLabel(list.store)}</p>
        <p className="text-sm text-gray-500">
          {items.length === 0 ? 'No items yet' : `${bought}/${items.length} bought`}
        </p>
      </div>
      <ChevronRight className="w-5 h-5 text-gray-300 shrink-0" />
    </button>
  )
}

export function SupermarketHome() {
  const navigate = useNavigate()
  const lists = useSupermarketLists()
  const identity = useAppStore(s => s.identity)!
  const notifications = useNotifications(identity)
  const [picking, setPicking] = useState(false)
  const [creating, setCreating] = useState(false)

  const active = lists.filter(l => l.status === 'active')
  const usedStores = new Set(active.map(l => l.store))
  const availableStores = SUPERMARKET_STORES.filter(s => !usedStores.has(s.id))
  const canCreate = availableStores.length > 0

  async function createList(store: SupermarketStore) {
    setCreating(true)
    const ref = await addSupermarketList(store, identity)
    setCreating(false)
    setPicking(false)
    navigate(`/supermarket/${ref.id}`)
  }

  return (
    <div className="flex flex-col min-h-0 flex-1 bg-[#fbf7f0]">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h1 className="text-xl font-bold text-gray-800">Supermarket</h1>
        {canCreate && (
          <button
            onClick={() => setPicking(true)}
            className="bg-[#2f6b4f] text-white rounded-xl p-2 active:opacity-80"
            aria-label="New list"
          >
            <Plus className="w-5 h-5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {/* Notification banners */}
        {notifications.map(n => (
          <div
            key={n.id}
            className="flex items-start gap-3 bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-3 mb-3"
          >
            <Bell className="w-5 h-5 text-[#2f6b4f] shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-800 text-sm">{n.title}</p>
              <p className="text-sm text-gray-600">{n.body}</p>
            </div>
            <button
              onClick={() => markNotificationRead(n.id)}
              className="text-gray-400 hover:text-gray-600 p-0.5 shrink-0"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}

        {active.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <ShoppingCart className="w-14 h-14 mb-3" strokeWidth={1.2} />
            <p className="text-base font-medium">No active lists</p>
            <p className="text-sm">Tap + to start a list for a store</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {active.map(list => (
              <ListCard key={list.id} list={list} onOpen={() => navigate(`/supermarket/${list.id}`)} />
            ))}
          </div>
        )}

        {!canCreate && active.length > 0 && (
          <p className="text-center text-gray-400 text-xs mt-5">
            All three stores have an active list. Complete one to start another.
          </p>
        )}
      </div>

      {/* Store picker */}
      <Dialog open={picking} onClose={() => setPicking(false)} title="New list — which store?">
        <div className="flex flex-col gap-3">
          {availableStores.map(s => (
            <button
              key={s.id}
              onClick={() => createList(s.id)}
              disabled={creating}
              className="flex items-center gap-3 border-2 border-gray-200 rounded-xl px-4 py-3.5 text-gray-800 font-semibold hover:border-[#2f6b4f] hover:bg-emerald-50 transition-colors disabled:opacity-50"
            >
              <ShoppingCart className="w-5 h-5 text-pink-500" />
              {s.label}
            </button>
          ))}
        </div>
      </Dialog>
    </div>
  )
}

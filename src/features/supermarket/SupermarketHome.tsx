import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSupermarketLists, useSupermarketItems, useStores } from '@/hooks/useFirestore'
import { ensureActiveSupermarketList, storeLabel } from '@/lib/firestore'
import { useAppStore } from '@/lib/store'
import { Dialog } from '@/components/ui/dialog'
import { Plus, ShoppingCart, ChevronRight } from 'lucide-react'
import type { SupermarketList, Store } from '@/types'

// One active-list card; subscribes its items to show bought/total progress.
function ListCard({ list, stores, onOpen }: { list: SupermarketList; stores: Store[]; onOpen: () => void }) {
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
        <p className="font-semibold text-gray-800">{storeLabel(stores, list)}</p>
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
  const stores = useStores()
  const identity = useAppStore(s => s.identity)!
  const [picking, setPicking] = useState(false)
  const [creating, setCreating] = useState(false)

  const active = lists.filter(l => l.status === 'active')
  const usedStoreIds = new Set(active.map(l => l.storeId))
  const availableStores = stores.filter(s => !usedStoreIds.has(s.id))
  const canCreate = availableStores.length > 0

  async function createList(storeId: string) {
    setCreating(true)
    const listId = await ensureActiveSupermarketList(storeId, identity)
    setCreating(false)
    setPicking(false)
    navigate(`/supermarket/${listId}`)
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
        {active.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <ShoppingCart className="w-14 h-14 mb-3" strokeWidth={1.2} />
            <p className="text-base font-medium">No active lists</p>
            <p className="text-sm">Tap + to start a list for a store</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {active.map(list => (
              <ListCard key={list.id} list={list} stores={stores} onOpen={() => navigate(`/supermarket/${list.id}`)} />
            ))}
          </div>
        )}

        {!canCreate && active.length > 0 && (
          <p className="text-center text-gray-400 text-xs mt-5">
            Every store already has an active list. Complete one to start another.
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
              {s.name}
            </button>
          ))}
        </div>
      </Dialog>
    </div>
  )
}

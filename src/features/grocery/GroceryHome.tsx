import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGroceryLists, useCatalog } from '@/hooks/useFirestore'
import { addGroceryList, addGroceryItem, deleteGroceryList } from '@/lib/firestore'
import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, ShoppingCart, Send, Trash2 } from 'lucide-react'

function formatDate(d: unknown) {
  if (!d) return ''
  const date = d instanceof Date ? d : new Date(d as string)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function GroceryHome() {
  const navigate = useNavigate()
  const lists = useGroceryLists()
  const catalog = useCatalog()
  const identity = useAppStore(s => s.identity)!
  const [creating, setCreating] = useState(false)

  async function createNewList() {
    setCreating(true)
    const ref = await addGroceryList({
      title: `Shopping ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      status: 'draft',
      createdBy: identity,
      createdAt: new Date().toISOString(),
    })

    // Auto-suggest frequent grocery items
    const groceryItems = catalog
      .filter(c => c.category === 'grocery' || c.category === 'general')
      .sort((a, b) => (b.stats?.totalGrocery ?? 0) - (a.stats?.totalGrocery ?? 0))
      .slice(0, 15)

    for (let i = 0; i < groceryItems.length; i++) {
      const item = groceryItems[i]
      await addGroceryItem(
        ref.id,
        {
          catalogItemId: item.id,
          name: item.name,
          qty: '',
          storeId: item.defaultStoreId,
          checked: false,
          order: i,
          rev: 1,
          baseRev: 0,
          updatedBy: identity,
          updatedAt: new Date().toISOString(),
        },
        identity
      )
    }

    setCreating(false)
    navigate(`/grocery/${ref.id}`)
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (!confirm('Delete this list? This cannot be undone.')) return
    await deleteGroceryList(id)
  }

  const drafts = lists.filter(l => l.status === 'draft')
  const sent = lists.filter(l => l.status === 'sent')

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h1 className="text-xl font-bold text-gray-800">Supermarket</h1>
        <Button size="icon" onClick={createNewList} disabled={creating}>
          <Plus className="w-5 h-5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {lists.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <ShoppingCart className="w-14 h-14 mb-3" strokeWidth={1.2} />
            <p className="text-base font-medium">No grocery lists yet</p>
            <p className="text-sm">Tap + to create one</p>
          </div>
        ) : (
          <>
            {drafts.length > 0 && (
              <div className="mb-5">
                <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Draft</p>
                <div className="flex flex-col gap-3">
                  {drafts.map(list => (
                    <div
                      key={list.id}
                      onClick={() => navigate(`/grocery/${list.id}`)}
                      className="flex items-center gap-3 bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-4 text-left active:bg-gray-50 cursor-pointer"
                    >
                      <div className="bg-pink-50 rounded-xl p-2.5">
                        <ShoppingCart className="w-5 h-5 text-pink-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-800">{list.title}</p>
                        <p className="text-sm text-gray-500">{formatDate(list.createdAt)}</p>
                      </div>
                      <Badge variant="warning">Draft</Badge>
                      <button
                        onClick={e => handleDelete(e, list.id)}
                        className="text-gray-300 hover:text-red-500 p-1 shrink-0"
                        aria-label="Delete list"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {sent.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Sent</p>
                <div className="flex flex-col gap-3">
                  {sent.slice(0, 5).map(list => (
                    <div
                      key={list.id}
                      onClick={() => navigate(`/grocery/${list.id}`)}
                      className="flex items-center gap-3 bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-4 text-left active:bg-gray-50 opacity-75 cursor-pointer"
                    >
                      <div className="bg-green-50 rounded-xl p-2.5">
                        <Send className="w-5 h-5 text-green-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-800">{list.title}</p>
                        <p className="text-sm text-gray-500">{formatDate(list.sentAt ?? list.createdAt)}</p>
                      </div>
                      <Badge variant="success">Sent</Badge>
                      <button
                        onClick={e => handleDelete(e, list.id)}
                        className="text-gray-300 hover:text-red-500 p-1 shrink-0"
                        aria-label="Delete list"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

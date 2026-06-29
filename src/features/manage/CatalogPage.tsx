import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCatalog, useStores } from '@/hooks/useFirestore'
import { addCatalogItem, updateCatalogItem, deleteCatalogItem } from '@/lib/firestore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog } from '@/components/ui/dialog'
import { ArrowLeft, Plus, Pencil, Trash2, Search } from 'lucide-react'
import type { CatalogItem } from '@/types'

type Category = CatalogItem['category']
const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'camping', label: 'Camping' },
  { value: 'grocery', label: 'Grocery' },
  { value: 'general', label: 'General' },
]

export function CatalogPage() {
  const navigate = useNavigate()
  const catalog = useCatalog()
  const stores = useStores()
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<{ mode: 'add' | 'edit'; item?: CatalogItem } | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState<Category>('camping')
  const [storeId, setStoreId] = useState('')
  const [unit, setUnit] = useState('')
  const [saving, setSaving] = useState(false)

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return catalog.filter(c => !q || c.name.toLowerCase().includes(q))
  }, [catalog, query])

  const storeMap = Object.fromEntries(stores.map(s => [s.id, s.name]))

  function openAdd() {
    setName(''); setCategory('camping'); setStoreId(''); setUnit('')
    setDialog({ mode: 'add' })
  }
  function openEdit(item: CatalogItem) {
    setName(item.name); setCategory(item.category)
    setStoreId(item.defaultStoreId ?? ''); setUnit(item.unit ?? '')
    setDialog({ mode: 'edit', item })
  }

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    const data = {
      name: name.trim(),
      category,
      defaultStoreId: storeId || undefined,
      unit: unit.trim() || undefined,
      stats: dialog?.item?.stats ?? { totalUsed: 0, totalGrocery: 0, byAmenity: {}, lastGrocerySortIndex: {} },
    }
    if (dialog?.mode === 'add') {
      await addCatalogItem(data)
    } else if (dialog?.item) {
      await updateCatalogItem(dialog.item.id, data)
    }
    setSaving(false)
    setDialog(null)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete from catalog?')) return
    await deleteCatalogItem(id)
  }

  return (
    <div className="flex flex-col h-dvh bg-gray-50">
      <div className="flex items-center justify-between px-4 pt-4 pb-3 bg-white border-b border-gray-100">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-gray-600 p-1 -ml-1">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-bold text-gray-800">Saved items</h1>
        </div>
        <Button size="icon" onClick={openAdd}><Plus className="w-5 h-5" /></Button>
      </div>

      <div className="px-4 pt-3 pb-2 bg-white border-b border-gray-50">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search catalog…" className="pl-9" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.map(item => (
          <div key={item.id} className="flex items-center gap-3 bg-white border-b border-gray-50 px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-800">{item.name}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-gray-500 capitalize">{item.category}</span>
                {item.defaultStoreId && <span className="text-xs text-gray-400">· {storeMap[item.defaultStoreId]}</span>}
                {item.unit && <span className="text-xs text-gray-400">· {item.unit}</span>}
              </div>
            </div>
            <span className="text-xs text-gray-400">×{item.stats?.totalUsed ?? 0}</span>
            <button onClick={() => openEdit(item)} className="text-gray-400 hover:text-gray-600 p-1">
              <Pencil className="w-4 h-4" />
            </button>
            <button onClick={() => handleDelete(item.id)} className="text-gray-400 hover:text-red-500 p-1">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="text-center text-gray-400 text-sm py-10">No items found</p>
        )}
      </div>

      <Dialog open={!!dialog} onClose={() => setDialog(null)} title={dialog?.mode === 'add' ? 'New item' : 'Edit item'}>
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Name</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Item name" autoFocus />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">Category</label>
            <div className="flex gap-2">
              {CATEGORIES.map(c => (
                <button
                  key={c.value}
                  onClick={() => setCategory(c.value)}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium border-2 transition-colors ${category === c.value ? 'border-[#1e3a5f] bg-[#1e3a5f] text-white' : 'border-gray-200 text-gray-600'}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Default store (optional)</label>
            <select
              value={storeId}
              onChange={e => setStoreId(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base bg-white focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
            >
              <option value="">None</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Unit (optional)</label>
            <Input value={unit} onChange={e => setUnit(e.target.value)} placeholder="kg, litres, pack…" />
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="secondary" className="flex-1" onClick={() => setDialog(null)}>Cancel</Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving || !name.trim()}>Save</Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

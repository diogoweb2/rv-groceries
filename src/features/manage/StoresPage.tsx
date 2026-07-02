import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStores } from '@/hooks/useFirestore'
import { addStore, updateStore, deleteStore } from '@/lib/firestore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog } from '@/components/ui/dialog'
import { ArrowLeft, Plus, Pencil, Trash2, Store } from 'lucide-react'
import type { Store as StoreType } from '@/types'

export function StoresPage() {
  const navigate = useNavigate()
  const stores = useStores()
  const [dialog, setDialog] = useState<{ mode: 'add' | 'edit'; item?: StoreType } | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  function openAdd() { setName(''); setDialog({ mode: 'add' }) }
  function openEdit(item: StoreType) { setName(item.name); setDialog({ mode: 'edit', item }) }

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    if (dialog?.mode === 'add') {
      await addStore({ name: name.trim() })
    } else if (dialog?.item) {
      await updateStore(dialog.item.id, { name: name.trim() })
    }
    setSaving(false)
    setDialog(null)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this store?')) return
    try {
      await deleteStore(id)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not delete this store.')
    }
  }

  return (
    <div className="flex flex-col h-dvh bg-gray-50">
      <div className="flex items-center justify-between px-4 pt-4 pb-3 bg-white border-b border-gray-100">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-gray-600 p-1 -ml-1">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-bold text-gray-800">Stores</h1>
        </div>
        <Button size="icon" onClick={openAdd}><Plus className="w-5 h-5" /></Button>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-2 p-4">
        {stores.map(s => (
          <div key={s.id} className="flex items-center gap-3 bg-white rounded-xl border border-gray-100 px-4 py-3.5">
            <Store className="w-5 h-5 text-[#2f6b4f]" />
            <span className="flex-1 font-medium text-gray-800">{s.name}</span>
            <button onClick={() => openEdit(s)} className="text-gray-400 hover:text-gray-600 p-1">
              <Pencil className="w-4 h-4" />
            </button>
            <button onClick={() => handleDelete(s.id)} className="text-gray-400 hover:text-red-500 p-1">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {stores.length === 0 && (
          <p className="text-center text-gray-400 text-sm py-10">No stores yet</p>
        )}
      </div>

      <Dialog open={!!dialog} onClose={() => setDialog(null)} title={dialog?.mode === 'add' ? 'New store' : 'Edit store'}>
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Store name</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Lidl, Aldi, Pharmacy" autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSave()} />
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

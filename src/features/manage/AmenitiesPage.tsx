import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAmenities } from '@/hooks/useFirestore'
import { addAmenity, updateAmenity, deleteAmenity } from '@/lib/firestore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog } from '@/components/ui/dialog'
import { ArrowLeft, Plus, Pencil, Trash2 } from 'lucide-react'
import type { Amenity } from '@/types'

const EMOJI_SUGGESTIONS = ['🏖️', '🏊', '🎾', '⛺', '🚣', '🏕️', '🌊', '🏔️', '🐟', '🌲']

export function AmenitiesPage() {
  const navigate = useNavigate()
  const amenities = useAmenities()
  const [dialog, setDialog] = useState<{ mode: 'add' | 'edit'; item?: Amenity } | null>(null)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('⛺')
  const [saving, setSaving] = useState(false)

  function openAdd() { setName(''); setIcon('⛺'); setDialog({ mode: 'add' }) }
  function openEdit(item: Amenity) { setName(item.name); setIcon(item.icon); setDialog({ mode: 'edit', item }) }

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    if (dialog?.mode === 'add') {
      await addAmenity({ name: name.trim(), icon })
    } else if (dialog?.item) {
      await updateAmenity(dialog.item.id, { name: name.trim(), icon })
    }
    setSaving(false)
    setDialog(null)
  }

  async function handleDelete(id: string) {
    await deleteAmenity(id)
  }

  return (
    <div className="flex flex-col h-dvh bg-gray-50">
      <div className="flex items-center justify-between px-4 pt-4 pb-3 bg-white border-b border-gray-100">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-gray-600 p-1 -ml-1">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-bold text-gray-800">Amenities</h1>
        </div>
        <Button size="icon" onClick={openAdd}><Plus className="w-5 h-5" /></Button>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-2 p-4">
        {amenities.map(a => (
          <div key={a.id} className="flex items-center gap-3 bg-white rounded-xl border border-gray-100 px-4 py-3.5">
            <span className="text-2xl">{a.icon}</span>
            <span className="flex-1 font-medium text-gray-800">{a.name}</span>
            <button onClick={() => openEdit(a)} className="text-gray-400 hover:text-gray-600 p-1">
              <Pencil className="w-4 h-4" />
            </button>
            <button onClick={() => handleDelete(a.id)} className="text-gray-400 hover:text-red-500 p-1">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {amenities.length === 0 && (
          <p className="text-center text-gray-400 text-sm py-10">No amenities yet</p>
        )}
      </div>

      <Dialog open={!!dialog} onClose={() => setDialog(null)} title={dialog?.mode === 'add' ? 'New amenity' : 'Edit amenity'}>
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Name</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Beach" autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSave()} />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">Icon</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {EMOJI_SUGGESTIONS.map(e => (
                <button
                  key={e}
                  onClick={() => setIcon(e)}
                  className={`text-2xl p-1.5 rounded-lg border-2 ${icon === e ? 'border-[#2f6b4f]' : 'border-transparent'}`}
                >
                  {e}
                </button>
              ))}
            </div>
            <Input value={icon} onChange={e => setIcon(e.target.value)} placeholder="Or paste emoji" className="text-center text-xl" />
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

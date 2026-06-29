import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTemplates, useCatalog } from '@/hooks/useFirestore'
import { addTemplate, updateTemplate, deleteTemplate } from '@/lib/firestore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { ArrowLeft, Plus, Pencil, Trash2, X } from 'lucide-react'
import type { Template, ChecklistPhase, TemplateItem } from '@/types'

const PHASES: { value: ChecklistPhase; label: string }[] = [
  { value: 'pre_early', label: 'Before the trip' },
  { value: 'pre_dayof', label: 'Day of departure' },
  { value: 'pack_down', label: 'Pack down / return' },
  { value: 'grocery', label: 'Groceries' },
]

export function TemplatesPage() {
  const navigate = useNavigate()
  const templates = useTemplates()
  const catalog = useCatalog()
  const [editing, setEditing] = useState<Partial<Template> | null>(null)
  const [saving, setSaving] = useState(false)
  const [itemQuery, setItemQuery] = useState('')

  function openNew() {
    setEditing({ name: '', category: 'camping', phase: 'pre_early', items: [] })
  }
  function openEdit(t: Template) {
    setEditing({ ...t, items: [...t.items] })
  }

  function updateField<K extends keyof Template>(k: K, v: Template[K]) {
    setEditing(prev => prev ? { ...prev, [k]: v } : prev)
  }

  function addTemplateItem(catalogId: string, name: string) {
    const item: TemplateItem = { catalogItemId: catalogId, name }
    setEditing(prev => prev ? { ...prev, items: [...(prev.items ?? []), item] } : prev)
    setItemQuery('')
  }

  function removeTemplateItem(idx: number) {
    setEditing(prev => {
      if (!prev) return prev
      const items = [...(prev.items ?? [])]
      items.splice(idx, 1)
      return { ...prev, items }
    })
  }

  async function handleSave() {
    if (!editing?.name?.trim()) return
    setSaving(true)
    const data: Omit<Template, 'id'> = {
      name: editing.name!.trim(),
      category: editing.category ?? 'camping',
      phase: editing.phase ?? 'pre_early',
      items: editing.items ?? [],
    }
    if ((editing as Template).id) {
      await updateTemplate((editing as Template).id, data)
    } else {
      await addTemplate(data)
    }
    setSaving(false)
    setEditing(null)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete template?')) return
    await deleteTemplate(id)
  }

  const suggestions = catalog
    .filter(c => !itemQuery || c.name.toLowerCase().includes(itemQuery.toLowerCase()))
    .filter(c => !(editing?.items ?? []).some(i => i.catalogItemId === c.id))
    .slice(0, 10)

  return (
    <div className="flex flex-col h-dvh bg-gray-50">
      <div className="flex items-center justify-between px-4 pt-4 pb-3 bg-white border-b border-gray-100">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-gray-600 p-1 -ml-1">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-bold text-gray-800">Templates</h1>
        </div>
        <Button size="icon" onClick={openNew}><Plus className="w-5 h-5" /></Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {templates.map(t => (
          <div key={t.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-4">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <p className="font-semibold text-gray-800">{t.name}</p>
                <p className="text-sm text-gray-500 mt-0.5">
                  {PHASES.find(p => p.value === t.phase)?.label} · {t.items.length} items
                </p>
              </div>
              <button onClick={() => openEdit(t)} className="text-gray-400 hover:text-gray-600 p-1.5">
                <Pencil className="w-4 h-4" />
              </button>
              <button onClick={() => handleDelete(t.id)} className="text-gray-400 hover:text-red-500 p-1.5">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            {t.items.length > 0 && (
              <ul className="mt-2 text-sm text-gray-500 flex flex-col gap-0.5">
                {t.items.slice(0, 4).map((item, i) => (
                  <li key={i}>· {item.name}</li>
                ))}
                {t.items.length > 4 && <li className="text-gray-400">+{t.items.length - 4} more</li>}
              </ul>
            )}
          </div>
        ))}
        {templates.length === 0 && (
          <p className="text-center text-gray-400 text-sm py-10">No templates yet</p>
        )}
      </div>

      {/* Edit Sheet */}
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing && (editing as Template).id ? 'Edit template' : 'New template'} side="right">
        {editing && (
          <div className="p-4 flex flex-col gap-4 pb-24">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Name</label>
              <Input value={editing.name ?? ''} onChange={e => updateField('name', e.target.value)} placeholder="e.g. Pre-trip essentials" autoFocus />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Phase</label>
              <div className="grid grid-cols-2 gap-2">
                {PHASES.map(p => (
                  <button
                    key={p.value}
                    onClick={() => updateField('phase', p.value)}
                    className={`py-2.5 px-3 rounded-xl text-sm font-medium border-2 transition-colors ${editing.phase === p.value ? 'border-[#2f6b4f] bg-[#2f6b4f] text-white' : 'border-gray-200 text-gray-600'}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Items</label>
              {(editing.items ?? []).map((item, idx) => (
                <div key={idx} className="flex items-center gap-2 py-2 border-b border-gray-50">
                  <span className="flex-1 text-sm text-gray-800">{item.name}</span>
                  <button onClick={() => removeTemplateItem(idx)} className="text-gray-400 hover:text-red-400 p-1">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <div className="mt-2">
                <Input
                  value={itemQuery}
                  onChange={e => setItemQuery(e.target.value)}
                  placeholder="Search catalog to add items…"
                />
                {itemQuery && (
                  <div className="mt-1 border border-gray-100 rounded-xl overflow-hidden">
                    {suggestions.map(c => (
                      <button
                        key={c.id}
                        onClick={() => addTemplateItem(c.id, c.name)}
                        className="flex items-center justify-between w-full px-4 py-3 border-b border-gray-50 last:border-0 text-left hover:bg-gray-50"
                      >
                        <span className="text-sm text-gray-800">{c.name}</span>
                        <Plus className="w-4 h-4 text-gray-400" />
                      </button>
                    ))}
                    {suggestions.length === 0 && (
                      <button
                        onClick={() => addTemplateItem('', itemQuery.trim())}
                        className="flex items-center gap-2 w-full px-4 py-3 text-sm text-[#2f6b4f]"
                      >
                        <Plus className="w-4 h-4" /> Add "{itemQuery}"
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-4">
          <Button size="lg" className="w-full" onClick={handleSave} disabled={saving || !editing?.name?.trim()}>
            Save template
          </Button>
        </div>
      </Sheet>
    </div>
  )
}

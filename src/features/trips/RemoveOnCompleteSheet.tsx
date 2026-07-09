import { useEffect, useState } from 'react'
import { X, CircleCheck, Check } from 'lucide-react'
import { getTripChecklistsWithItems, setItemRemoveOnComplete } from '@/lib/firestore'
import { checklistTitle } from '@/lib/checklistTitle'
import { Button } from '@/components/ui/button'
import type { Checklist, ChecklistItem, UserIdentity } from '@/types'

interface Props {
  tripId: string
  identity: UserIdentity
  onClose: () => void
}

/**
 * Batch editor for the per-item "remove after completion" flag (§20): shows
 * every item on the trip with its current flag, lets the user tap items to
 * toggle, and writes only the ones that changed on Save.
 */
export function RemoveOnCompleteSheet({ tripId, identity, onClose }: Props) {
  const [groups, setGroups] = useState<{ checklist: Checklist; items: ChecklistItem[] }[] | null>(null)
  const [flagged, setFlagged] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    getTripChecklistsWithItems(tripId).then(data => {
      if (cancelled) return
      const visible = data.filter(g => !g.checklist.hidden && g.items.length > 0)
      setGroups(visible)
      setFlagged(new Set(visible.flatMap(g => g.items.filter(i => i.removeOnComplete).map(i => i.id))))
    })
    return () => { cancelled = true }
  }, [tripId])

  function toggle(id: string) {
    setFlagged(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSave() {
    if (!groups) return
    setSaving(true)
    for (const { checklist, items } of groups) {
      for (const item of items) {
        const want = flagged.has(item.id)
        if (want === !!item.removeOnComplete) continue
        await setItemRemoveOnComplete(tripId, checklist.id, item, want, identity)
      }
    }
    onClose()
  }

  const total = groups?.reduce((n, g) => n + g.items.length, 0) ?? 0

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-gray-100">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-gray-800">Remove after completion</h2>
          <p className="text-xs text-gray-500">
            Tap items that should disappear from later stops once checked off.
          </p>
        </div>
        <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {groups === null ? (
          <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
        ) : total === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">No items on this trip yet.</p>
        ) : (
          groups.map(({ checklist, items }) => (
            <div key={checklist.id} className="mb-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
                {checklistTitle(checklist)}
              </h3>
              <div className="space-y-1">
                {items.map(item => {
                  const on = flagged.has(item.id)
                  return (
                    <button
                      key={item.id}
                      onClick={() => toggle(item.id)}
                      className={`flex items-center gap-2 w-full px-3 py-2.5 rounded-xl border text-sm text-left transition-colors ${
                        on
                          ? 'border-[#2f6b4f] bg-[#2f6b4f]/5 text-[#2f6b4f]'
                          : 'border-gray-200 text-gray-700'
                      }`}
                    >
                      <CircleCheck className={`w-4 h-4 shrink-0 ${on ? '' : 'text-gray-300'}`} />
                      <span className="flex-1 truncate">{item.name}</span>
                      {on && <Check className="w-4 h-4 shrink-0" />}
                    </button>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-gray-100 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] flex items-center gap-3">
        <span className="text-sm text-gray-500 flex-1">{flagged.size} flagged</span>
        <Button onClick={handleSave} disabled={saving || groups === null}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

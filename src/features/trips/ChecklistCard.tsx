import { useState } from 'react'
import { useChecklistItems } from '@/hooks/useFirestore'
import { toggleItem, deleteItem } from '@/lib/firestore'
import { useAppStore } from '@/lib/store'
import { Progress } from '@/components/ui/progress'
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import type { Checklist } from '@/types'

interface Props {
  checklist: Checklist
  tripId: string
  onAddItem: () => void
}

export function ChecklistCard({ checklist, tripId, onAddItem }: Props) {
  const identity = useAppStore(s => s.identity)!
  const items = useChecklistItems(tripId, checklist.id)
  const [expanded, setExpanded] = useState(true)

  const checked = items.filter(i => i.checked).length
  const total = items.length
  const progress = total ? (checked / total) * 100 : 0

  async function handleToggle(itemId: string, currentChecked: boolean, rev: number) {
    await toggleItem(tripId, checklist.id, itemId, !currentChecked, identity, rev)
  }

  async function handleDelete(itemId: string) {
    await deleteItem(tripId, checklist.id, itemId)
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Card header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <button
          className="flex-1 text-left"
          onClick={() => setExpanded(v => !v)}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-semibold text-gray-800">{checklist.name}</span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">{checked}/{total}</span>
              {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </div>
          </div>
          <Progress value={progress} />
        </button>
      </div>

      {/* Items */}
      {expanded && (
        <div className="border-t border-gray-50">
          {items.map(item => (
            <div
              key={item.id}
              className={`flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0 ${item.checked ? 'bg-green-50/50' : ''}`}
            >
              {/* Checkbox */}
              <button
                onClick={() => handleToggle(item.id, item.checked, item.rev)}
                className={`w-6 h-6 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                  item.checked
                    ? 'bg-green-500 border-green-500 text-white'
                    : 'border-gray-300'
                }`}
              >
                {item.checked && (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>

              {/* Name */}
              <div className="flex-1 min-w-0">
                <span className={`text-base ${item.checked ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                  {item.name}
                </span>
                {item.qty && (
                  <span className="text-sm text-gray-500 ml-1">× {item.qty}</span>
                )}
                {item.frozenField && (
                  <span className="ml-2 text-xs text-amber-600">⚠ conflict</span>
                )}
              </div>

              {/* Delete */}
              <button
                onClick={() => handleDelete(item.id)}
                className="text-gray-300 hover:text-red-400 p-1"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}

          {/* Add item button */}
          <button
            onClick={onAddItem}
            className="flex items-center gap-2 w-full px-4 py-3 text-sm text-[#1e3a5f] font-medium hover:bg-blue-50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add item
          </button>
        </div>
      )}
    </div>
  )
}

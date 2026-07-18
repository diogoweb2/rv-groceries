import { useState, useMemo } from 'react'
import { useCatalog } from '@/hooks/useFirestore'
import { parseCampingFlag } from '@/lib/firestore'
import { Sheet } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Search, Plus, Globe } from 'lucide-react'
import { RvIcon } from '@/components/RvIcon'
import type { SupermarketItem } from '@/types'

interface Props {
  storeName: string
  items: SupermarketItem[]
  onAdd: (name: string, anywhere: boolean) => Promise<void>
  onClose: () => void
}

// Add-item sheet for a supermarket list — the same shape as the trip's sheet,
// minus the destination step. Stays open after each add so several items can be
// added in a row.
export function AddSupermarketItemSheet({ storeName, items, onAdd, onClose }: Props) {
  const catalog = useCatalog()
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  // When on, each item is added to every active store list at once (§15).
  const [anywhere, setAnywhere] = useState(false)

  const parsed = parseCampingFlag(query)
  const existingNames = new Set(items.map(i => i.name.toLowerCase()))

  // Supermarket items only — grocery/general, ranked by grocery usage (§16).
  const suggestions = useMemo(() => {
    const q = parsed.name.toLowerCase().trim()
    if (!q) return []
    const seen = new Set<string>()
    return catalog
      .filter(c => c.category === 'grocery' || c.category === 'general')
      .filter(c => !existingNames.has(c.name.toLowerCase()))
      .filter(c => c.name.toLowerCase().includes(q))
      .sort((a, b) => (b.stats?.totalGrocery ?? 0) - (a.stats?.totalGrocery ?? 0))
      .filter(c => {
        const key = c.name.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 8)
  }, [catalog, parsed.name, existingNames])

  const hasExact = catalog.some(c => c.name.toLowerCase() === parsed.name.toLowerCase().trim())

  // The typed text is passed through verbatim so the "<name> -> camping"
  // shorthand still reaches the caller's parser.
  async function add(name: string) {
    if (!name.trim() || saving) return
    setSaving(true)
    await onAdd(name, anywhere)
    setSaving(false)
    setQuery('')
  }

  return (
    <Sheet open onClose={onClose} title={`Add to ${storeName}`}>
      <div className="p-4 border-b border-gray-100">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add(query)}
            placeholder="Search or type new item..."
            className="pl-9"
            autoFocus
          />
        </div>
        {parsed.forCamping && (
          <p className="pt-2 text-xs text-[#2f6b4f] flex items-center gap-1">
            <RvIcon className="w-4 h-4" active /> “{parsed.name}” will be flagged for camping
          </p>
        )}
        {/* Add to every active store list at once, and keep them synced (§15). */}
        <button
          type="button"
          onClick={() => setAnywhere(a => !a)}
          className={`mt-3 flex items-center gap-2 w-full rounded-xl border px-3 py-2.5 text-sm transition-colors ${
            anywhere ? 'border-[#2f6b4f] bg-emerald-50 text-[#2f6b4f]' : 'border-gray-200 text-gray-600'
          }`}
        >
          <Globe className="w-4 h-4 shrink-0" />
          <span className="flex-1 text-left font-medium">Add to all stores</span>
          <span className={`w-9 h-5 rounded-full relative transition-colors ${anywhere ? 'bg-[#2f6b4f]' : 'bg-gray-300'}`}>
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${anywhere ? 'translate-x-4' : ''}`} />
          </span>
        </button>
      </div>

      <div className="flex flex-col">
        {suggestions.map(c => (
          <button
            key={c.id}
            onClick={() => add(parsed.forCamping ? `${c.name} -> camping` : c.name)}
            disabled={saving}
            className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-50 hover:bg-gray-50 text-left"
          >
            <div className="w-8 h-8 rounded-full bg-[#2f6b4f] flex items-center justify-center shrink-0">
              <Plus className="w-4 h-4 text-white" />
            </div>
            <span className="flex-1 min-w-0 text-base text-gray-800">{c.name}</span>
            {(c.stats?.totalGrocery ?? 0) > 0 && (
              <span className="text-xs text-gray-400">×{c.stats.totalGrocery}</span>
            )}
          </button>
        ))}

        {parsed.name.trim() && !hasExact && (
          <button
            onClick={() => add(query)}
            disabled={saving}
            className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-50 last:border-0 hover:bg-gray-50"
          >
            <div className="w-8 h-8 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center shrink-0">
              <Plus className="w-4 h-4 text-gray-400" />
            </div>
            <span className="text-base text-gray-500">Add "<strong className="text-gray-800">{parsed.name.trim()}</strong>"</span>
          </button>
        )}

        {suggestions.length === 0 && !parsed.name.trim() && (
          <p className="text-center text-gray-400 text-sm py-8">
            Type to search the item catalog
          </p>
        )}
      </div>
    </Sheet>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { useChecklistItems } from '@/hooks/useFirestore'
import {
  TRIP_STAGES, TRIP_STOPS, displayedDestination,
  setStageItemDone, setItemDestination, itemDestination,
} from '@/lib/firestore'
import { destinationMeta, destinationIcon, nextDestination } from './destination'
import { useAppStore } from '@/lib/store'
import { Progress } from '@/components/ui/progress'
import { ShieldAlert, Check } from 'lucide-react'
import type { Trip, Checklist, ChecklistItem, ItemDestination } from '@/types'

// Invisible collector: subscribes to one checklist's items and lifts them up so
// the stage view can work across every list in the trip.
function ItemsCollector({ tripId, checklist, onItems }: {
  tripId: string
  checklist: Checklist
  onItems: (checklistId: string, items: ChecklistItem[]) => void
}) {
  const items = useChecklistItems(tripId, checklist.id)
  useEffect(() => { onItems(checklist.id, items) }, [checklist.id, items, onItems])
  return null
}

// The stops at which an item counts as handled.
// - Groceries: buying it (`checked`) is the handling, and it happens at Home.
// - Other items: the per-stop marks. Items checked from a checklist card before
//   the card check began mirroring into `stagesDone` have `checked: true` and no
//   stops recorded, so read those as handled at Home too.
function handledStops(item: ChecklistItem, isGrocery: boolean): number[] {
  if (isGrocery) return item.checked ? [0] : []
  const stages = item.stagesDone ?? []
  if (stages.length === 0 && item.checked) return [0]
  return stages
}

export function StageView({ trip, checklists }: { trip: Trip; checklists: Checklist[] }) {
  const identity = useAppStore(s => s.identity)!
  const [itemsByList, setItemsByList] = useState<Record<string, ChecklistItem[]>>({})

  const onItems = useCallback((checklistId: string, items: ChecklistItem[]) => {
    setItemsByList(prev => ({ ...prev, [checklistId]: items }))
  }, [])

  const stop = Math.min(Math.max(trip.currentStop ?? 0, 0), TRIP_STOPS.length - 1)
  const stage = TRIP_STAGES[stop]

  const groceryListIds = new Set(checklists.filter(c => c.phase === 'grocery').map(c => c.id))

  // Only what was actually handled at an earlier stop travels to this one (§20):
  // an item left unchecked never made it into the truck, so there is nothing to
  // stow, sort, or bring inside. An unbought grocery is the same case.
  // "Remove after completion" items are the exception in reverse — being handled
  // is exactly what retires them, so they don't travel on.
  //
  // The return warehouse (stop 3) is the catch-up for whatever wasn't stowed at
  // the campsite (stop 2), so anything already stowed there is done and drops
  // out. Un-checking it at the campsite brings it back.
  const allItems = checklists
    .flatMap(c => itemsByList[c.id] ?? [])
    .filter(i => {
      const handled = handledStops(i, groceryListIds.has(i.checklistId))
      const handledEarlier = handled.some(s => s < stop)
      const stowedAtCampsite = stop === 3 && handled.includes(2)
      return handledEarlier && !i.removeOnComplete && !stowedAtCampsite
    })
  const shown = stage.itemFilter
    ? allItems.filter(i => stage.itemFilter!(itemDestination(i)))
    : []

  const done = shown.filter(i => (i.stagesDone ?? []).includes(stop)).length

  async function toggle(item: ChecklistItem) {
    const isDone = (item.stagesDone ?? []).includes(stop)
    await setStageItemDone(trip.id, item.checklistId, item, stop, !isDone, identity)
  }
  async function cycleDest(item: ChecklistItem) {
    const cl = checklists.find(c => c.id === item.checklistId)
    if (cl) await setItemDestination(trip.id, cl, item, nextDestination(itemDestination(item)), identity)
  }
  // Group shown items by their *displayed* destination (Home→Truck where the
  // stage remaps it), so RV vs truck reads at a glance.
  const groups: { dest: ItemDestination; items: ChecklistItem[] }[] = []
  const order: ItemDestination[] = ['rv', 'truck', 'home']
  for (const dest of order) {
    const group = shown
      .filter(i => (displayedDestination(itemDestination(i), stop) ?? 'home') === dest)
      .sort((a, b) => Number((a.stagesDone ?? []).includes(stop)) - Number((b.stagesDone ?? []).includes(stop)))
    if (group.length) groups.push({ dest, items: group })
  }

  return (
    <div className="flex flex-col gap-4">
      {checklists.map(c => (
        <ItemsCollector key={c.id} tripId={trip.id} checklist={c} onItems={onItems} />
      ))}

      {stage.itemFilter === null ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-8 flex flex-col items-center text-center gap-2">
          <ShieldAlert className="w-8 h-8 text-[#2f6b4f]" />
          <p className="font-semibold text-gray-800">At the {TRIP_STOPS[stop]}</p>
          <p className="text-sm text-gray-500">Nothing to sort here — open the safety checklist above to continue.</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-8 text-center">
          <p className="text-sm text-gray-500">No items for this stop.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 pt-4 pb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-semibold text-gray-800">{stage.label}</span>
              <span className="text-sm text-gray-500">{done}/{shown.length}</span>
            </div>
            <Progress value={shown.length ? (done / shown.length) * 100 : 0} />
          </div>

          {groups.map(group => {
            const meta = destinationMeta(group.dest)
            const Icon = destinationIcon(group.dest)
            return (
              <div key={group.dest} className="border-t border-gray-50">
                <p className="flex items-center gap-1.5 px-4 pt-2.5 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  <Icon className="w-3.5 h-3.5" /> {meta?.label ?? 'Destination'}
                </p>
                {group.items.map(item => {
                  const isDone = (item.stagesDone ?? []).includes(stop)
                  const actual = itemDestination(item)
                  const DispIcon = destinationIcon(displayedDestination(actual, stop))
                  return (
                    <div key={item.id} className={`flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0 ${isDone ? 'bg-green-50/50' : ''}`}>
                      <button
                        onClick={() => toggle(item)}
                        className={`w-6 h-6 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${isDone ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300'}`}
                        aria-label={isDone ? 'Mark not done' : 'Mark done'}
                      >
                        {isDone && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                      </button>
                      <span className={`flex-1 min-w-0 text-base ${isDone ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                        {item.name}
                      </span>
                      <button
                        onClick={() => cycleDest(item)}
                        aria-label="Change final destination"
                        className="p-2.5 -m-1 text-[#2f6b4f]"
                      >
                        <DispIcon className="w-5 h-5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

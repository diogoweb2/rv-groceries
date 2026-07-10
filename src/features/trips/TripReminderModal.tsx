import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/dialog'
import { fetchTripRemindersFor } from '@/lib/firestore'
import { localToday } from '@/lib/date'
import type { ChecklistItem, Trip, UserIdentity } from '@/types'

/** Days between today and the trip's start date, in local calendar days. */
function daysUntilStart(trip: Trip): number {
  return Math.round(
    (new Date(trip.startDate + 'T00:00:00').getTime() - new Date(localToday() + 'T00:00:00').getTime()) / 86_400_000
  )
}

/**
 * §21: opening the app 1–2 days before a trip shows that person's reminder items.
 * It reappears on every app open until they mute it, and muting lasts only for the
 * current day — the next day it reminds again.
 */
export function TripReminderModal({ trip, identity }: { trip: Trip; identity: UserIdentity }) {
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [open, setOpen] = useState(false)
  const [muted, setMuted] = useState(false)

  const days = daysUntilStart(trip)
  const due = days === 1 || days === 2
  const muteKey = `tripReminderMuted:${trip.id}:${identity}:${localToday()}`

  useEffect(() => {
    if (!due || localStorage.getItem(muteKey)) return
    let cancelled = false
    fetchTripRemindersFor(trip.id, identity).then(found => {
      if (cancelled || found.length === 0) return
      setItems(found.map(f => f.item))
      setOpen(true)
    })
    return () => { cancelled = true }
  }, [due, muteKey, trip.id, identity])

  function close() {
    setOpen(false)
    if (muted) localStorage.setItem(muteKey, '1')
  }

  return (
    <Dialog open={open} onClose={close} title={days === 1 ? 'Tomorrow' : 'In 2 days'}>
      <ul className="flex flex-col gap-3 mb-6">
        {items.map(item => (
          <li key={item.id} className="text-2xl font-bold text-gray-900 leading-snug">
            {item.name}
          </li>
        ))}
      </ul>

      <label className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <input type="checkbox" checked={muted} onChange={e => setMuted(e.target.checked)} className="w-4 h-4" />
        Don't remind me today anymore
      </label>

      <button onClick={close} className="w-full bg-[#2f6b4f] text-white py-3 rounded-xl font-bold">
        Close
      </button>
    </Dialog>
  )
}

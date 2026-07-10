import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/dialog'
import { fetchTripRemindersFor, dismissItemReminderFor } from '@/lib/firestore'
import { Bell } from 'lucide-react'
import type { ChecklistItem, Trip, UserIdentity } from '@/types'

type Row = { checklistId: string; item: ChecklistItem }

/** Today as YYYY-MM-DD in the device's own timezone (never UTC — evenings roll over early). */
function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Days between today and the trip's start date, in local calendar days. */
function daysUntilStart(trip: Trip): number {
  return Math.round(
    (new Date(trip.startDate + 'T00:00:00').getTime() - new Date(localToday() + 'T00:00:00').getTime()) / 86_400_000
  )
}

/**
 * §21: on opening the app 1–2 days before a trip, show that person's reminder
 * items once per day. "Don't remind me anymore" opts this identity out of them.
 */
export function TripReminderModal({ trip, identity }: { trip: Trip; identity: UserIdentity }) {
  const [rows, setRows] = useState<Row[]>([])
  const [open, setOpen] = useState(false)
  const [muted, setMuted] = useState(false)

  const days = daysUntilStart(trip)
  const due = days === 1 || days === 2
  const seenKey = `tripReminderSeen:${trip.id}:${identity}:${localToday()}`

  useEffect(() => {
    if (!due || localStorage.getItem(seenKey)) return
    let cancelled = false
    fetchTripRemindersFor(trip.id, identity).then(found => {
      // Marking "seen" only once the modal actually opens, so a cancelled effect
      // run (StrictMode remount) doesn't swallow the reminder for the whole day.
      if (cancelled || found.length === 0) return
      setRows(found)
      setOpen(true)
      localStorage.setItem(seenKey, '1')
    })
    return () => { cancelled = true }
  }, [due, seenKey, trip.id, identity])

  async function close() {
    setOpen(false)
    if (muted) {
      await Promise.all(rows.map(r => dismissItemReminderFor(trip.id, r.checklistId, r.item, identity)))
    }
  }

  return (
    <Dialog open={open} onClose={close} title={days === 1 ? 'Trip starts tomorrow' : 'Trip in 2 days'}>
      <p className="text-sm text-gray-500 mb-3">
        Reminders for <span className="font-medium text-gray-700">{trip.title}</span>:
      </p>
      <ul className="flex flex-col gap-2 mb-5">
        {rows.map(({ item }) => (
          <li key={item.id} className="flex items-center gap-2 text-sm text-gray-800">
            <Bell className="w-4 h-4 text-[#2f6b4f] shrink-0" />
            <span className="truncate">{item.name}</span>
          </li>
        ))}
      </ul>

      <label className="flex items-center gap-2 text-sm text-gray-600 mb-4">
        <input type="checkbox" checked={muted} onChange={e => setMuted(e.target.checked)} className="w-4 h-4" />
        Don't remind me anymore
      </label>

      <button onClick={close} className="w-full bg-[#2f6b4f] text-white py-3 rounded-xl font-bold">
        Close
      </button>
    </Dialog>
  )
}

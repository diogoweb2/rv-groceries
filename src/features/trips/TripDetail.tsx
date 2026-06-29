import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTrips, useChecklists } from '@/hooks/useFirestore'
import { updateTrip, deleteTrip, recordTripStats } from '@/lib/firestore'
import { useAppStore } from '@/lib/store'
import { ChecklistCard } from './ChecklistCard'
import { AddItemSheet } from './AddItemSheet'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, MoreVertical, CalendarDays, Trash2, CheckCircle } from 'lucide-react'
import type { Trip } from '@/types'

const PHASE_LABELS: Record<string, string> = {
  pre_early: 'Before the trip',
  pre_dayof: 'Day of departure',
  pack_down: 'Pack down / return',
  grocery: 'Groceries',
}

const STATUS_BADGE: Record<Trip['status'], { label: string; variant: 'default' | 'success' | 'warning' | 'info' }> = {
  planned: { label: 'Planned', variant: 'info' },
  active: { label: 'Active', variant: 'warning' },
  completed: { label: 'Done', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'default' },
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function TripDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const trips = useTrips()
  const checklists = useChecklists(id)
  const identity = useAppStore(s => s.identity)!
  const [menuOpen, setMenuOpen] = useState(false)
  const [addingTo, setAddingTo] = useState<string | null>(null)

  const trip = trips.find(t => t.id === id)
  if (!trip) return (
    <div className="flex items-center justify-center min-h-dvh">
      <p className="text-gray-400">Trip not found</p>
    </div>
  )

  const currentTrip = trip
  const badge = STATUS_BADGE[currentTrip.status]

  async function markComplete() {
    await updateTrip(id!, { status: 'completed' })
    await recordTripStats(id!, currentTrip.amenities, identity)
    setMenuOpen(false)
  }

  async function handleDelete() {
    if (!confirm('Delete this trip?')) return
    await deleteTrip(id!)
    navigate('/trips', { replace: true })
  }

  async function setStatus(status: Trip['status']) {
    await updateTrip(id!, { status })
    setMenuOpen(false)
  }

  // Group checklists by phase
  const byPhase = checklists.reduce<Record<string, typeof checklists>>((acc, cl) => {
    if (!acc[cl.phase]) acc[cl.phase] = []
    acc[cl.phase].push(cl)
    return acc
  }, {})

  const phaseOrder = ['pre_early', 'pre_dayof', 'pack_down', 'grocery']

  return (
    <div className="flex flex-col h-dvh bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <div className="flex items-center gap-2 px-4 pt-4 pb-3">
          <button onClick={() => navigate('/trips')} className="text-gray-600 p-1 -ml-1">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-gray-800 truncate">{trip.title}</h1>
          </div>
          <Badge variant={badge.variant}>{badge.label}</Badge>
          <div className="relative">
            <button onClick={() => setMenuOpen(v => !v)} className="p-2 text-gray-500">
              <MoreVertical className="w-5 h-5" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full z-20 bg-white rounded-xl shadow-lg border border-gray-100 py-1 min-w-40">
                  {trip.status !== 'active' && (
                    <button onClick={() => setStatus('active')} className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                      Mark as Active
                    </button>
                  )}
                  {trip.status !== 'completed' && (
                    <button onClick={markComplete} className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-green-600 hover:bg-gray-50">
                      <CheckCircle className="w-4 h-4" /> Mark Complete
                    </button>
                  )}
                  {trip.status !== 'planned' && (
                    <button onClick={() => setStatus('planned')} className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                      Mark as Planned
                    </button>
                  )}
                  <button onClick={handleDelete} className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-red-500 hover:bg-gray-50">
                    <Trash2 className="w-4 h-4" /> Delete trip
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 px-5 pb-3 text-sm text-gray-500">
          <CalendarDays className="w-4 h-4" />
          <span>{formatDate(trip.startDate)} — {formatDate(trip.endDate)}</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-8 flex flex-col gap-6">
        {phaseOrder.map(phase => {
          const phaseLists = byPhase[phase]
          if (!phaseLists?.length) return null
          return (
            <div key={phase}>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1">
                {PHASE_LABELS[phase] ?? phase}
              </h2>
              <div className="flex flex-col gap-3">
                {phaseLists.map(cl => (
                  <ChecklistCard
                    key={cl.id}
                    checklist={cl}
                    tripId={id!}
                    onAddItem={() => setAddingTo(cl.id)}
                  />
                ))}
              </div>
            </div>
          )
        })}

        {checklists.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <p className="text-base font-medium">No checklists yet</p>
            <p className="text-sm">This trip has no checklists attached</p>
          </div>
        )}
      </div>

      {/* Add Item Sheet */}
      {addingTo && (
        <AddItemSheet
          tripId={id!}
          checklistId={addingTo}
          onClose={() => setAddingTo(null)}
        />
      )}
    </div>
  )
}


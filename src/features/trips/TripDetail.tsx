import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTrips, useChecklists } from '@/hooks/useFirestore'
import { updateTrip, deleteTrip, recordTripStats, addChecklist } from '@/lib/firestore'
import { useAppStore } from '@/lib/store'
import { ChecklistCard } from './ChecklistCard'
import { AddItemSheet } from './AddItemSheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog } from '@/components/ui/dialog'
import { ArrowLeft, MoreVertical, CalendarDays, Trash2, CheckCircle, Plus } from 'lucide-react'
import type { Trip, ChecklistPhase } from '@/types'

const PHASES: { value: ChecklistPhase; label: string }[] = [
  { value: 'pre_early', label: 'Before the trip' },
  { value: 'pre_dayof', label: 'Day of departure' },
  { value: 'pack_down', label: 'Pack down / return' },
  { value: 'grocery', label: 'Groceries' },
]

const phaseOrder: ChecklistPhase[] = ['pre_early', 'pre_dayof', 'pack_down', 'grocery']

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
  const [newChecklist, setNewChecklist] = useState<{ name: string; phase: ChecklistPhase } | null>(null)
  const [savingChecklist, setSavingChecklist] = useState(false)

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

  async function handleAddChecklist() {
    if (!newChecklist?.name.trim()) return
    setSavingChecklist(true)
    await addChecklist(id!, {
      name: newChecklist.name.trim(),
      phase: newChecklist.phase,
      order: phaseOrder.indexOf(newChecklist.phase),
    })
    setSavingChecklist(false)
    setNewChecklist(null)
  }

  // Group checklists by phase
  const byPhase = checklists.reduce<Record<string, typeof checklists>>((acc, cl) => {
    if (!acc[cl.phase]) acc[cl.phase] = []
    acc[cl.phase].push(cl)
    return acc
  }, {})

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
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <p className="text-base font-medium">No checklists yet</p>
            <p className="text-sm">Add one below to get started</p>
          </div>
        )}

        {/* Add checklist */}
        <button
          onClick={() => setNewChecklist({ name: '', phase: 'pre_early' })}
          className="flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl border-2 border-dashed border-gray-200 text-[#1e3a5f] font-medium hover:bg-blue-50 transition-colors"
        >
          <Plus className="w-5 h-5" />
          Add checklist
        </button>
      </div>

      {/* Add Item Sheet */}
      {addingTo && (
        <AddItemSheet
          tripId={id!}
          checklistId={addingTo}
          onClose={() => setAddingTo(null)}
        />
      )}

      {/* New checklist dialog */}
      <Dialog open={!!newChecklist} onClose={() => setNewChecklist(null)} title="New checklist">
        {newChecklist && (
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Name</label>
              <Input
                value={newChecklist.name}
                onChange={e => setNewChecklist({ ...newChecklist, name: e.target.value })}
                placeholder="e.g. Kitchen gear"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleAddChecklist()}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Section</label>
              <div className="grid grid-cols-2 gap-2">
                {PHASES.map(p => (
                  <button
                    key={p.value}
                    onClick={() => setNewChecklist({ ...newChecklist, phase: p.value })}
                    className={`py-2.5 px-3 rounded-xl text-sm font-medium border-2 transition-colors ${newChecklist.phase === p.value ? 'border-[#1e3a5f] bg-[#1e3a5f] text-white' : 'border-gray-200 text-gray-600'}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="secondary" className="flex-1" onClick={() => setNewChecklist(null)}>Cancel</Button>
              <Button className="flex-1" onClick={handleAddChecklist} disabled={savingChecklist || !newChecklist.name.trim()}>Add</Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )
}


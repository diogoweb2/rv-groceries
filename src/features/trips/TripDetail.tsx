import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTrips, useChecklists, useAmenities, useOrdering, useStores, useProcedures } from '@/hooks/useFirestore'
import { updateTrip, deleteTrip, completeTrip, savePhaseOrder, saveChecklistOrder, saveChecklistPositions, rateTrip, getTripChecklistsWithItems, findOrCreateOtherChecklist, ensureGroceryChecklists, TRIP_STOPS } from '@/lib/firestore'
import { checklistTitle } from '@/lib/checklistTitle'
import { printLists, type PrintList } from '@/lib/print'
import { useAppStore } from '@/lib/store'
import { ChecklistCard } from './ChecklistCard'
import { AddItemSheet } from './AddItemSheet'
import { TripStepper } from './TripStepper'
import { StageView } from './StageView'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog } from '@/components/ui/dialog'
import { ArrowLeft, MoreVertical, CalendarDays, Trash2, CheckCircle, Plus, Check, Tag, GripVertical, Pencil, MapPin, Star, Eye, Backpack, Truck, PackageOpen, ShoppingCart, Printer, type LucideIcon } from 'lucide-react'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Trip, ChecklistPhase, Checklist } from '@/types'

// Two-list model (§20): only Groceries (per store) and a single Other list.
const PHASE_LABELS: Record<string, string> = {
  grocery: 'Groceries',
  other: 'Packing',
  pre_early: 'Before the trip',
  pre_dayof: 'Day of departure',
  pack_down: 'Pack down / return',
}

const PHASE_ICONS: Record<string, LucideIcon> = {
  grocery: ShoppingCart,
  other: Backpack,
  pre_early: Backpack,
  pre_dayof: Truck,
  pack_down: PackageOpen,
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

function StarIcon({ fill }: { fill: 'empty' | 'half' | 'full' }) {
  return (
    <div className="relative w-10 h-10">
      <Star className="absolute inset-0 w-10 h-10 text-gray-200 fill-gray-200" />
      {fill !== 'empty' && (
        <div className={`absolute inset-0 overflow-hidden ${fill === 'half' ? 'w-1/2' : 'w-full'}`}>
          <Star className="w-10 h-10 text-amber-400 fill-amber-400" />
        </div>
      )}
    </div>
  )
}

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => {
        const fill: 'empty' | 'half' | 'full' = value >= n ? 'full' : value >= n - 0.5 ? 'half' : 'empty'
        return (
          <div key={n} className="relative w-10 h-10">
            <StarIcon fill={fill} />
            <button
              className="absolute inset-y-0 left-0 w-1/2 z-10"
              onClick={() => onChange(n - 0.5)}
              aria-label={`Rate ${n - 0.5} stars`}
            />
            <button
              className="absolute inset-y-0 right-0 w-1/2 z-10"
              onClick={() => onChange(n)}
              aria-label={`Rate ${n} stars`}
            />
          </div>
        )
      })}
    </div>
  )
}

// A draggable phase section (the whole group, with its header handle).
function SortableSection({ phase, label, children }: { phase: ChecklistPhase; label: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `phase:${phase}` })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 20 : undefined,
  }
  const Icon = PHASE_ICONS[phase]
  return (
    <div ref={setNodeRef} style={style}>
      <h2 className="flex items-center gap-1 text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1">
        <button
          {...attributes}
          {...listeners}
          aria-label="Reorder section"
          className="-ml-1 p-1 text-gray-300 hover:text-gray-500 touch-none cursor-grab active:cursor-grabbing"
        >
          <GripVertical className="w-4 h-4" />
        </button>
        {Icon && <Icon className="w-4 h-4 text-gray-400 shrink-0" />}
        {label}
      </h2>
      {children}
    </div>
  )
}

// A draggable checklist card within a section.
function SortableChecklist({ checklist, tripId, onAddItem }: {
  checklist: Checklist
  tripId: string
  onAddItem: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: checklist.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  }
  return (
    <div ref={setNodeRef} style={style} id={`checklist-${checklist.id}`} className="scroll-mt-4">
      <ChecklistCard
        checklist={checklist}
        tripId={tripId}
        onAddItem={onAddItem}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  )
}

export function TripDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const trips = useTrips()
  const checklists = useChecklists(id)
  const amenities = useAmenities()
  const ordering = useOrdering()
  const identity = useAppStore(s => s.identity)!
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const [menuOpen, setMenuOpen] = useState(false)
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const stores = useStores()
  const [editAmenities, setEditAmenities] = useState<string[] | null>(null)
  const [editTitle, setEditTitle] = useState<string | null>(null)
  const [ratingOpen, setRatingOpen] = useState(false)
  const [pendingRating, setPendingRating] = useState(0)
  const [showHidden, setShowHidden] = useState(false)
  const [pickingList, setPickingList] = useState(false)
  const procedures = useProcedures()

  // Every trip needs its single Other list to add non-grocery items into (§20).
  useEffect(() => {
    if (id && checklists.length > 0 && !checklists.some(c => c.phase === 'other')) {
      findOrCreateOtherChecklist(id)
    }
  }, [id, checklists])

  // …and one Groceries list per store, created automatically (§20).
  useEffect(() => {
    if (id && stores.length > 0) ensureGroceryChecklists(id, stores)
  }, [id, stores])

  const trip = trips.find(t => t.id === id)
  if (!trip) return (
    <div className="flex items-center justify-center min-h-dvh">
      <p className="text-gray-400">Trip not found</p>
    </div>
  )

  const currentTrip = trip
  const badge = STATUS_BADGE[currentTrip.status]

  // "Print all": every visible (non-hidden) checklist of the trip, outstanding
  // items only, in the trip's phase-section order (§19).
  async function handlePrintAll() {
    setMenuOpen(false)
    const data = await getTripChecklistsWithItems(currentTrip.id)
    const lists: PrintList[] = []
    for (const phase of ordering.phaseOrder) {
      const inPhase = data
        .filter(d => d.checklist.phase === phase && !d.checklist.hidden)
        .sort((a, b) => a.checklist.order - b.checklist.order)
      for (const { checklist, items } of inPhase) {
        const isGrocery = checklist.phase === 'grocery'
        const outstanding = items.filter(i => !i.checked).map(i => {
          const qty = Math.max(1, Number(i.qty) || 1)
          if (isGrocery) return qty > 1 ? `${qty} × ${i.name}` : i.name
          return i.qty && qty > 1 ? `${i.name} × ${i.qty}` : i.name
        })
        lists.push({ name: checklistTitle(checklist), items: outstanding })
      }
    }
    printLists(currentTrip.title, lists)
  }

  async function markComplete() {
    await completeTrip(currentTrip, identity)
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

  function handleSectionDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = String(active.id).replace('phase:', '') as ChecklistPhase
    const to = String(over.id).replace('phase:', '') as ChecklistPhase
    const oldIndex = ordering.phaseOrder.indexOf(from)
    const newIndex = ordering.phaseOrder.indexOf(to)
    if (oldIndex === -1 || newIndex === -1) return
    savePhaseOrder(arrayMove(ordering.phaseOrder, oldIndex, newIndex))
  }

  function handleCardDragEnd(phase: ChecklistPhase, lists: Checklist[]) {
    return (e: DragEndEvent) => {
      const { active, over } = e
      if (!over || active.id === over.id) return
      const oldIndex = lists.findIndex(c => c.id === active.id)
      const newIndex = lists.findIndex(c => c.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return
      const next = arrayMove(lists, oldIndex, newIndex)
      saveChecklistPositions(id!, next)        // persist positions on this trip
      saveChecklistOrder(phase, next.map(c => c.name)) // remember for future trips
    }
  }

  async function handleSaveAmenities() {
    if (editAmenities === null) return
    await updateTrip(id!, { amenities: editAmenities })
    setEditAmenities(null)
  }

  async function handleSaveTitle() {
    if (editTitle === null || !editTitle.trim()) return
    await updateTrip(id!, { title: editTitle.trim() })
    setEditTitle(null)
  }

  function openInMaps() {
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(currentTrip.title)}`, '_blank', 'noopener,noreferrer')
  }

  async function handleRatingSubmit() {
    if (!pendingRating) return
    await rateTrip(id!, identity, pendingRating)
    setRatingOpen(false)
  }

  // "+ Add Item" from the header: pick a checklist, then scroll to it so its own
  // "+ Add item" row is in view for that specific list.
  function handlePickListToAddItem(checklistId: string) {
    setPickingList(false)
    requestAnimationFrame(() => {
      document.getElementById(`checklist-${checklistId}`)?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    })
    // Open that list's Add-item sheet, as if its own "+ Add item" was tapped.
    setAddingTo(checklistId)
  }

  function openRatingDialog() {
    setPendingRating(currentTrip.ratings?.[identity] ?? 0)
    setRatingOpen(true)
  }

  function handleRatingDismiss() {
    setRatingOpen(false)
  }

  const hiddenCount = checklists.filter(c => c.hidden).length

  // Hidden checklists collapse out of the view unless "Show hidden" is on (§5).
  const visibleChecklists = showHidden ? checklists : checklists.filter(c => !c.hidden)

  // Group checklists by phase (each group already sorted by `order`).
  const byPhase = visibleChecklists.reduce<Record<string, typeof checklists>>((acc, cl) => {
    if (!acc[cl.phase]) acc[cl.phase] = []
    acc[cl.phase].push(cl)
    return acc
  }, {})

  // Phase sections to show (only non-empty ones). Two-list model puts Other and
  // Groceries first; legacy phases only linger until migration collapses them.
  const phaseRenderOrder = Array.from(new Set<string>([
    'other', 'grocery', ...ordering.phaseOrder, 'pre_early', 'pre_dayof', 'pack_down',
  ]))
  const visiblePhases = phaseRenderOrder.filter(p => byPhase[p]?.length) as ChecklistPhase[]

  const stop = Math.min(Math.max(currentTrip.currentStop ?? 0, 0), TRIP_STOPS.length - 1)

  return (
    <div className="flex flex-col h-dvh bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <div className="flex items-center gap-2 px-4 pt-4 pb-3">
          <button onClick={() => navigate('/trips')} className="text-gray-600 p-1 -ml-1">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0 flex items-center gap-1">
            <h1 className="text-lg font-bold text-gray-800 truncate">{trip.title}</h1>
            <button
              onClick={() => setEditTitle(trip.title)}
              className="shrink-0 p-1 text-gray-400 hover:text-gray-600"
              aria-label="Edit trip name"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
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
                  <button onClick={() => { setMenuOpen(false); setEditAmenities(trip.amenities) }} className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                    <Tag className="w-4 h-4" /> Edit amenities
                  </button>
                  <button onClick={handlePrintAll} className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                    <Printer className="w-4 h-4" /> Print all lists
                  </button>
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
          <button
            onClick={openInMaps}
            className="ml-2 p-1 text-gray-400 hover:text-[#2f6b4f] transition-colors"
            aria-label="Open in Google Maps"
          >
            <MapPin className="w-4 h-4" />
          </button>
          {/* Trip route stepper + transition safety procedures (§20) */}
          {trip.status !== 'completed' && trip.status !== 'cancelled' && (
            <div className="ml-auto">
              <TripStepper trip={trip} procedures={procedures} onFinished={openRatingDialog} />
            </div>
          )}
        </div>
        <button
          onClick={() => setEditAmenities(trip.amenities)}
          className="flex flex-wrap items-center gap-1.5 px-5 pb-3 w-full text-left"
        >
          {trip.amenities.length > 0 ? (
            trip.amenities.map(aid => {
              const a = amenities.find(x => x.id === aid)
              return a ? (
                <span key={aid} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                  {a.icon} {a.name}
                </span>
              ) : null
            })
          ) : (
            <span className="text-xs text-gray-400">No amenities</span>
          )}
          <span className="text-xs text-[#2f6b4f] font-medium ml-1">Edit</span>
        </button>
        <div className="flex flex-col gap-2 px-5 pb-3">
          <button
            onClick={() => setPickingList(true)}
            disabled={visibleChecklists.length === 0}
            className="flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl bg-[#2f6b4f] text-white text-base font-semibold shadow-sm active:scale-[0.99] transition-transform disabled:opacity-40 disabled:active:scale-100"
          >
            <Plus className="w-5 h-5" /> Add item
          </button>
          {hiddenCount > 0 && (
            <button
              onClick={() => setShowHidden(v => !v)}
              className="flex items-center gap-1 self-start text-sm font-medium text-gray-500 hover:underline"
            >
              <Eye className="w-4 h-4" /> {showHidden ? `Hide hidden (${hiddenCount})` : `Show hidden (${hiddenCount})`}
            </button>
          )}
        </div>
        {(trip.ratings?.diogo !== undefined || trip.ratings?.alice !== undefined) && (
          <div className="flex items-center gap-2 px-5 pb-3 text-xs text-gray-500">
            <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" />
            {trip.ratings.diogo !== undefined && <span>Diogo {trip.ratings.diogo}/5</span>}
            {trip.ratings.diogo !== undefined && trip.ratings.alice !== undefined && <span>·</span>}
            {trip.ratings.alice !== undefined && <span>Alice {trip.ratings.alice}/5</span>}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-8 flex flex-col gap-6">
        {/* Rate / Edit rating — always visible on completed trips */}
        {trip.status === 'completed' && (
          <div className="bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3 flex items-center gap-3">
            <Star className="w-4 h-4 text-amber-400 fill-amber-400 shrink-0" />
            <div className="flex-1 min-w-0">
              {trip.ratings?.[identity] !== undefined ? (
                <p className="text-sm text-gray-700">Your rating: <span className="font-semibold">{trip.ratings[identity]}/5</span></p>
              ) : (
                <p className="text-sm text-gray-700 font-medium">Rate this trip</p>
              )}
            </div>
            <button
              onClick={openRatingDialog}
              className="text-sm font-semibold text-[#2f6b4f]"
            >
              {trip.ratings?.[identity] !== undefined ? 'Edit' : 'Rate'}
            </button>
          </div>
        )}

        {/* Stop 0 (Home) is the editable packing view: the Groceries + Other
            lists. Every later stop shows the derived, per-stop stage view (§20). */}
        {stop === 0 ? (
          <>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSectionDragEnd}>
              <SortableContext items={visiblePhases.map(p => `phase:${p}`)} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-6">
                  {visiblePhases.map(phase => {
                    const phaseLists = byPhase[phase]
                    return (
                      <SortableSection key={phase} phase={phase} label={PHASE_LABELS[phase] ?? phase}>
                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCardDragEnd(phase, phaseLists)}>
                          <SortableContext items={phaseLists.map(c => c.id)} strategy={verticalListSortingStrategy}>
                            <div className="flex flex-col gap-3">
                              {phaseLists.map(cl => (
                                <SortableChecklist
                                  key={cl.id}
                                  checklist={cl}
                                  tripId={id!}
                                  onAddItem={() => setAddingTo(cl.id)}
                                />
                              ))}
                            </div>
                          </SortableContext>
                        </DndContext>
                      </SortableSection>
                    )
                  })}
                </div>
              </SortableContext>
            </DndContext>

            {checklists.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <p className="text-base font-medium">No lists yet</p>
              </div>
            )}
          </>
        ) : (
          <StageView trip={currentTrip} checklists={checklists.filter(c => !c.hidden)} />
        )}
      </div>

      {/* Add Item Sheet */}
      {addingTo && checklists.find(c => c.id === addingTo) && (
        <AddItemSheet
          tripId={id!}
          checklist={checklists.find(c => c.id === addingTo)!}
          onClose={() => setAddingTo(null)}
        />
      )}

      {/* Edit amenities */}
      <Dialog open={editAmenities !== null} onClose={() => setEditAmenities(null)} title="Trip amenities">
        {editAmenities !== null && (
          <div className="flex flex-col gap-4">
            {amenities.length === 0 ? (
              <p className="text-sm text-gray-500">No amenities defined yet. Add some in Manage → Amenities.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {amenities.map(a => {
                  const active = editAmenities.includes(a.id)
                  return (
                    <button
                      key={a.id}
                      onClick={() => setEditAmenities(
                        active ? editAmenities.filter(x => x !== a.id) : [...editAmenities, a.id]
                      )}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border-2 transition-colors ${
                        active ? 'border-[#2f6b4f] bg-[#2f6b4f] text-white' : 'border-gray-200 bg-white text-gray-700'
                      }`}
                    >
                      {active && <Check className="w-3.5 h-3.5" />}
                      <span>{a.icon}</span>
                      <span>{a.name}</span>
                    </button>
                  )
                })}
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <Button variant="secondary" className="flex-1" onClick={() => setEditAmenities(null)}>Cancel</Button>
              <Button className="flex-1" onClick={handleSaveAmenities}>Save</Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Edit title dialog */}
      <Dialog open={editTitle !== null} onClose={() => setEditTitle(null)} title="Edit trip name">
        {editTitle !== null && (
          <div className="flex flex-col gap-4">
            <Input
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSaveTitle()}
            />
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setEditTitle(null)}>Cancel</Button>
              <Button className="flex-1" onClick={handleSaveTitle} disabled={!editTitle.trim()}>Save</Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Rate trip dialog */}
      <Dialog open={ratingOpen} onClose={handleRatingDismiss} title="How was it?">
        <div className="flex flex-col items-center gap-4">
          <p className="text-sm text-gray-500 text-center">Rate your overall experience for <span className="font-medium text-gray-700">{trip.title}</span></p>
          <StarRating value={pendingRating} onChange={setPendingRating} />
          <p className="text-sm text-gray-400 h-5">
            {pendingRating > 0 ? `${pendingRating} / 5` : 'Tap a star to rate'}
          </p>
          <div className="flex gap-2 w-full pt-1">
            <Button variant="secondary" className="flex-1" onClick={handleRatingDismiss}>Skip</Button>
            <Button className="flex-1" onClick={handleRatingSubmit} disabled={!pendingRating}>Save</Button>
          </div>
        </div>
      </Dialog>

      {/* Pick a checklist to add an item to */}
      <Dialog open={pickingList} onClose={() => setPickingList(false)} title="Add item to…">
        <div className="flex flex-col gap-4">
          {visiblePhases.map(phase => (
            <div key={phase}>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                {(() => { const Icon = PHASE_ICONS[phase]; return Icon ? <Icon className="w-3.5 h-3.5" /> : null })()}
                {PHASE_LABELS[phase] ?? phase}
              </p>
              <div className="flex flex-col gap-2">
                {byPhase[phase].map(cl => (
                  <button
                    key={cl.id}
                    onClick={() => handlePickListToAddItem(cl.id)}
                    className="text-left py-2.5 px-3 rounded-xl text-sm font-medium border-2 border-gray-200 text-gray-700 hover:border-[#2f6b4f] transition-colors"
                  >
                    {checklistTitle(cl)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Dialog>

    </div>
  )
}


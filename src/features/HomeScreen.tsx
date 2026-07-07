import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/lib/store'
import { useTrips, useChecklists, useChecklistItems, useProcedures } from '@/hooks/useFirestore'
import { findNextOrActiveTrip, TRIP_STOPS, STOP_PROCEDURE, PROCEDURE_LABELS } from '@/lib/firestore'
import { Progress } from '@/components/ui/progress'
import { RigIcon, Campfire, Stars } from '@/components/CampScenes'
import { Tent, Settings, Users, Plus, ChevronRight, CalendarDays, CheckCircle2, ListChecks, MapPin, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { Trip, Checklist } from '@/types'

const PHASE_ORDER = ['pre_early', 'pre_dayof', 'pack_down', 'grocery']

function formatDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function countdown(trip: Trip): string {
  const today = new Date().toISOString().slice(0, 10)
  if (trip.status === 'active' || (trip.startDate <= today && trip.endDate >= today)) return 'Happening now'
  const days = Math.round(
    (new Date(trip.startDate + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86_400_000
  )
  if (days <= 0) return 'Starts today'
  if (days === 1) return 'Starts tomorrow'
  return `In ${days} days`
}

// Time-of-day flavor for the hero scene. Night gets stars and a campfire;
// evening gets a low golden sun; day gets the classic morning sky.
type DayPeriod = 'day' | 'evening' | 'night'
function dayPeriod(hour: number): DayPeriod {
  if (hour >= 21 || hour < 6) return 'night'
  if (hour >= 17) return 'evening'
  return 'day'
}

const TAGLINES: Record<DayPeriod, string> = {
  day: "Let's get you packed and on the road 🏕️",
  evening: 'Golden hour at the campsite hits different ✨',
  night: 'Marshmallow o’clock — the fire’s going 🔥',
}

// Reports its checked/total counts up to the parent so the card can aggregate.
function ChecklistRow({
  tripId,
  checklist,
  onCounts,
  onOpen,
}: {
  tripId: string
  checklist: Checklist
  onCounts: (id: string, c: { checked: number; total: number }) => void
  onOpen: () => void
}) {
  const items = useChecklistItems(tripId, checklist.id)
  const checked = items.filter(i => i.checked).length
  const total = items.length

  useEffect(() => { onCounts(checklist.id, { checked, total }) }, [checklist.id, checked, total, onCounts])

  const done = total > 0 && checked === total
  return (
    <button onClick={onOpen} className="flex items-center gap-3 w-full text-left py-2">
      {done ? (
        <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
      ) : (
        <ListChecks className="w-5 h-5 text-gray-300 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-sm font-medium text-gray-800 truncate">{checklist.name}</span>
          <span className="text-xs text-gray-400 shrink-0">{checked}/{total}</span>
        </div>
        <Progress value={total ? (checked / total) * 100 : 0} className="h-1.5" />
      </div>
    </button>
  )
}

// "Right now" line (§20): where on the route the trip is and how many safety
// checks stand between here and the next stop. Shown once the trip is active
// or the crew has started moving.
function RouteNowLine({ trip }: { trip: Trip }) {
  const procedures = useProcedures()
  const stop = Math.min(Math.max(trip.currentStop ?? 0, 0), TRIP_STOPS.length - 1)
  if (trip.status !== 'active' && stop === 0) return null
  const atEnd = stop === TRIP_STOPS.length - 1
  const transitionId = STOP_PROCEDURE[stop]!
  const steps = procedures.find(p => p.id === transitionId)?.steps ?? []
  const checked = new Set(trip.transitions?.[transitionId]?.checked ?? [])
  const pendingCount = steps.filter(s => !checked.has(s.id)).length
  return (
    <div className="flex items-center gap-1.5 text-sm text-gray-500 mt-1">
      <MapPin className="w-4 h-4 shrink-0" />
      <span className="truncate">
        At {TRIP_STOPS[stop]} · {atEnd ? 'finish' : 'next'}: {PROCEDURE_LABELS[transitionId].toLowerCase()}
      </span>
      {pendingCount > 0 ? (
        <span className="flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full shrink-0">
          <ShieldAlert className="w-3.5 h-3.5" /> {pendingCount}
        </span>
      ) : steps.length > 0 ? (
        <ShieldCheck className="w-4 h-4 text-[#2f6b4f] shrink-0" />
      ) : null}
    </div>
  )
}

function NextTripCard({ trip }: { trip: Trip }) {
  const navigate = useNavigate()
  const checklists = useChecklists(trip.id)
  const [counts, setCounts] = useState<Record<string, { checked: number; total: number }>>({})

  const onCounts = useCallback((id: string, c: { checked: number; total: number }) => {
    setCounts(prev => (prev[id]?.checked === c.checked && prev[id]?.total === c.total ? prev : { ...prev, [id]: c }))
  }, [])

  const totals = Object.values(counts).reduce(
    (a, c) => ({ checked: a.checked + c.checked, total: a.total + c.total }),
    { checked: 0, total: 0 }
  )
  const remaining = totals.total - totals.checked
  const sorted = [...checklists].sort((a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase))

  return (
    <div className="sticker-card overflow-hidden">
      {/* Trip header */}
      <button onClick={() => navigate(`/trips/${trip.id}`)} className="w-full text-left px-5 pt-5 pb-4">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-xs font-bold text-[#2f6b4f] bg-emerald-50 border border-[#2f6b4f]/15 px-2.5 py-1 rounded-full">{countdown(trip)}</span>
          <ChevronRight className="w-5 h-5 text-gray-300" />
        </div>
        <h2 className="text-xl font-bold text-gray-800 truncate">{trip.title}</h2>
        <div className="flex items-center gap-1.5 text-sm text-gray-500 mt-1">
          <CalendarDays className="w-4 h-4" />
          <span>{formatDate(trip.startDate)} — {formatDate(trip.endDate)}</span>
        </div>
        <RouteNowLine trip={trip} />
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm font-medium text-gray-700">
              {totals.total === 0 ? 'No items yet' : remaining === 0 ? 'All packed 🎉' : `${remaining} left to pack`}
            </span>
            <span className="text-sm text-gray-400">{totals.checked}/{totals.total}</span>
          </div>
          <Progress value={totals.total ? (totals.checked / totals.total) * 100 : 0} />
        </div>
      </button>

      {/* Per-checklist breakdown */}
      {sorted.length > 0 && (
        <div className="border-t border-gray-50 px-5 py-2 divide-y divide-gray-50">
          {sorted.map(cl => (
            <ChecklistRow
              key={cl.id}
              tripId={trip.id}
              checklist={cl}
              onCounts={onCounts}
              onOpen={() => navigate(`/trips/${trip.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function HomeScreen() {
  const navigate = useNavigate()
  const identity = useAppStore(s => s.identity)
  const clearIdentity = useAppStore(s => s.clearIdentity)
  const trips = useTrips()
  const focusTrip = findNextOrActiveTrip(trips)

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const period = dayPeriod(hour)
  const skyClass = period === 'night' ? 'camp-sky-night' : period === 'evening' ? 'camp-sky-evening' : 'camp-sky'

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto bg-[#fbf7f0]">
      {/* Scenic campsite header — the sky follows the real time of day */}
      <div className={`${skyClass} relative overflow-hidden`}>
        {period === 'night' ? (
          <>
            <Stars className="absolute inset-x-0 top-4 w-full h-24" />
            {/* moon */}
            <div className="absolute right-8 top-9 w-12 h-12 rounded-full bg-amber-50/90" />
            <div className="absolute right-6 top-8 w-11 h-11 rounded-full bg-[#16283f]" style={{ clipPath: 'circle(50%)' }} />
          </>
        ) : (
          <>
            {/* sun (low and warm in the evening) */}
            <div className={`absolute right-7 rounded-full blur-[1px] ${period === 'evening' ? 'top-20 w-16 h-16 bg-orange-200/90' : 'top-9 w-16 h-16 bg-amber-200/90'}`} />
            <div className={`absolute right-8 rounded-full ${period === 'evening' ? 'top-[84px] w-14 h-14 bg-orange-100' : 'top-10 w-14 h-14 bg-amber-100'}`} />
          </>
        )}

        {/* Mountains + pines + tent silhouette */}
        <svg viewBox="0 0 480 140" preserveAspectRatio="none" className="absolute -bottom-px left-0 w-full h-28 text-[#1f4736]" aria-hidden>
          <path d="M0 140 V70 L70 30 L140 78 L210 38 L300 90 L380 50 L480 96 V140 Z" fill="#2c6049" opacity="0.7" />
          <path d="M0 140 V96 L80 64 L150 100 L240 66 L330 104 L420 74 L480 110 V140 Z" fill="currentColor" />
          {/* pine trees */}
          <g fill="#163a2b">
            <path d="M120 140 l14 -34 l14 34 Z" />
            <path d="M120 140 l14 -26 l14 26 Z" />
            <path d="M350 140 l11 -26 l11 26 Z" />
          </g>
          {/* little tent */}
          <g>
            <path d="M236 140 l24 -40 l24 40 Z" fill="#e8a44c" />
            <path d="M260 100 l-3 40 l6 0 Z" fill="#c97f2e" />
          </g>
        </svg>

        {/* Rig parked in the scene + campfire at night */}
        <div className="absolute bottom-1 left-6 flex items-end gap-3 pointer-events-none" aria-hidden>
          <RigIcon className="w-24 drop-shadow-sm" flip />
          {period === 'night' && <Campfire className="w-7 h-7 mb-0.5" />}
        </div>

        {/* Top bar */}
        <div className="relative z-10 flex items-center justify-between px-5 pt-12 pb-28">
          <div>
            <p className="text-emerald-50/90 text-sm flex items-center gap-1.5">
              <Tent className="w-4 h-4" /> {greeting},
            </p>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold text-white capitalize drop-shadow-sm">{identity}</h1>
              <button onClick={clearIdentity} className="text-emerald-100 opacity-70 hover:opacity-100 transition-opacity mt-1" title="Switch user">
                <Users className="w-5 h-5" />
              </button>
            </div>
            <p className="text-emerald-50/80 text-xs mt-1">{TAGLINES[period]}</p>
          </div>
          <button onClick={() => navigate('/manage')} className="text-white/90 p-2 rounded-full bg-white/10 backdrop-blur-sm">
            <Settings className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Sheet */}
      <div className="flex-1 bg-[#fbf7f0] rounded-t-3xl -mt-5 px-5 pt-6 pb-6 flex flex-col gap-5">
        {focusTrip ? (
          <div>
            <p className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-2">
              {focusTrip.status === 'active' ? 'Current trip' : 'Next trip'}
            </p>
            <NextTripCard trip={focusTrip} />
          </div>
        ) : (
          <div className="sticker-card p-8 flex flex-col items-center text-center">
            <RigIcon className="w-32 mb-3" />
            <p className="font-bold text-gray-800">No adventures on the horizon</p>
            <p className="text-sm text-gray-500 mb-4">The trailer's getting dusty — plan your next trip.</p>
            <button onClick={() => navigate('/trips/new')} className="flex items-center gap-2 bg-[#2f6b4f] text-white px-5 py-3 rounded-xl font-bold">
              <Plus className="w-5 h-5" /> Plan a trip
            </button>
          </div>
        )}

        {/* Shortcuts */}
        <div>
          <p className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-2">Shortcuts</p>
          <div className="grid grid-cols-3 gap-3">
            <button onClick={() => navigate('/trips/new')} className="sticker-card flex flex-col items-center gap-2 py-4 active:bg-gray-50">
              <div className="bg-emerald-50 rounded-xl p-2.5"><Plus className="w-5 h-5 text-[#2f6b4f]" /></div>
              <span className="text-xs font-semibold text-gray-700">New trip</span>
            </button>
            <button onClick={() => navigate('/trips')} className="sticker-card flex flex-col items-center gap-2 py-4 active:bg-gray-50">
              <div className="bg-amber-50 rounded-xl p-2.5"><Tent className="w-5 h-5 text-amber-600" /></div>
              <span className="text-xs font-semibold text-gray-700">All trips</span>
            </button>
            <button onClick={() => navigate('/manage')} className="sticker-card flex flex-col items-center gap-2 py-4 active:bg-gray-50">
              <div className="bg-sky-50 rounded-xl p-2.5"><Settings className="w-5 h-5 text-sky-700" /></div>
              <span className="text-xs font-semibold text-gray-700">Manage</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

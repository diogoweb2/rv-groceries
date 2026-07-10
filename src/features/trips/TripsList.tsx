import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTrips, useAmenities } from '@/hooks/useFirestore'
import { deleteTrip, incrementRatingPrompt, rateTrip } from '@/lib/firestore'
import { useAppStore } from '@/lib/store'
import { localToday } from '@/lib/date'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Plus, Tent, Trash2, CalendarDays, Star } from 'lucide-react'
import type { Trip } from '@/types'

const STATUS_BADGE: Record<Trip['status'], { label: string; variant: 'default' | 'success' | 'warning' | 'info' }> = {
  planned: { label: 'Planned', variant: 'info' },
  active: { label: 'Active', variant: 'warning' },
  completed: { label: 'Done', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'default' },
}

function formatDate(d: string) {
  // 'YYYY-MM-DD' alone parses as UTC and renders a day early west of Greenwich.
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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

export function TripsList() {
  const navigate = useNavigate()
  const trips = useTrips()
  const amenities = useAmenities()
  const identity = useAppStore(s => s.identity)!
  const [filter, setFilter] = useState<'upcoming' | 'all'>('upcoming')
  const [ratingDialogOpen, setRatingDialogOpen] = useState(false)
  const [pendingRating, setPendingRating] = useState(0)
  const promptedTripRef = useRef<string | null>(null)

  // First completed trip where this user hasn't rated and has been prompted fewer than 2 times.
  const promptTrip = trips.find(t =>
    t.status === 'completed' &&
    !t.ratings?.[identity] &&
    (t.ratingPrompts?.[identity] ?? 0) < 2
  )

  // Increment the prompt counter exactly once per trip per app session when the banner appears.
  useEffect(() => {
    if (!promptTrip || promptedTripRef.current === promptTrip.id) return
    promptedTripRef.current = promptTrip.id
    incrementRatingPrompt(promptTrip.id, identity)
  }, [promptTrip?.id, identity])

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    await deleteTrip(id)
  }

  async function handleRatingSubmit() {
    if (!promptTrip || !pendingRating) return
    await rateTrip(promptTrip.id, identity, pendingRating)
    setRatingDialogOpen(false)
  }

  const amenityMap = Object.fromEntries(amenities.map(a => [a.id, a]))
  const now = localToday()
  const visible = filter === 'upcoming'
    ? trips.filter(t => t.startDate >= now && t.status !== 'cancelled' && t.status !== 'completed')
    : trips

  return (
    <div className="flex flex-col min-h-0 flex-1 bg-[#fbf7f0]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h1 className="text-xl font-bold text-gray-800">🏕️ Your trips</h1>
        <Button size="icon" onClick={() => navigate('/trips/new')}>
          <Plus className="w-5 h-5" />
        </Button>
      </div>

      {/* Rating notification banner — shown when a completed trip needs this user's rating */}
      {promptTrip && (
        <div className="mx-4 mb-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center gap-3">
          <Star className="w-5 h-5 text-amber-400 fill-amber-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800">How was it?</p>
            <p className="text-xs text-gray-500 truncate">{promptTrip.title}</p>
          </div>
          <button
            onClick={() => { setPendingRating(0); setRatingDialogOpen(true) }}
            className="text-sm font-semibold text-[#2f6b4f] shrink-0"
          >
            Rate
          </button>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 px-4 mb-3">
        {(['upcoming', 'all'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${filter === f ? 'bg-[#2f6b4f] text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            {f === 'upcoming' ? 'Upcoming' : 'All trips'}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Tent className="w-14 h-14 mb-3" strokeWidth={1.2} />
            <p className="text-base font-medium">No adventures planned yet</p>
            <p className="text-sm">Tap + to map out your first trip ⛺</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {visible.map(trip => {
              const badge = STATUS_BADGE[trip.status]
              return (
                <div
                  key={trip.id}
                  onClick={() => navigate(`/trips/${trip.id}`)}
                  className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 text-left flex items-start gap-3 active:bg-gray-50 cursor-pointer"
                >
                  <div className="bg-emerald-50 rounded-xl p-2.5 mt-0.5">
                    <Tent className="w-5 h-5 text-[#2f6b4f]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-gray-800 truncate">{trip.title}</span>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>
                    <div className="flex items-center gap-1 text-sm text-gray-500 mb-2">
                      <CalendarDays className="w-3.5 h-3.5" />
                      <span>{formatDate(trip.startDate)} — {formatDate(trip.endDate)}</span>
                    </div>
                    {trip.amenities.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {trip.amenities.map(id => {
                          const a = amenityMap[id]
                          return a ? (
                            <span key={id} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                              {a.icon} {a.name}
                            </span>
                          ) : null
                        })}
                      </div>
                    )}
                    {(trip.ratings?.diogo !== undefined || trip.ratings?.alice !== undefined) && (
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                        <Star className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0" />
                        {trip.ratings.diogo !== undefined && <span>Diogo {trip.ratings.diogo}/5</span>}
                        {trip.ratings.diogo !== undefined && trip.ratings.alice !== undefined && <span>·</span>}
                        {trip.ratings.alice !== undefined && <span>Alice {trip.ratings.alice}/5</span>}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={e => handleDelete(e, trip.id)}
                    className="text-gray-300 hover:text-red-500 p-1 mt-0.5 shrink-0"
                    aria-label="Delete trip"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Rating dialog — triggered from the banner */}
      <Dialog open={ratingDialogOpen} onClose={() => setRatingDialogOpen(false)} title="How was it?">
        {promptTrip && (
          <div className="flex flex-col items-center gap-4">
            <p className="text-sm text-gray-500 text-center">Rate your overall experience for <span className="font-medium text-gray-700">{promptTrip.title}</span></p>
            <StarRating value={pendingRating} onChange={setPendingRating} />
            <p className="text-sm text-gray-400 h-5">
              {pendingRating > 0 ? `${pendingRating} / 5` : 'Tap a star to rate'}
            </p>
            <div className="flex gap-2 w-full pt-1">
              <Button variant="secondary" className="flex-1" onClick={() => setRatingDialogOpen(false)}>Later</Button>
              <Button className="flex-1" onClick={handleRatingSubmit} disabled={!pendingRating}>Save</Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )
}

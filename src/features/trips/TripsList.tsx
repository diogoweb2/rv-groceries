import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTrips, useAmenities } from '@/hooks/useFirestore'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Plus, Tent, ChevronRight, CalendarDays } from 'lucide-react'
import type { Trip } from '@/types'

const STATUS_BADGE: Record<Trip['status'], { label: string; variant: 'default' | 'success' | 'warning' | 'info' }> = {
  planned: { label: 'Planned', variant: 'info' },
  active: { label: 'Active', variant: 'warning' },
  completed: { label: 'Done', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'default' },
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function TripsList() {
  const navigate = useNavigate()
  const trips = useTrips()
  const amenities = useAmenities()
  const [filter, setFilter] = useState<'upcoming' | 'all'>('upcoming')

  const amenityMap = Object.fromEntries(amenities.map(a => [a.id, a]))
  const now = new Date().toISOString().slice(0, 10)
  const visible = filter === 'upcoming'
    ? trips.filter(t => t.startDate >= now && t.status !== 'cancelled' && t.status !== 'completed')
    : trips

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h1 className="text-xl font-bold text-gray-800">Trips</h1>
        <Button size="icon" onClick={() => navigate('/trips/new')}>
          <Plus className="w-5 h-5" />
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 px-4 mb-3">
        {(['upcoming', 'all'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${filter === f ? 'bg-[#1e3a5f] text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            {f === 'upcoming' ? 'Upcoming' : 'All trips'}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Tent className="w-14 h-14 mb-3" strokeWidth={1.2} />
            <p className="text-base font-medium">No trips yet</p>
            <p className="text-sm">Tap + to plan your first trip</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {visible.map(trip => {
              const badge = STATUS_BADGE[trip.status]
              return (
                <button
                  key={trip.id}
                  onClick={() => navigate(`/trips/${trip.id}`)}
                  className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 text-left flex items-start gap-3 active:bg-gray-50"
                >
                  <div className="bg-blue-50 rounded-xl p-2.5 mt-0.5">
                    <Tent className="w-5 h-5 text-[#1e3a5f]" />
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
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-400 mt-0.5 shrink-0" />
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

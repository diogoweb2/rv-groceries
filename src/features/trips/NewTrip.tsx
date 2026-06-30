import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAmenities, usePinnedChecklists, useOrdering, useTrips } from '@/hooks/useFirestore'
import { createTripWithChecklists } from '@/lib/firestore'
import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, Loader2, Check } from 'lucide-react'

export function NewTrip() {
  const navigate = useNavigate()
  const amenities = useAmenities()
  const pinnedChecklists = usePinnedChecklists()
  const ordering = useOrdering()
  const trips = useTrips()
  const identity = useAppStore(s => s.identity)!

  const [title, setTitle] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)

  // Unique past trip titles, ordered most-recent first.
  const pastTitles = useMemo(() => {
    const seen = new Set<string>()
    return [...trips]
      .sort((a, b) => b.startDate.localeCompare(a.startDate))
      .map(t => t.title)
      .filter(t => { if (seen.has(t)) return false; seen.add(t); return true })
  }, [trips])

  const suggestions = title.trim()
    ? pastTitles.filter(t => t.toLowerCase().includes(title.toLowerCase()) && t !== title)
    : []

  function selectSuggestion(name: string) {
    setTitle(name)
    setShowSuggestions(false)
    // Pre-fill amenities from the most recent trip with this title.
    const match = [...trips]
      .sort((a, b) => b.startDate.localeCompare(a.startDate))
      .find(t => t.title === name)
    if (match) setSelectedAmenities(match.amenities)
  }

  function toggleAmenity(id: string) {
    setSelectedAmenities(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title || !startDate || !endDate) { setError('Fill in all required fields'); return }
    if (endDate < startDate) { setError('End date must be after start date'); return }
    setLoading(true)
    try {
      const tripId = await createTripWithChecklists(
        {
          title,
          startDate,
          endDate,
          amenities: selectedAmenities,
          status: 'planned',
          createdBy: identity,
        },
        pinnedChecklists,
        identity,
        ordering
      )
      navigate(`/trips/${tripId}`, { replace: true })
    } catch (err) {
      console.error(err)
      setError('Failed to create trip')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-dvh bg-gray-50">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3 bg-white border-b border-gray-100">
        <button onClick={() => navigate(-1)} className="text-gray-600 p-1">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold text-gray-800">New Trip</h1>
      </div>

      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
        {/* Title */}
        <div className="relative">
          <label className="text-sm font-medium text-gray-700 mb-1.5 block">Trip name *</label>
          <Input
            value={title}
            onChange={e => { setTitle(e.target.value); setShowSuggestions(true) }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder="e.g. Costa Vicentina June"
            autoFocus
            autoComplete="off"
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
              {suggestions.map(s => (
                <li key={s}>
                  <button
                    type="button"
                    onMouseDown={() => selectSuggestion(s)}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Start date *</label>
            <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">End date *</label>
            <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} min={startDate} />
          </div>
        </div>

        {/* Amenities */}
        <div>
          <label className="text-sm font-medium text-gray-700 mb-2 block">
            Amenities <span className="font-normal text-gray-400">(optional — helps suggest items)</span>
          </label>
          {amenities.length === 0 ? (
            <p className="text-sm text-gray-400">No amenities yet — add them in Manage</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {amenities.map(a => {
                const active = selectedAmenities.includes(a.id)
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleAmenity(a.id)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border-2 transition-colors ${
                      active
                        ? 'border-[#2f6b4f] bg-[#2f6b4f] text-white'
                        : 'border-gray-200 bg-white text-gray-700'
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
        </div>

        {/* Pinned checklists preview */}
        {pinnedChecklists.length > 0 && (
          <div className="bg-emerald-50 rounded-xl p-4">
            <p className="text-sm font-medium text-[#2f6b4f] mb-1">Checklists that will be created:</p>
            <ul className="text-sm text-[#2f6b4f] flex flex-col gap-0.5">
              {pinnedChecklists.map(p => (
                <li key={p.id}>• {p.name} ({p.items.length} items)</li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="text-red-500 text-sm">{error}</p>}
      </form>

      {/* Sticky footer */}
      <div className="shrink-0 bg-white border-t border-gray-100 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={loading || !title || !startDate || !endDate}
          onClick={handleSubmit}
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          Create Trip
        </Button>
      </div>
    </div>
  )
}

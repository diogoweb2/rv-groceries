import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAmenities, useTemplates, useCatalog } from '@/hooks/useFirestore'
import { createTripWithChecklists } from '@/lib/firestore'
import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, Loader2, Check } from 'lucide-react'

export function NewTrip() {
  const navigate = useNavigate()
  const amenities = useAmenities()
  const templates = useTemplates()
  const catalog = useCatalog()
  const identity = useAppStore(s => s.identity)!

  const [title, setTitle] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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
        templates,
        catalog,
        selectedAmenities,
        identity
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
        <div>
          <label className="text-sm font-medium text-gray-700 mb-1.5 block">Trip name *</label>
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Costa Vicentina June"
            autoFocus
          />
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
                        ? 'border-[#1e3a5f] bg-[#1e3a5f] text-white'
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

        {/* Templates preview */}
        {templates.filter(t => t.category === 'camping').length > 0 && (
          <div className="bg-blue-50 rounded-xl p-4">
            <p className="text-sm font-medium text-[#1e3a5f] mb-1">Checklists that will be created:</p>
            <ul className="text-sm text-blue-700 flex flex-col gap-0.5">
              {templates
                .filter(t => t.category === 'camping')
                .map(t => (
                  <li key={t.id}>• {t.name} ({t.items.length} items)</li>
                ))
              }
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

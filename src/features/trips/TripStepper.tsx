import { useState } from 'react'
import {
  TRIP_STOPS, STOP_PROCEDURE, PROCEDURE_LABELS,
  setTransitionStepChecked, advanceTripStop, stepBackTripStop, completeTrip,
  addProcedureStep, removeProcedureStep,
} from '@/lib/firestore'
import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog } from '@/components/ui/dialog'
import { Home, Warehouse, Tent, ShieldAlert, ArrowRight, Undo2, Plus, X, Check, Flag, type LucideIcon } from 'lucide-react'
import type { Trip, Procedure, ProcedureStep } from '@/types'

const STOP_ICONS: LucideIcon[] = [Home, Warehouse, Tent, Warehouse, Home]

/**
 * The trip route stepper (§20): a compact pill showing which stop of the fixed
 * Home → Warehouse → Campsite → Warehouse → Home route the crew is at, and one
 * button to move on — gated on that stop's safety procedure.
 */
export function TripStepper({ trip, procedures, onFinished }: {
  trip: Trip
  procedures: Procedure[]
  onFinished?: () => void
}) {
  const identity = useAppStore(s => s.identity)!
  const [open, setOpen] = useState(false)
  const [newStep, setNewStep] = useState('')

  const stop = Math.min(Math.max(trip.currentStop ?? 0, 0), TRIP_STOPS.length - 1)
  const atEnd = stop === TRIP_STOPS.length - 1
  // Each stop has a safety checklist; the last stop's is the terminal "arrive
  // home" one, whose action finishes the trip instead of advancing (§20).
  const transitionId = STOP_PROCEDURE[stop]!
  const label = PROCEDURE_LABELS[transitionId]
  const steps: ProcedureStep[] = procedures.find(p => p.id === transitionId)?.steps ?? []
  const checkedIds = new Set(trip.transitions?.[transitionId]?.checked ?? [])
  const pending = steps.filter(s => !checkedIds.has(s.id))

  async function handleAdvance(skip: boolean) {
    if (skip && !confirm(`Skip ${pending.length} unchecked safety ${pending.length === 1 ? 'step' : 'steps'} and ${atEnd ? 'finish' : 'advance'}?`)) return
    if (atEnd) {
      await completeTrip(trip, identity)
      onFinished?.()
    } else {
      await advanceTripStop(trip, transitionId, skip ? pending.map(s => s.id) : [], identity)
    }
    setOpen(false)
  }

  async function handleAddStep() {
    if (!newStep.trim()) return
    await addProcedureStep(transitionId, newStep)
    setNewStep('')
  }

  const StopIcon = STOP_ICONS[stop]

  return (
    <>
      <div className="flex items-center gap-1.5">
        <span className="flex items-center gap-1 text-xs font-semibold text-[#2f6b4f] bg-emerald-50 border border-[#2f6b4f]/15 rounded-full pl-2 pr-2.5 py-1">
          <StopIcon className="w-3.5 h-3.5 shrink-0" />
          {TRIP_STOPS[stop]}
        </span>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 text-xs font-semibold text-[#2f6b4f] rounded-full px-1.5 py-1 hover:underline active:opacity-70"
          aria-label={atEnd ? 'Finish trip' : label}
        >
          {atEnd ? 'Finish' : 'Next'}
          {pending.length > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] font-medium text-amber-800 bg-amber-200 px-1 rounded-full">
              <ShieldAlert className="w-3 h-3" /> {pending.length}
            </span>
          )}
          {atEnd ? <Flag className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" />}
        </button>
        {stop > 0 && (
          <button
            onClick={() => stepBackTripStop(trip)}
            className="p-1 text-gray-400 hover:text-gray-600"
            aria-label="Step back to the previous stop"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Safety-procedure dialog */}
      <Dialog open={open} onClose={() => setOpen(false)} title={label}>
        <div className="flex flex-col gap-4">
          {steps.length === 0 ? (
            <p className="text-sm text-gray-500">No safety steps here yet. Add the things you must never forget.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {steps.map(step => {
                const checked = checkedIds.has(step.id)
                return (
                  <div key={step.id} className="flex items-center gap-2 group">
                    <button
                      onClick={() => setTransitionStepChecked(trip.id, transitionId, step.id, !checked)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left py-2"
                    >
                      <div className={`flex items-center justify-center w-5 h-5 rounded-md border-2 shrink-0 transition-colors ${
                        checked ? 'border-[#2f6b4f] bg-[#2f6b4f] text-white' : 'border-gray-300 bg-white text-transparent'
                      }`}>
                        <Check className="w-3.5 h-3.5" />
                      </div>
                      <span className={`text-sm ${checked ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{step.text}</span>
                    </button>
                    <button
                      onClick={() => removeProcedureStep(transitionId, step)}
                      className="p-1 text-gray-300 hover:text-red-400 shrink-0"
                      aria-label={`Remove step "${step.text}" from every trip`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          <div className="flex gap-2">
            <Input
              value={newStep}
              onChange={e => setNewStep(e.target.value)}
              placeholder="Add a safety step (all trips)"
              onKeyDown={e => e.key === 'Enter' && handleAddStep()}
            />
            <Button variant="secondary" onClick={handleAddStep} disabled={!newStep.trim()} aria-label="Add step">
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex gap-2 pt-1">
            {pending.length > 0 ? (
              <>
                <Button variant="secondary" className="flex-1" onClick={() => handleAdvance(true)}>
                  Skip ({pending.length})
                </Button>
                <Button className="flex-1" disabled>
                  {pending.length} {pending.length === 1 ? 'check' : 'checks'} left
                </Button>
              </>
            ) : (
              <Button className="flex-1" onClick={() => handleAdvance(false)}>
                {atEnd ? 'Finish trip' : steps.length > 0 ? 'All clear — roll out' : 'Roll out'}
                {atEnd ? <Flag className="w-4 h-4 ml-1" /> : <ArrowRight className="w-4 h-4 ml-1" />}
              </Button>
            )}
          </div>
        </div>
      </Dialog>
    </>
  )
}

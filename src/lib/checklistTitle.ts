import type { Checklist } from '@/types'

// Display-only titles (§20). The stored `name` stays as-is (pinned lists key off
// it), but what the user reads should say what the list is *for*.
export function checklistTitle(checklist: Pick<Checklist, 'name' | 'phase'>) {
  if (checklist.phase === 'other') return 'Bring to Truck'
  return checklist.name
}

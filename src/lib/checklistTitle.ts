import type { Checklist } from '@/types'

// Display-only titles (§20). The stored `name` stays as-is — grocery lists key
// off the store name for Supermarket sync and pinned lists — but what the user
// reads should say what the list is *for*: shopping vs. loading the truck.
export function checklistTitle(checklist: Pick<Checklist, 'name' | 'phase'>) {
  if (checklist.phase === 'grocery') return `Buy @ ${checklist.name}`
  if (checklist.phase === 'other') return 'Bring to Truck'
  return checklist.name
}

export type UserIdentity = 'diogo' | 'alice'

export type ChecklistPhase = 'pre_early' | 'pre_dayof' | 'pack_down' | 'grocery'

export type TripStatus = 'planned' | 'active' | 'completed' | 'cancelled'

export type GroceryListStatus = 'draft' | 'sent'

export interface Amenity {
  id: string
  name: string
  icon: string
}

export interface Store {
  id: string
  name: string
}

export interface CatalogItem {
  id: string
  name: string
  category: 'camping' | 'grocery' | 'general'
  defaultStoreId?: string
  unit?: string
  stats: {
    totalUsed: number
    totalGrocery: number
    byAmenity: Record<string, number>
    lastGrocerySortIndex: Record<string, number>
  }
}

export interface TemplateItem {
  catalogItemId: string
  name: string
  qty?: string
  note?: string
  reminderOffsetDays?: number
}

export interface Template {
  id: string
  name: string
  category: 'camping' | 'grocery'
  phase: ChecklistPhase
  items: TemplateItem[]
}

export interface Trip {
  id: string
  title: string
  startDate: string
  endDate: string
  amenities: string[]
  status: TripStatus
  createdBy: UserIdentity
  notes?: string
  /** Set true once usage stats have been recorded, so completion never double-counts. */
  statsRecorded?: boolean
}

export interface Checklist {
  id: string
  tripId: string
  name: string
  phase: ChecklistPhase
  /** Position of this checklist within its phase (0-based). */
  order: number
}

/** Global, remembered ordering applied to new trips. */
export interface OrderingPrefs {
  /** Order the phase sections are displayed in. */
  phaseOrder: ChecklistPhase[]
  /** Per-phase, the remembered order of checklist names. */
  checklistOrder: Record<string, string[]>
}

export interface ChecklistItem {
  id: string
  checklistId: string
  tripId: string
  catalogItemId?: string
  name: string
  qty?: string
  storeId?: string
  checked: boolean
  reminderOffsetDays?: number
  order: number
  /** When true, the item carries over to future trips until it is checked. */
  persist?: boolean
  rev: number
  baseRev: number
  updatedBy: UserIdentity
  updatedAt: string
  frozenField?: string
}

/**
 * A globally-remembered item that should re-appear in future trips until it is
 * checked. Seeded into new trips at creation (see §12). Keyed by phase +
 * checklist name + item name so the same logical item is not duplicated.
 */
export interface PersistentItem {
  id: string
  name: string
  phase: ChecklistPhase
  /** Name of the checklist this item should land in (matched/created by name+phase). */
  checklistName: string
  catalogItemId?: string
  qty?: string
}

export interface GroceryList {
  id: string
  title: string
  status: GroceryListStatus
  createdBy: UserIdentity
  createdAt: string
  sentAt?: string
}

export interface GroceryItem {
  id: string
  listId: string
  catalogItemId?: string
  name: string
  qty?: string
  storeId?: string
  checked: boolean
  order: number
  rev: number
  baseRev: number
  updatedBy: UserIdentity
  updatedAt: string
}

export interface Conflict {
  id: string
  docPath: string
  field: string
  diogoValue: unknown
  aliceValue: unknown
  baseValue: unknown
  createdAt: string
  status: 'pending' | 'resolved'
  resolvedValue?: unknown
}

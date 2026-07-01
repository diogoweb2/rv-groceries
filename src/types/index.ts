export type UserIdentity = 'diogo' | 'alice'

export type ChecklistPhase = 'pre_early' | 'pre_dayof' | 'pack_down' | 'grocery'

export type TripStatus = 'planned' | 'active' | 'completed' | 'cancelled'

export type GroceryListStatus = 'draft' | 'sent'

/** A supermarket list is `active` until the shopper marks it `complete` (then hidden). */
export type SupermarketListStatus = 'active' | 'complete'

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
  /** Per-user experience ratings (1–5, half-step precision). */
  ratings?: {
    diogo?: number
    alice?: number
  }
  /** Number of times each user has been auto-prompted to rate (max 2). */
  ratingPrompts?: {
    diogo?: number
    alice?: number
  }
}

export interface Checklist {
  id: string
  tripId: string
  name: string
  phase: ChecklistPhase
  /** Position of this checklist within its phase (0-based). */
  order: number
  /** When true, this checklist is pinned and auto-creates on every new trip. */
  pinned?: boolean
  /**
   * For `grocery`-phase checklists: the Store (Manage > Stores) this list is
   * for. Drives the live sync with the matching Supermarket list (§8).
   */
  storeId?: string
}

export interface PinnedChecklistItem {
  name: string
  catalogItemId?: string
  qty?: string
}

/** A globally-stored snapshot of a pinned checklist, seeded into new trips at creation. */
export interface PinnedChecklist {
  id: string
  name: string
  phase: ChecklistPhase
  items: PinnedChecklistItem[]
  updatedAt: string
  updatedBy: UserIdentity
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
  /**
   * When this grocery item is live-linked to a Supermarket item (§8/§15), the
   * list/item it's paired with. Present only on items in a `grocery`-phase,
   * store-linked checklist that has been mirrored to/from Supermarket.
   */
  linkedSupermarketListId?: string
  linkedSupermarketItemId?: string
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

/**
 * A shopping list for one specific store (Manage > Stores). Only one active
 * list may exist per store at a time. See §15.
 */
export interface SupermarketList {
  id: string
  storeId: string
  status: SupermarketListStatus
  createdBy: UserIdentity
  createdAt: string
  completedAt?: string
  completedBy?: UserIdentity
}

export interface SupermarketItem {
  id: string
  listId: string
  catalogItemId?: string
  name: string
  qty?: string
  /**
   * When true, this item is live-linked into the next/active trip's Groceries
   * checklist for this store (§8/§15) — flipping it on mirrors the item into
   * the trip; flipping it off removes it from the trip.
   */
  forCamping?: boolean
  /** Whether the shopper has bought this item. */
  checked: boolean
  order: number
  /** The linked trip-side item, when `forCamping` is set (§8). */
  linkedTripId?: string
  linkedChecklistId?: string
  linkedItemId?: string
  rev: number
  baseRev: number
  updatedBy: UserIdentity
  updatedAt: string
}

/**
 * Per-store, word-based learned ordering used to auto-sort supermarket lists
 * (§16). For each store, a map of lowercased word → learned normalized position
 * (0 = top of the list … 1 = bottom), updated by an exponential moving average
 * so the most recent manual sort carries the most weight.
 */
export interface SupermarketSortMemory {
  stores: Record<string, Record<string, number>>
}

/**
 * An in-app / push notification addressed to a single identity. Created by the
 * client (e.g. on supermarket-list completion) and delivered as a real push by
 * a Cloud Function. Rendered as a banner in-app until dismissed.
 */
export interface AppNotification {
  id: string
  to: UserIdentity
  from: UserIdentity
  title: string
  body: string
  /** Tag for the originating feature, e.g. 'supermarket'. */
  type?: string
  createdAt: string
  read: boolean
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

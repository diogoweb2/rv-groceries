export type UserIdentity = 'diogo' | 'alice'

// Legacy phases (`pre_early`/`pre_dayof`/`pack_down`) are migrated into `other`
// under the stage-driven model (§20); only `grocery` and `other` are used going
// forward. The legacy values remain in the type for old data + migration reads.
export type ChecklistPhase = 'pre_early' | 'pre_dayof' | 'pack_down' | 'grocery' | 'other'

export type TripStatus = 'planned' | 'active' | 'completed' | 'cancelled'

/**
 * The fixed trip route is Home → Warehouse → Campsite → Warehouse → Home
 * (§20). A transition is the act of leaving one stop for the next; safety
 * procedures attach to transitions.
 */
export type TransitionId =
  | 'leave_home'
  | 'leave_warehouse_go'
  | 'leave_campsite'
  | 'leave_warehouse_return'
  | 'arrive_home'

export interface ProcedureStep {
  id: string
  text: string
}

/**
 * The global safety-procedure template for one transition (§20). One doc per
 * transition in the `procedures` collection; steps are shared across trips,
 * while per-trip check state lives on the trip document.
 */
export interface Procedure {
  id: TransitionId
  steps: ProcedureStep[]
}

/** Per-trip, per-transition procedure progress, stored on the trip document. */
export interface TransitionState {
  /** Ids of the procedure steps checked off for this transition. */
  checked?: string[]
  /** Step ids left unchecked when the user chose to skip past the interrupt. */
  skippedSteps?: string[]
  skippedAt?: string
  advancedAt?: string
  advancedBy?: UserIdentity
}

export type GroceryListStatus = 'draft' | 'sent'

/**
 * Where an item finally belongs when the trip is over (§18): back at Home,
 * living in the Truck, or living in the RV. `home` items are copied into the
 * Pack down / return list when checked, so they aren't left behind.
 */
export type ItemDestination = 'home' | 'truck' | 'rv'

/** Who a trip-item reminder is addressed to (§21). */
export type RemindTarget = 'diogo' | 'alice' | 'both'

/** A feedback entry is either a reported bug or a suggested improvement (§17). */
export type FeedbackKind = 'bug' | 'improvement'

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
  /**
   * Where in the fixed route the trip currently is (§20): an index into
   * TRIP_STOPS (0 = Home … 4 = back Home). Absent = 0. Shared by both users.
   */
  currentStop?: number
  /** Per-transition safety-procedure progress for this trip (§20). */
  transitions?: Partial<Record<TransitionId, TransitionState>>
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
   * When true, this checklist is hidden for this trip — the user has decided to
   * do nothing about it on this trip. Hidden lists are collapsed out of the trip
   * view unless "Show hidden" is toggled on (§5). Per-trip only (not carried).
   */
  hidden?: boolean
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
  destination?: ItemDestination
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
  /** The item's final destination (§18): where it belongs when the trip ends. */
  destination?: ItemDestination
  /**
   * Stop indices (0–4) at which this item has been handled/checked in the
   * stage-driven flow (§20). Per-stop and independent of `checked`.
   */
  stagesDone?: number[]
  /**
   * "Retire once handled" toggle (§20): when on, the item disappears from the
   * stops *after* the one where it was checked off. Independent of the persist
   * pin — a pinned item still recurs next trip.
   */
  removeOnComplete?: boolean
  /**
   * "Remind me" target (§21): who gets the push the day before the trip starts,
   * at 18:00 Toronto. Cleared once the reminder has been sent.
   */
  remindTo?: RemindTarget
  /**
   * Legacy "bring it back" flag — superseded by `destination` (`bringBack:
   * true` reads as destination `home`). Kept only as a read fallback.
   */
  bringBack?: boolean
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
  destination?: ItemDestination
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
  /**
   * Denormalized copy of the store's name at creation (kept in sync on store
   * rename). Display fallback so a list never renders nameless when the
   * `stores` join is unavailable (stale client, slow load, deleted store).
   */
  storeName?: string
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
  /**
   * When the item was checked off as bought. Feeds the daily cleanup (§15),
   * which removes bought items the next Toronto day. Cleared when un-bought.
   */
  checkedAt?: string
  order: number
  /** The linked trip-side item, when `forCamping` is set (§8). */
  linkedTripId?: string
  linkedChecklistId?: string
  linkedItemId?: string
  rev: number
  baseRev: number
  updatedBy: UserIdentity
  updatedAt: string
  /**
   * When the item was first added. Feeds the 6pm daily digest (§15), which
   * reports items created since its last run. Absent on items created before
   * the digest shipped — those are never counted as new.
   */
  createdAt?: string
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
  /** In-app path to open when the native notification is tapped. */
  url?: string
  createdAt: string
  read: boolean
}

/**
 * A bug report or improvement idea logged from Manage → Bugs & ideas (§17). A
 * simple, sortable to-do list; completing an entry deletes it.
 */
export interface Feedback {
  id: string
  kind: FeedbackKind
  text: string
  /** Position in the shared list (0-based), set by drag reordering. */
  order: number
  /** When true, the entry is completed — hidden from the working list but kept
   * so it can be restored from the Completed filter (§17). */
  done?: boolean
  createdBy: UserIdentity
  createdAt: string
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

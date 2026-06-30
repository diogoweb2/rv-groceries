# Business Rules

This document captures the product/business rules implemented in the app. It is the
source of truth for *behavior* — not code structure. Keep it updated when rules change.

App: an offline-first PWA for two users (Diogo & Alice) to plan camping/RV trips and
manage packing checklists. The standalone "Supermarket" feature is currently **disabled**
(see §9); grocery handling lives inside camping trips.

---

## 1. Authentication & Identity

- **App PIN gate.** On launch, the user enters a shared app PIN (`VITE_APP_PIN`). It is
  checked locally on the device — a wrong PIN shows "Wrong password" and does not contact
  the server.
- **Shared Firebase account.** A correct PIN signs in with a single shared Firebase
  email/password account (`VITE_APP_EMAIL` / `VITE_APP_PASSWORD`). These are *not* shown to
  users; they only ever type the PIN.
- **Identity selection.** After the PIN, the user picks an identity — **Diogo** or **Alice**.
  This is remembered on the device.
- **Switch identity.** The user can switch identity from the Home header without re-entering
  the PIN (clears identity, returns to the picker).
- **Authorship.** Every item write records `updatedBy` = the current identity.
- All Firestore reads/writes require an authenticated session (enforced by security rules).

## 2. Notifications

- After choosing an identity, the app requests notification permission (where supported).
- If granted, an FCM token is obtained and held in app state.
- Notifications are best-effort and non-blocking: failures are silently ignored and never
  block app usage.
- **Known gap:** there is currently no backend Cloud Function delivering pushes, and the FCM
  token is not persisted to Firestore, so end-to-end push delivery is not yet functional.

## 3. Trips

- A trip has: title, start date, end date, amenities, status, creator, optional notes.
- **Creation requires** a title, a start date, and an end date. End date must be **on or
  after** the start date.
- **Status** is one of: `planned`, `active`, `completed`, `cancelled`.
  - New trips start as `planned`.
  - **Automatic, date-driven progression.** A trip advances by its dates without any user
    action: it becomes `active` **the day before** its start date, and `completed` **the day
    after** its end date (a one-day buffer on each side). Concretely, with `today` compared as
    `YYYY-MM-DD`: `completed` once `today ≥ endDate + 1 day`; otherwise `active` once
    `today ≥ startDate − 1 day`; otherwise `planned`.
  - **Forward-only & sticky cancel.** Auto-progression only ever moves a trip *forward*
    (`planned → active → completed`); it never moves a trip backward. A `cancelled` trip is
    sticky — it is never auto-changed. This reconciliation runs on app load whenever the trip
    list changes (idempotent).
  - **Manual override.** Status can still be set from the trip menu (Active / Planned /
    Complete). Manually advancing early (e.g. marking a future trip Active) sticks; manually
    moving backward within a window where the dates say otherwise will be re-advanced by the
    automatic rule on the next load.
- **Completion.** A trip becoming `completed` — whether automatically (buffer day reached) or
  via "Mark Complete" — records usage stats (see §7). Stats are recorded **exactly once** per
  trip, guarded by a `statsRecorded` flag, so re-completing or auto-completing never
  double-counts.
- **Amenities** can be selected at creation and **edited afterward** from the trip (header
  chips or menu → Edit amenities). Editing amenities updates the trip record and future stats,
  but does **not** retroactively change items already suggested into checklists.
- **Deletion** removes the trip and **all nested checklists and their items** (no orphaned
  data). Requires confirmation.
- **Auto-checklists on creation.** When a trip is created, one checklist is generated per
  *pinned checklist* snapshot (see §13), pre-filled with that snapshot's items (all
  unchecked). The generated checklists follow the **remembered ordering** (see §5): phase
  sections in the saved phase order, and checklists within each phase in the saved
  per-phase order (by name; pinned checklists with no saved position go last,
  alphabetically). Persistent items (see §12) are also seeded at this point. The generated
  checklists are themselves marked `pinned: true` so item changes continue to sync the
  global snapshot.

## 4. "Next / Current trip" selection (Home dashboard)

The Home screen focuses on a single trip, chosen in this priority:

1. The trip with status `active`, if any; otherwise
2. The **soonest upcoming** trip: earliest `startDate` that is **today or later** and whose
   status is not `cancelled` or `completed`.
3. If neither exists, show an empty state prompting to plan a trip.

- **Countdown copy:** "Happening now" if active or today is within the date range; otherwise
  "Starts today", "Starts tomorrow", or "In N days".
- The card shows aggregate packing progress and a per-checklist breakdown; the headline reads
  "No items yet", "N left to pack", or "All packed".

## 5. Checklists

- A checklist belongs to a trip and has a **phase**: `pre_early` (Before the trip),
  `pre_dayof` (Day of departure), `pack_down` (Pack down / return), `grocery` (Groceries).
- Checklists are grouped into phase **sections** and displayed in the **remembered phase
  order** (see below). A checklist's `order` is its **position within its phase** (0-based);
  newly added checklists append to the end of their phase.
- Checklists can be **added** to an existing trip as a blank checklist (name + phase).
  Each phase section shows an **"Add checklist" shortcut** that opens the dialog with that
  section's phase pre-selected. A global **"Add checklist"** button at the bottom also opens
  the blank-checklist dialog.
- Checklists can be **renamed** and **deleted**. Deleting a checklist removes all its items
  first (no orphans) and requires confirmation.
- **Drag-and-drop reordering.** From a trip, the user can drag (via a grip handle):
  - **Phase sections** (Before the trip, Day of departure, Pack down / return, Groceries) to
    change the order the sections appear in.
  - **Checklist cards within a section** to reorder them. Cards cannot be dragged into another
    section (a checklist's section is its phase).
- **Remembered ordering.** Reordering is saved globally (a single shared `appSettings/ordering`
  record), not per-trip: the phase-section order, and the per-phase order of checklist names.
  Every new trip inherits this arrangement (see §3), so the layout stays consistent trip to
  trip and reflects the user's most recent reordering.

## 6. Items & Suggestions

- A checklist/grocery item has: name, optional quantity, optional linked catalog item,
  optional store, checked state, order, an optional **persist** flag (see §12), and
  authorship/revision fields.
- **Add by Enter.** In the add flows, pressing Enter adds the item immediately and keeps the
  input ready for the next one (no forced click).
- **Catalog match.** When adding by name, if the name exactly matches a catalog item, the new
  item is linked to it (and inherits its default store); otherwise it is added as a custom item.
- **Grocery suggestions (legacy/disabled surface).** New standalone grocery lists were seeded
  with the 15 most-used grocery/general catalog items. (Feature disabled — see §9.)
- **Persistent (recurring) items.** New trips are also seeded with any persistent items
  (see §12), in addition to pinned checklist items (see §13).

## 7. Global Autocomplete Catalog

The `itemCatalog` collection is the **single global source** for item autocomplete.

- **Auto-registration.** Any new custom item name typed into any list is automatically added
  to the catalog (camping items tagged `camping`, grocery items tagged `grocery`), so it
  becomes a suggestion everywhere afterward.
- **No duplicates.** Registration is a no-op if a case-insensitive name match already exists.
  The UI also de-duplicates suggestions by name defensively.
- **One-time device sync.** On first load per device, the app:
  1. **De-dupes** the catalog (merges same-name entries, keeping the most-used, deleting the rest), then
  2. **Backfills** the catalog from every item already present across all trip checklists and
     grocery lists (so pre-existing names also become suggestions).
- **Management.** Manage → "Saved items" lists the whole catalog with search; any item can be
  removed to keep autocomplete useful, or edited (category, default store, unit).
- **Usage stats.** On trip completion (automatic or manual — see §3), each *checked* item
  linked to a catalog entry increments that entry's `totalUsed` and per-amenity counters for
  the trip's amenities. Recording happens **once per trip** (`statsRecorded` guard), so the
  date-driven auto-completion does not double-count. These stats drive the suggestion ranking
  and scoring in §6.

## 8. Groceries inside a Trip (auto-move to RV)

- A trip's **Groceries** (`grocery` phase) checklist represents shopping for the trip.
- **Rule:** when a grocery item is **checked** (i.e. bought), it is automatically **copied**
  into the trip's **Day of departure** (`pre_dayof`) checklist — the "bring to RV" list.
  - The target is the first `pre_dayof` checklist of that trip. If none exists, nothing happens.
  - The copy is skipped if an item with the same name already exists in the target (idempotent;
    re-checking does not create duplicates).
  - It is a **copy, not a move**: the item stays (checked) in Groceries and appears (unchecked)
    in the RV list. Un-checking the grocery item does **not** remove it from the RV list.

## 9. Disabled: standalone Supermarket

- The top-level **Supermarket** feature (home card, bottom-tab, and `/grocery` routes) is
  **disabled** to keep focus on camping. The grocery *section inside trips* (§8) is unaffected.
- Code is retained and commented for easy re-enable.

## 10. Data Integrity Rules

- **No `undefined` fields.** All writes strip `undefined` values before sending to Firestore
  (Firestore rejects them). Optional fields are simply omitted when absent.
- **Cascading deletes.** Deleting a trip, checklist, or grocery list also deletes its nested
  items so no orphaned subcollection data remains.
- **Revisions.** Item writes carry `rev` / `baseRev` for future conflict handling; each update
  bumps `rev` and records `updatedBy` / `updatedAt`.
- **Offline-first.** Firestore persistent local cache is enabled (multi-tab), so reads/writes
  work offline and sync when back online. Direct Firestore network calls are not cached by the
  service worker (network-only) to avoid stale data.

## 11. Reference Data (Manage)

- **Amenities** — named tags with an emoji icon (e.g. Beach, Pool). Used to drive stats.
- **Stores** — named shops; can be set as an item's default store.
- **Saved items (catalog)** — see §7.

## 12. Persistent (recurring) items

Any item in a trip checklist can be marked **persistent** (a pin toggle on the item row).
A persistent item carries over to **future** trips so the user doesn't have to re-add it.

- **Recur until checked.** A persistent item re-appears in every newly-created trip **as
  long as it remains unchecked**. Checking it (packed/bought) removes it from the recurring
  set so it stops carrying forward; un-checking it again restores it. Turning the pin off
  removes it from the recurring set regardless of checked state.
- **Placement.** A carried item lands in a checklist with the **same name and phase** as the
  one it was pinned in. If the new trip has no such checklist, that checklist is **created**.
- **No duplicates.** Carrying is skipped if an item with the same name already exists in the
  target checklist (e.g. already added by a template or amenity suggestion). The recurring set
  is keyed by phase + checklist name + item name, so the same logical item is stored once even
  if pinned across several trips.
- **Scope.** The recurring set is **global** (a shared `persistentItems` collection), not tied
  to a specific trip or to trip ordering. Deleting a pinned item also removes it from the set.
- Carried items arrive **unchecked** and remain pinned in the new trip.

## 13. Pinned Checklists (auto-create on new trip)

Any checklist in a trip can be **pinned** (via the checklist's menu → "Pin to future trips").
A pinned checklist stores a global snapshot (name, phase, items) that is seeded into every
newly-created trip as a fresh, all-unchecked copy.

- **Snapshot auto-sync.** Whenever items are added, removed, or changed in a pinned
  checklist, the global snapshot updates automatically. This means the next trip always
  starts with the most recent version of the list.
- **New trip seeding.** Checklists created from a pinned snapshot are themselves marked
  `pinned: true`, so their changes continue to sync the global snapshot going forward.
- **Unpin.** Selecting "Unpin from future trips" stops future seeding and removes the global
  snapshot. Existing checklists in current/past trips are unaffected.
- **Rename.** Renaming a pinned checklist migrates the global snapshot to the new name
  (deletes the old key, creates a new one).
- **Delete.** Deleting a pinned checklist also removes its global snapshot.
- **Placement.** Pinned checklists follow the **remembered ordering** (see §5) when seeded
  into a new trip.
- **No duplicates with persistent items.** If a persistent item (§12) targets a checklist
  with the same name+phase as a pinned checklist, it lands in that checklist; duplicates
  are skipped.

---

### Glossary of phases

| Phase       | Label                |
|-------------|----------------------|
| `pre_early` | Before the trip      |
| `pre_dayof` | Day of departure     |
| `pack_down` | Pack down / return   |
| `grocery`   | Groceries            |

# Business Rules

This document captures the product/business rules implemented in the app. It is the
source of truth for *behavior* — not code structure. Keep it updated when rules change.

App: an offline-first PWA for two users (Diogo & Alice) to plan camping/RV trips and
manage packing checklists. A standalone **Supermarket** feature (see §15) lets Alice build
per-store shopping lists for Diogo; grocery handling also lives inside camping trips (§8).

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
- If granted, an FCM token is obtained, held in app state, **and persisted** to the
  `fcmTokens` collection mapped to the current identity (re-registering or switching identity
  on a device overwrites that device's mapping cleanly).
- **Delivery.** Cross-user notifications are written by the client as `notifications`
  documents (each addressed `to` one identity). A Cloud Function (`onNotificationCreated`)
  looks up the recipient's tokens and sends a real **native/system push** to their devices,
  pruning any tokens the messaging service reports as invalid. The push is delivered as a
  **data-only** message that the service worker renders as exactly one system notification
  (no in-app banner). Once delivered, the `notifications` doc is deleted — it is a one-shot
  push trigger, not persistent state.
- Notifications are **native only**: they appear in the OS notification tray/lock screen, never
  as an in-app banner.
- Notifications are best-effort and non-blocking: failures are silently ignored and never
  block app usage.

## 3. Trips

- A trip has: title, start date, end date, amenities, status, creator, optional notes.
- **Title editing.** The trip title can be edited after creation via a pencil icon in the trip detail header. The new title must be non-empty.
- **Map shortcut.** A map-pin icon in the trip detail header opens Google Maps searching for the trip title (useful for campgrounds/locations).
- **Creation requires** a title, a start date, and an end date. End date must be **on or
  after** the start date.
- **Title autocomplete.** The trip title field suggests past trip titles as the user types
  (case-insensitive substring match, ordered most-recent first).
- **Amenity reuse.** Selecting a past title from autocomplete pre-fills the amenities with
  those of the most recent trip to that same location. The user can still change them before
  saving.
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

## 9. Legacy generic grocery surface (retained, unused)

- The original generic grocery surface (`/grocery` routes, `GroceryHome`/`GroceryDetail`,
  the `groceryLists` collection) is **not wired into the app**. It has been superseded by the
  per-store **Supermarket** feature in §15 (`/supermarket`, `supermarketLists`). The grocery
  *section inside trips* (§8) is unaffected.
- The legacy code/components are retained but unreferenced.

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
- **Auto-update.** Users always receive the latest deployed version without manually clearing
  their cache. The service worker uses `autoUpdate`; the app entry points (`index.html`, `sw.js`,
  `registerSW.js`, `manifest.webmanifest`) are served `no-cache` so the browser revalidates them
  on every visit, while content-hashed `/assets/**` bundles are cached `immutable`. The new
  version applies on the next app open, and any already-open tab auto-reloads itself the moment
  the new service worker takes control (skipping the first install and guarding against reload
  loops).

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

## 14. Trip Ratings

- When a trip is **completed** (automatically or manually), each user is prompted to rate
  their overall experience.
- **Rating scale:** 1 to 5 stars with **half-step precision** (0.5 increments: 1, 1.5, 2 … 5).
- **Prompt — notification banner.** A "How was it?" banner appears at the top of the Trips
  list the next time the user opens the app after a trip completes. Each identity is prompted
  independently.
- **Prompt count & auto-stop.** Each time the banner is shown, `ratingPrompts.<identity>`
  increments on the trip document. After **2 prompts without a rating**, the banner no longer
  auto-appears for that user. The count is stored in Firestore so the limit persists across
  devices and sessions.
- **Manual rating.** A "Rate" / "Edit" section is always visible inside the completed trip's
  detail page, regardless of prompt count. Users can rate or update their rating at any time
  from there.
- **Per-identity storage.** Ratings are stored on the trip document as `ratings.diogo` and
  `ratings.alice`, independently. Each user's rating is set separately and can be updated.
- **Display.** Ratings appear:
  - In the **trip card** (Trips list) below the amenity chips, as `★ Diogo X/5 · Alice X/5`.
    Only identities that have rated are shown.
  - In the **trip detail header**, below the amenity chips, in the same format.
- Re-submitting overwrites the previous rating.

## 15. Supermarket lists

A standalone feature (its own bottom-tab **Supermarket**, after Camping; it does **not** appear
on Home) for Alice to build shopping lists that Diogo fulfils. Each list targets one specific
supermarket.

- **Stores.** A list is for exactly one of three fixed stores: **NoFrills / FreshCo**,
  **Dollarama**, **Costco**.
- **One list per store, max three.** At most one **active** list may exist per store, so at
  most three active lists total. Creating a list prompts for the store, offering only stores
  without an active list. When all three stores have an active list, the **New list** button is
  hidden.
- **Status.** A new list is **active**. The shopper marks items bought (a check), then taps
  **COMPLETE**. Completing sets the status to **complete**, which **hides the list** from the
  Supermarket tab (only active lists are shown). Completion is allowed **whether or not**
  everything was bought — the shopper can complete with items still unbought (e.g. something was
  out of stock).
- **Completion notification.** Completing a list sends a notification (§2) to the **other**
  person (the shopper who completed is not notified about their own action):
  - If every item was bought: *"<Name> bought everything on the <store> list"*.
  - Otherwise: *"<Name> finished the <store> list. Couldn't get: <missed items>"* (the unbought
    item names).
- **Camping items.** Any item can be flagged **for camping**, either by a per-item tent toggle
  or by the shorthand **`<name> -> camping`** (also `→ camping`) when adding — the suffix is
  stripped and the item is flagged.
  - When a camping-flagged item is **bought** (checked), it is **copied** into the next trip's
    **Day of departure** (`pre_dayof`, "move to RV/truck") list. The target trip is the
    **active** trip, else the **soonest upcoming** non-cancelled/non-completed trip. No-op if
    there is no eligible trip or it has no `pre_dayof` checklist. The copy is idempotent (skips
    a same-name item already there). Flagging an already-bought item triggers the same copy.
- **Autocomplete.** Adding an item suggests **supermarket items only** — catalog entries of
  category `grocery` or `general` (never `camping`) — ranked by grocery usage. New custom names
  are registered to the catalog as `grocery`.
- **No pinning.** Supermarket items have no persist/pin behaviour.
- **Drag-and-drop reordering.** Items within a list can be reordered by dragging (via a grip
  handle), same as trip checklist items.
- **Bought items move to the end.** Checking an item as bought moves it to the bottom of the
  list (below all other items); un-checking it leaves it in place rather than moving it back.
- **Quantity stepper.** Every item is created with quantity 1 and can be adjusted anytime with a
  `+`/`-` stepper on its row (no upper cap, minimum 1).

---

### Glossary of phases

| Phase       | Label                |
|-------------|----------------------|
| `pre_early` | Before the trip      |
| `pre_dayof` | Day of departure     |
| `pack_down` | Pack down / return   |
| `grocery`   | Groceries            |

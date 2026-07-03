# Business Rules

This document captures the product/business rules implemented in the app. It is the
source of truth for *behavior* — not code structure. Keep it updated when rules change.

App: an offline-first PWA for two users (Diogo & Alice) to plan camping/RV trips and
manage packing checklists. A standalone **Supermarket** feature (see §15) lets Alice build
per-store shopping lists for Diogo; grocery handling also lives inside camping trips (§8).

---

## 1. Authentication & Identity

- **App PIN gate.** On launch, the user enters a shared app PIN. It is verified
  **server-side** by the `exchangePin` Cloud Function (the PIN lives only in the
  `APP_PIN` function secret — no credentials ship in the client bundle). A wrong PIN
  shows "Wrong password"; verification requires connectivity.
- **Brute-force lockout.** After 5 consecutive wrong PINs (globally), sign-in is locked
  for 15 minutes ("Too many attempts").
- **Custom-token session.** A correct PIN returns a Firebase custom token; the client
  signs in with it as the shared `shared-app-user` identity. Users only ever type the PIN.
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
- Checklists can be **added** to an existing trip as a blank checklist (name + phase). A
  single **"+ Add checklist"** link in the trip header (next to the amenities **Edit** link)
  opens a dialog that asks **where** the checklist goes — a Section (phase) picker — plus a
  name (or a Store picker for the Groceries section, §8). There is no per-section or bottom
  add button.
- **"+ Add item" header shortcut.** Alongside "+ Add checklist" the header has a **"+ Add
  item"** link. It opens a picker of the trip's (visible) checklists grouped by phase; choosing
  one closes the picker, **smooth-scrolls that checklist into view**, and **opens that list's
  Add-item sheet** (exactly as tapping the list's own "+ Add item" row would). It is disabled
  when the trip has no visible checklists.
- **Phase-section icons.** Each phase section header shows an icon beside its name: Before the
  trip (backpack), Day of departure (truck), Pack down / return (open package), Groceries
  (shopping cart).
- Checklists can be **renamed** and **deleted**. Deleting a checklist removes all its items
  first (no orphans) and requires confirmation.
- **Hide a checklist for this trip.** Each checklist's menu has **"Hide for this trip"**
  (**"Unhide"** when hidden). Hiding means "I'm not doing anything about this list on this
  trip" — it works even if the list still has unchecked items. A hidden checklist is collapsed
  out of the trip view. Hiding is **per-trip** (a `hidden` flag on the checklist); it is not
  carried to future trips.
  - **Show hidden toggle.** When the trip has any hidden checklists, a **"Show hidden (N)"**
    toggle link appears in the header (next to "+ Add checklist"). Toggling it reveals the
    hidden checklists (dimmed, with a **Hidden** badge) so they can be unhidden; toggling again
    re-collapses them.
  - **Auto-hide prompt on completion.** The moment a checklist becomes **100% complete** (its
    last item is checked), the user is asked whether to hide it for this trip. Declining leaves
    it visible. A list that is already complete when the trip is opened does not re-prompt.
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

## 8. Groceries inside a Trip (store-linked, synced with Supermarket, auto-move to RV)

- A trip's **Groceries** (`grocery` phase) checklist represents shopping for the trip. Each
  grocery checklist is for **exactly one Store** (see §11) — picked from a store list, not
  typed as free text. The checklist's name mirrors the store's name at the time it's created
  or changed.
  - **New checklist.** The "New checklist" dialog shows a store picker (instead of a name
    field) when the Groceries section is selected, offering stores that don't already have a
    grocery checklist on this trip.
  - **Change store.** The checklist menu's "Change store" (grocery checklists only, replacing
    "Rename") re-links the checklist to a different store, updating its name to match.
  - **Quantity.** Every grocery item has a `+`/`-` quantity stepper on its row (min 1), matching
    the Supermarket stepper (§15).
- **Sync with Supermarket (live-linked pair).** A store-linked grocery checklist only syncs
  while its trip is the **next/active trip** (§4's selection rule: active trip, else soonest
  upcoming non-cancelled/non-completed trip) — checklists on other trips behave as plain lists.
  - **Trip → Supermarket.** Adding an item to a synced grocery checklist mirrors it into that
    store's active Supermarket list (creating the list if none is active), adopting a
    same-name item there instead of duplicating.
  - **Supermarket → Trip.** A Supermarket item only appears in the trip's grocery checklist
    once flagged **for camping** (the tent icon / `-> camping` shorthand, §15). Flagging it
    mirrors it into the synced trip's checklist for that store (creating the checklist if
    needed); un-flagging removes the mirrored copy from the trip (the Supermarket item itself
    stays).
  - **Once linked**, the two items are the same shopping-list entry: checking/unchecking,
    quantity changes, and deletion on either side apply to both. (Un-flagging in Supermarket is
    the one "soft" unlink — it removes the trip copy but keeps the Supermarket item.)
  - **Sticky to its trip.** A link is fixed to whichever trip was next/active at the moment it
    was created — it does not retarget if a different trip later becomes next/active.
  - Deleting a whole checklist or trip does **not** cascade to Supermarket (only per-item
    add/check/qty/delete actions propagate); any linked Supermarket items are left as-is.
- **Checked → copy to RV.** When a grocery item is **checked** (bought) — whether directly in
  the trip, or via its linked Supermarket item — it is automatically **copied** into the trip's
  **Day of departure** (`pre_dayof`) checklist — the "bring to RV" list.
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
- **Stores** — named shops. This is the **single shared list** of stores used everywhere:
  as an item's default store, as the picker for trip grocery checklists (§8), and as the
  list of stores Supermarket (§15) can have a list for. Seeded on first load with **NoFrills /
  FreshCo**, **Dollarama**, and **Costco**; more can be added, renamed, or removed here, which
  changes what's available in both Groceries and Supermarket going forward.
- **Saved items (catalog)** — see §7.
- **Bugs & ideas** — a sortable log of bug reports and improvement ideas (§17).

## 12. Persistent (recurring) items

Any item in a trip checklist can be marked **persistent** (a pin toggle on the item row).
A persistent item carries over to **future** trips so the user doesn't have to re-add it.

- **Recur until checked.** A persistent item re-appears in every newly-created trip **as
  long as it remains unchecked**. Checking it (packed/bought) removes it from the recurring
  set so it stops carrying forward; un-checking it again restores it. Turning the pin off
  removes it from the recurring set regardless of checked state.
- **Immediate push to existing upcoming trips.** Pinning an item doesn't only affect trips
  created afterward — it also immediately mirrors the item into every **other** trip that is
  currently `active` or `planned` (not `completed`/`cancelled`), landing in the checklist with
  the same name+phase (created if missing). Skipped per-trip if that trip's target checklist
  already has a same-name item. Un-pinning does **not** retract already-mirrored copies.
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
- **Immediate push to existing upcoming trips.** The moment a checklist is pinned, its
  current items are also immediately mirrored into every **other** trip that is currently
  `active` or `planned` (not `completed`/`cancelled`) — not just trips created afterward.
  A matching checklist (same name+phase) is created if the trip doesn't have one; items
  already present there by name are skipped. This one-time push happens only at the moment
  of pinning — later edits to the pinned checklist are not re-pushed to other trips (only
  the global snapshot updates, per above).
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

- **Stores.** A list is for exactly one store from the shared Stores list (Manage → Stores,
  §11) — not a fixed set. Seeded with **NoFrills / FreshCo**, **Dollarama**, **Costco**, and
  grows/shrinks as stores are added or removed in Manage → Stores.
- **One list per store.** At most one **active** list may exist per store. Creating a list
  prompts for the store, offering only stores without an active list. When every store already
  has an active list, the **New list** button is hidden. This is also enforced at write time
  (not just the picker UI): starting a list always checks for an existing active list for that
  store first and reuses it instead of creating a second one.
- **Store name is denormalized onto the list.** A list stores a copy of its store's name at
  creation (kept in sync when the store is renamed in Manage → Stores). Display prefers the
  live store record, then this copy — so a list still shows its store name even if the store
  was deleted or the stores data hasn't loaded yet.
- **Stores with an active list can't be deleted.** Deleting a store from Manage → Stores (§11)
  is blocked while it has an active Supermarket list, since removing it would leave that list
  pointing at a store that no longer exists. Complete or otherwise clear the list first.
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
- **Camping items (live-linked with trip Groceries, §8).** Any item can be flagged **for
  camping**, either by a per-item tent toggle or by the shorthand **`<name> -> camping`** (also
  `→ camping`) when adding — the suffix is stripped and the item is flagged.
  - Flagging an item **mirrors it** into the next/active trip's Groceries checklist for this
    store (creating that checklist if the trip doesn't have one yet for this store). No-op if
    there's no eligible trip (active trip, else soonest upcoming non-cancelled/non-completed
    one). Un-flagging removes the mirrored copy from the trip but leaves the item in Supermarket.
  - Once mirrored, the Supermarket item and the trip item are the same entry: checking, quantity
    changes, and deletion on either side apply to both (§8).
  - Checking a camping-flagged item bought copies it into the trip's **Day of departure**
    (`pre_dayof`, "move to RV/truck") list, via the same rule that fires for any checked trip
    grocery item (§8) — idempotent, skips a same-name item already there.
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

## 16. Supermarket auto-sort (learned ordering)

Supermarket lists learn how the user likes them ordered and auto-sort future lists to
match. The memory is **global and per store** (a shared `appSettings/supermarketSort`
record, keyed by store, §11/§15).

- **Word-based matching.** Item names are compared by **words**, not exact text: two items
  count as the same kind of thing if they share **at least one word**. So *"Yogurt vanilla"*
  and *"Yogurt banana"* are treated alike (shared word "yogurt"). Words are lowercased;
  single characters and pure numbers are ignored.
- **Learning from a manual sort.** Whenever the user **drag-reorders** a list, that ordering
  is recorded: each item's words are nudged toward that item's position in the list (top →
  bottom). Only the deliberately-ordered (unbought) items teach — items already **bought**
  sit at the bottom by the bought-to-end rule (§15), not by choice, so they do not teach.
  A list with fewer than two unbought items carries no ordering signal and teaches nothing.
- **Recency + sharpening.** The memory is an exponential moving average, so the **most recent
  sort carries the most weight** while older sorts still count; the ordering keeps getting
  more accurate the more the user re-sorts.
- **Auto-sort on add.** In an existing list, **every time an item is added** the whole list
  is re-sorted by the learned order. An item is scored by the average learned position of its
  known words; items whose words have no history yet sink to the bottom of the unbought group
  (in their current order), and bought items always stay at the very bottom (§15). The user
  can still drag afterward — which in turn teaches the model.

## 17. Bugs & ideas (Manage)

A shared, sortable to-do list for logging bugs and improvement ideas, reached from
**Manage → Bugs & ideas**. It is a single global list (a shared `feedback` collection).

- **Entry.** Each entry has a free-text description and a **kind** — `bug` or
  `improvement` — chosen when adding. Kind and text can be edited afterward. The
  description is **multi-line** — Enter inserts a new line/paragraph, ⌘/Ctrl+Enter saves —
  and line breaks are preserved when the entry is displayed and exported.
- **Single list, filterable.** All entries live in one list. A filter (**All / Bugs /
  Improvements / Completed**) only hides rows; it never changes the underlying list or
  ordering. Each row shows its kind as a labelled badge regardless of the active filter.
  The **All / Bugs / Improvements** filters show only *active* (not-completed) entries; the
  **Completed** filter shows only completed ones.
- **Complete & restore.** Marking an entry complete (the check button) sets a `done` flag,
  which hides it from the working list but keeps it. It reappears under the **Completed**
  filter, where the (now filled) check button un-completes it — restoring it to the working
  list — so a mistaken completion can be undone.
- **Permanent delete.** A completed entry can be removed for good via a trash button (shown
  only in the Completed view), after a confirmation. Active entries have no delete — the
  path to removal is complete → (optionally) delete.
- **Drag-and-drop sorting.** Entries can be reordered by dragging (via a grip handle); the
  order is remembered globally. Reordering while a filter is active moves the visible rows
  and leaves the hidden entries in their relative positions.
- **Export to clipboard.** A copy button exports the **active (not-completed) entries** (in
  their saved order, ignoring the active filter) to the clipboard as plain text, ready to
  paste into an AI. Each entry is a running-numbered block prefixed by its kind — e.g.
  `Bug 1:` then the text on the next line, `Improvement 2:` then its text — separated by a
  blank line.
- **Authorship.** Each entry records the identity that created it (`createdBy`) and a
  creation timestamp.

## 18. "Bring it back" items (auto-copy to Pack down / return)

Any checklist item (outside the Pack down / return phase) can be flagged **"bring it
back"** via a per-item toggle (a return/undo icon on the item row, next to the persist
pin). It is a reminder to make sure something you took on the trip comes home again.

- **Copy on check.** When a "bring it back" item is **checked off**, it is automatically
  **copied** into the trip's **Pack down / return** (`pack_down`) checklist — so it shows up
  (unchecked) as something to account for when packing down. Checking it means "I've got the
  wallet" in the origin list; the copy in Pack down is the "did it come back?" reminder.
- **Target list, created if missing.** The copy lands in the trip's first `pack_down`
  checklist. If the trip has **no** Pack down checklist, one named **"Bring back"** is created.
- **Copy, not move.** The item stays (checked) in its origin list and appears (unchecked) in
  Pack down.
- **Un-check removes the copy.** Un-checking the origin item removes the matching (same-name)
  entry from the trip's Pack down / return checklist(s), so a mistaken check is fully undone.
- **No duplicates.** The copy is skipped if an item with the same name already exists in the
  Pack down checklist (idempotent; re-checking never duplicates).
- **Scope.** The flag is a per-item property (`bringBack`); it does not carry to future trips
  and is independent of the persist pin (§12). The toggle is hidden on items that already
  live in a `pack_down` checklist (nothing to copy them into).
- **Set at add time (2-step flow).** Adding an item in the Add-item sheet is a two-step flow:
  after the user creates or picks an item, a follow-up screen offers three choices for that item —
  **Bring every trip** (sets the persist flag, §12), **Bring back** (sets `bringBack`), or
  **SKIP** (no flag). Choosing any of the three returns to the search field for the next item.
  The **Bring back** option is hidden when adding into a `pack_down` checklist.

---

### Glossary of phases

| Phase       | Label                |
|-------------|----------------------|
| `pre_early` | Before the trip      |
| `pre_dayof` | Day of departure     |
| `pack_down` | Pack down / return   |
| `grocery`   | Groceries            |

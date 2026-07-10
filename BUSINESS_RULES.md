# Business Rules

This document captures the product/business rules implemented in the app. It is the
source of truth for *behavior* — not code structure. Keep it updated when rules change.

App: an offline-first PWA for two users (Diogo & Alice) to plan camping/RV trips and
manage packing checklists. A standalone **Supermarket** feature (see §15) lets Alice build
per-store shopping lists for Diogo; items flagged for camping there flow into the trip's
**Bring to Truck** list (§8). Trips themselves have no grocery section.

---

## 1. Authentication & Identity

- **App PIN gate.** On launch, the user enters a shared **4-digit numeric PIN** on an
  on-screen keypad (digits shown as filled dots; a delete key removes the last digit;
  a physical keyboard's number keys and Backspace work too). The PIN **submits itself**
  as soon as the 4th digit is entered — there is no Continue button. It is verified
  **server-side** by the `exchangePin` Cloud Function (the PIN lives only in the
  `APP_PIN` function secret — no credentials ship in the client bundle). A wrong PIN
  shows "Wrong PIN" and clears the entry; verification requires connectivity. Any other
  failure shows "Sign-in failed — check the console" and logs the underlying error code.
- **Runtime IAM requirement.** Minting the custom token calls `createCustomToken`, which
  requires the functions' runtime service account to hold `roles/iam.serviceAccountTokenCreator`.
  Without it every sign-in fails with `auth/insufficient-permission`.
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
- **Tap target.** A notification may carry a `url` (an in-app path). Tapping the system
  notification focuses an already-open app window and navigates it there — or opens a new one —
  defaulting to Home when no `url` is set.
- **Delivery.** Cross-user notifications are written as `notifications` documents (each
  addressed `to` one identity) — by the client, or by a scheduled function for the daily
  Supermarket digest (§15). A Cloud Function (`onNotificationCreated`)
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
- **Editing a trip.** A single **Edit trip** dialog — opened by the pencil next to the trip
  title, or menu → Edit trip — edits the **name, start/end dates and amenities** together.
  Save requires a non-empty name and an end date not before the start date. There is no
  separate name-only or amenities-only dialog; the header amenity chips are display-only.
- **Amenities** can be selected at creation and **edited afterward** via that dialog. Editing
  amenities updates the trip record and future stats, but does **not** retroactively change
  items already suggested into checklists.
- **Deletion** removes the trip and **all nested checklists and their items** (no orphaned
  data). It takes effect immediately, with no confirmation.
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
2. A trip **currently underway by its dates** (`startDate` ≤ today ≤ `endDate`) even if it is
   still `planned` — a trip whose start has passed but that was never marked active is still a
   valid target; if several, the one with the earliest `startDate`. Otherwise
3. The **soonest upcoming** trip: earliest `startDate` that is **today or later**.
   (In all cases `cancelled`/`completed` trips are excluded.)
4. If none exists, show an empty state prompting to plan a trip.

- **Countdown copy:** "Happening now" if active or today is within the date range; otherwise
  "Starts today", "Starts tomorrow", or "In N days".
- The card shows packing progress for the trip's single list (§20); the headline reads
  "No items yet", "N left to pack", or "All packed". There is **no per-checklist breakdown** —
  with one list per trip it only ever restated the progress bar above it.

## 5. Checklists

> **Superseded by §20.** The four phase sections and their drag-reorder/hide/pin machinery
> below describe the legacy model. The live model has only **Groceries (per store)** + a
> single **Other** list, shown through the stage-driven trip view. Much of this section is
> retained for history; where it conflicts with §20, §20 wins.

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
  item"** link. When the trip has exactly one visible checklist the picker is skipped and that
  list is used directly. Otherwise it opens a picker of the trip's (visible) checklists grouped
  by phase. Either way the target list is **smooth-scrolled into view** and its **Add-item
  sheet opens** (exactly as tapping the list's own "+ Add item" row would). It is disabled
  when the trip has no visible checklists.
- **Phase-section icons.** Each phase section header shows an icon beside its name: Before the
  trip (backpack), Day of departure (truck), Pack down / return (open package), Groceries
  (shopping cart).
- Checklists can be **renamed** and **deleted**. Deleting a checklist removes all its items
  first (no orphans) and takes effect immediately, with no confirmation.
- **Hide a checklist for this trip.** Each checklist's menu has **"Hide for this trip"**
  (**"Unhide"** when hidden). Hiding means "I'm not doing anything about this list on this
  trip" — it works even if the list still has unchecked items. A hidden checklist is collapsed
  out of the trip view. Hiding is **per-trip** (a `hidden` flag on the checklist); it is not
  carried to future trips.
  - **Show hidden toggle.** When the trip has any hidden checklists, a **"Show hidden (N)"**
    toggle link appears in the header (next to "+ Add checklist"). Toggling it reveals the
    hidden checklists (dimmed, with a **Hidden** badge) so they can be unhidden; toggling again
    re-collapses them.
  - **Auto-hide on completion.** The moment a checklist becomes **100% complete** (its last
    item is checked), it is hidden for this trip automatically, with no confirmation; it can be
    unhidden from the "Show hidden" toggle. A list that is already complete when the trip is
    opened is left visible. (Historically store-linked grocery checklists were exempt; they no longer exist.) The Supermarket
    side and being "all bought" is their normal state, so auto-hiding them would swallow items
    the user expects to see mirrored into the trip (§8). They can still be hidden manually.
- **Completed items sort to the bottom.** Inside an expanded checklist card, checked (completed)
  items are shown by default but **sorted to the bottom** of the list (below outstanding items,
  preserving order within each group).
- **Manually hide completed items.** The card's menu has a **"Hide completed" / "Show completed"**
  toggle. Hiding removes checked items from the card (the `checked/total` progress still counts
  them); a hint row ("N completed items hidden — show") then appears above "+ Add item" to reveal
  them. This is view-only state, per card, not persisted and not carried to future trips.
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
  optional store, checked state, order, an optional **persist** flag (see §12), an optional
  **final destination** (Home / Truck / RV, see §18), and authorship/revision fields.
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
- **Autocomplete only.** The trip Add-item sheet shows **no suggestions until something is
  typed** — an empty search box lists nothing. Once typing, it shows at most 8 name matches,
  ranked by `totalUsed`.
- **Matches come first.** Catalog matches are listed **above** the "Add …" row that creates a
  brand-new item from the typed text, since reusing a known item is the common case. The
  "Add …" row is hidden when the typed text exactly matches a catalog entry.
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

## 8. Groceries reach a Trip only from Supermarket

- **Trips have no Groceries section.** A trip has exactly one list — **"Bring to Truck"**
  (`other` phase). Groceries are never added on the trip screen; they are built in the
  standalone **Supermarket** feature (§15), per store.
  - **Migration.** On load, each trip's `grocery` checklists are collapsed: their items move
    into the Bring-to-Truck list (taking destination **Truck** if they had none), any live
    Supermarket link is re-pointed at the moved copy, and the emptied grocery checklists are
    deleted.
- **Supermarket → Trip (one direction), and only once bought.** A Supermarket item enters the
  trip only when it is **both** flagged **for camping** (the tent icon / `-> camping`
  shorthand, §15) **and checked off as bought**. Flagging an unbought item merely records the
  intent — there is nothing to load into the truck until it has been purchased.
  - Whichever of the two happens second mirrors the item into the next/active trip's
    Bring-to-Truck list (§4's selection rule: active trip, else soonest upcoming
    non-cancelled/non-completed trip) with the **Truck** final destination (§18) — camping
    groceries ride in the truck to camp — adopting a same-name item there instead of
    duplicating, and leaving that item's destination alone if it already had one. No-op if
    there is no eligible trip.
  - **Un-buying** it removes the mirrored copy from the trip and keeps the camping flag on.
    **Un-flagging** removes the copy and clears the flag. Either way the Supermarket item stays.
  - **Sticky to its trip.** A link is fixed to whichever trip was next/active when it was
    created — it does not retarget if a different trip later becomes next/active.
- **The two checks mean different things.** Checking in Supermarket means **bought** — it is
  what admits the item to the trip. Checking in the trip means **handled at this stop** (loaded
  into the truck, §20) and never propagates back to Supermarket.
- **What a link does propagate:** **quantity** changes and **deletion**, either way. Deleting a
  whole checklist or trip does **not** cascade to Supermarket.
- **Quantity.** A trip row shows quantity **read-only**, as `(3)` after the item name, and only
  when greater than 1. There is no `+`/`-` stepper on trip rows; a mirrored item's quantity is
  edited in Supermarket (§15) and flows through to the trip row.

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
- **No confirmation dialogs.** No action anywhere in the app asks the user to confirm — every
  action, including destructive and irreversible ones (deleting a trip, checklist, item,
  catalog entry, store, template, procedure step, or feedback entry) and every notifying one
  (sending or completing a Supermarket list), applies immediately on tap.
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
  as an item's default store and as the
  list of stores Supermarket (§15) can have a list for. Seeded on first load with **NoFrills /
  FreshCo**, **Dollarama**, and **Costco**; more can be added, renamed, or removed here, which
  changes what's available in Supermarket going forward.
- **Saved items (catalog)** — see §7.
- **Bugs & ideas** — a sortable log of bug reports and improvement ideas (§17).
- **Safety checklists** — the shared per-transition safety procedures reused by every trip (§20).

## 12. Persistent (recurring) items

Any item in a trip checklist can be marked **persistent** ("Pin to next trip" in the item row's
"⋮" overflow menu; the active state is shown by a filled pin and a check mark).
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
- **Remembered final destination.** The recurring record stores the item's final destination
  (Home / Truck / RV, §18) so carried copies seed with the same destination. It is captured
  when the item is pinned and **kept in sync**: changing a pinned, unchecked item's destination
  updates the global record too, so the latest destination is what future trips inherit.

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
  Supermarket tab (only active lists are shown). The **COMPLETE** button is **hidden until at
  least 20% of the list's items are checked off** — this guards against the person building the
  list finishing it by mistake before shopping has meaningfully started. Completion is allowed
  **whether or not**
  everything was bought — the shopper can complete with items still unbought (e.g. something was
  out of stock).
- **Completion notification — only when something was missed.** Completing a list with **every
  item bought sends no notification at all** (that is the expected outcome; silence is the
  signal). If one or more items were left unbought, a notification (§2) goes to the **other**
  person (the shopper who completed is never notified about their own action):
  *"<Name> finished the <store> list. Couldn't get: <missed items>"* (the unbought item names).
  Tapping it opens the Supermarket tab.
- **Daily "items added" digest.** Once a day at **18:00 America/Toronto**, a scheduled Cloud
  Function (`dailySupermarketDigest`) sends **both** people one notification summarising the
  items added to active Supermarket lists since the previous run — never one push per item.
  - **Silent when nothing was added.** No new items since the last run ⇒ no notification.
  - The **title** names the stores touched, joined with `+`; the **body** sums the additions
    and list sizes **across all of them**:
    - One store: title *"NoFrills/FreshCo"*, body *"1 new item added (total: 4)"*.
    - Two stores: title *"NoFrills/FreshCo + Costco"*, body *"2 new items added (total: 7)"* —
      2 added between them, 7 items across both lists.
  - The store name comes from the live `stores` record, falling back to the name denormalized
    on the list (same preference as list display, §15).
  - **Tapping it** opens that store's list when only one store was touched, otherwise the
    Supermarket tab.
  - "New" is judged by the item's `createdAt` against the last run's timestamp, so items that
    predate this feature (they have no `createdAt`) are never reported. The run timestamp
    advances even on silent days, so nothing is ever reported twice.
- **Camping items (live-linked with the trip's Bring-to-Truck list, §8).** Any item can be
  flagged **for camping**, either by a per-item tent toggle or by the shorthand
  **`<name> -> camping`** (also `→ camping`) when adding — the suffix is stripped and the item
  is flagged.
  - A flagged item **is mirrored** into the next/active trip's **Bring to Truck** (`other`)
    list — with the **Truck** final destination (§18), unless a same-name trip item it adopts
    already has one — **only once it is also checked off as bought** (§8). The trip copy starts
    **unchecked**: bought at the store and loaded into the truck are different acts. No-op if
    there's no eligible trip. Un-buying or un-flagging removes the mirrored copy from the trip
    but leaves the item in Supermarket.
  - Once mirrored, quantity changes and deletion on either side apply to both (quantity is only
    editable from Supermarket); the trip's per-stop check never propagates back (§8).
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
- **Swipe-right to delete.** Swiping a row to the right past a threshold deletes it immediately,
  with no confirmation (revealing a red delete affordance as it slides). The horizontal swipe is
  tracked independently from the vertical drag-reorder handle so the two don't conflict.
- **"Remove item" menu action.** Each row also has a "⋮" overflow menu whose **Remove item**
  action deletes the row immediately, with no confirmation. The row's other tap actions are the bought check, the `+`/`-` stepper, and a tent
  (camping) toggle, kept large for easy tapping. However it's deleted, removing a live-linked
  camping item also removes its trip copy (§8); deleting from the trip side still
  propagates here too.

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
  only in the Completed view), with no confirmation. Active entries have no delete — the
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

## 18. Item final destination (Home / Truck / RV)

> **Updated by §20.** Destination is now the core driver of the stage-driven flow: each stop
> derives its view by filtering/grouping items on destination. The old **copy-on-check into
> "Bringing back items"** (and the grocery copy into "Spmkt->Truck", §8) is **retired** —
> those lists no longer exist. The paragraphs below about auto-copy no longer apply; the
> destination property, the required add-time step, and the tap-to-cycle row icon all remain.

Every checklist item can carry a **final destination** — **Home**, **Truck**, or **RV** —
answering "where does this thing belong when the trip is over?". Destination **Home** means
the item must come back home; it supersedes the old "bring it back" flag (legacy
`bringBack: true` items read as destination Home until a destination is set).

- **Set at add time (2-step flow, required).** Adding an item in the Add-item sheet is a
  two-step flow: after the user creates or picks an item, a follow-up screen titled
  **"Final destination for &lt;item&gt;?"** offers three self-explanatory choices, in order:
  **"Bring back Home"**, **"Stays in the RV"**, **"Stays in the truck"**. No hint text, no
  restatement of what was just added. There is **no skip** and no pin option here (pinning to
  future trips, §12, is done later on the item row). Choosing returns to the search field for
  the next item.
- **Row icon, tap to cycle.** Each item row shows its destination as an icon (house / truck
  / caravan; a gray map-pin when unset, e.g. old items). Tapping the icon **cycles**
  Home → Truck → RV, so the destination can be changed at any time. Shown in every phase.
- **Copy on check (destination Home).** When a destination-**Home** item is **checked off**,
  it is automatically **copied** into the trip's **Pack down / return** (`pack_down`)
  checklist — so it shows up (unchecked) as something to account for when packing down.
  Truck/RV items are never copied (they stay where they are). Grocery checklists are
  excluded — bought groceries follow their own copy-to-"Spmkt->Truck" rule (§8) and don't
  flood Pack down. Items already in a `pack_down` checklist never copy onto themselves.
- **Target list, created if missing.** The copy always lands in a dedicated
  **"Bringing back items"** checklist in the `pack_down` phase, **created automatically** the
  first time one is needed. It is never routed into an unrelated pack_down checklist.
- **Copy, not move.** The item stays (checked) in its origin list and appears (unchecked) in
  Pack down.
- **Un-check removes the copy.** Un-checking the origin item removes the matching (same-name)
  entry from the trip's Pack down / return checklist(s), so a mistaken check is fully undone.
- **Change order doesn't matter.** Changing the destination of an item that is **already
  checked** reconciles the Pack down copy immediately: switching to Home copies it in,
  switching away removes it.
- **No duplicates.** The copy is skipped if an item with the same name already exists in the
  Pack down checklist (idempotent; re-checking never duplicates).
- **Carries forward.** Destination is part of the item and travels with it: pinned-checklist
  snapshots (§13) and persistent items (§12) remember it, so items seeded into new trips
  arrive with their destination already set.

## 19. Printing checklists

Lists can be printed to paper as a hand-check sheet.

- **Print a single list.** Each checklist card's menu has a **Print** action that prints
  just that checklist.
- **Print all.** The trip detail menu (the "edit" level for the trip) has **Print all lists**,
  which prints every **visible** (non-hidden) checklist of the trip, grouped as sections in
  the trip's **phase-section order** (§5).
- **Completed items are ignored.** Printouts include only **outstanding** (unchecked) items —
  what's left to do. A list with nothing outstanding is skipped; printing when everything is
  done shows a "Nothing to print" notice.
- **Hand-check boxes.** Each printed item has an empty checkbox to tick off by hand.
- **No icons/controls.** The printout shows item names only (plus quantity where meaningful) —
  none of the app's icons, buttons, or per-item controls.
- **Paper-saving layout.** Sections flow into multiple balanced columns (2 columns, or 3 when
  there are more than 24 outstanding items) with compact spacing, so a printout tries to fit on
  a single page and waste as little paper as possible.
- Printing renders into a hidden document and opens the browser's native print dialog; it
  never changes any data.

## 20. Stage-driven trip flow (route stops, per-stop views, safety procedures)

This is the primary model for the trip screen and **supersedes the four-phase model**.
See `STAGE_FLOW_SPEC.md` for the design rationale.

### The one-list model

- A trip has exactly **one** list: **Other**, shown as **"Bring to Truck"**. The old phase
  sections (Before the trip / Day of departure / Pack down / Groceries) are gone; internally
  only the `other` checklist phase is used. Groceries arrive here from Supermarket (§8).
- **Migration.** On load, each trip's legacy `pre_early`/`pre_dayof`/`pack_down` checklists
  (including the retired auto-lists "Spmkt->Truck" and "Bringing back items") are collapsed:
  their items move into the single Other list and the emptied checklists are deleted.
  New trips are collapsed the same way after seeding, and always have an Other list.
- **Groceries migration.** The per-store `grocery` checklists are likewise gone from the trip
  screen: every grocery item is moved into Other with destination **Truck**, any live
  Supermarket link is re-pointed at its new home, and the emptied grocery checklists are
  deleted. Groceries now reach a trip only as Other items (§8).
- **Adding.** Every item is added with the Add-item sheet's required **final destination**
  step (§18). **"+ Add item"** is the trip's primary action: a full-width button at the top of
  the trip screen. Because a trip has only one list, the picker is **skipped** and the sheet
  opens straight onto Other. No list is ever created by hand.
- **List titles are display-only.** A list's stored `name` never changes (pinned lists key off
  it), but everywhere a list title is shown — card header, print output, add-item sheet — the
  Other list is rendered as **"Bring to Truck"**.
- **No section headers at Home.** Stop 0 shows the trip's lists as one flat, reorderable
  stack of cards — there is no phase grouping or "Packing" header. Grouping by destination
  only appears at the later stops' stage views (§20).

### The route

Fixed **stops**: **Home → Warehouse → Campsite → Warehouse → Home** (index 0–4).
`currentStop` lives on the trip (shared live between Diogo and Alice). Advancing is **manual**
(no date/time automation). New trips start at Home (0).

The route is shown as a **compact stepper in the top-right of the trip header**, on the dates
row: the **current stop's icon** (Home / Warehouse / Tent — no label, no background) followed
by a secondary **Next** text link that opens that stop's safety checklist to move on
(**Finish** at the last stop). A pending-checks count rides on the link while safety steps are
unchecked. An **undo** icon beside it steps back one stop without losing check state (hidden
at Home).

### What each stop shows

- **Stop 0 — Home (departure):** the editable **Bring to Truck** list (add items, set
  destinations, qty, pin, delete). This is the packing pass — check items as they go into the
  truck. Then the *Leaving home* safety checklist to advance.
- **Stop 1 — Warehouse (GO):** **safety checklist only** (moving food truck→RV here is
  obvious; no item list).
- **Stop 2 — Campsite (leaving):** a derived **stow** checklist of all items, grouped by
  where each goes — **RV** or **Truck**. An item whose destination is **Home is shown as
  Truck** here (it must ride in the truck to get home). Check = stowed. Then the *Leaving the
  campsite* safety checklist.
- **Stop 3 — Warehouse (return):** derived view of items to sort between **RV** and **Truck**
  (Home again shown as Truck). Then the *Leaving the warehouse (heading home)* safety checklist.
- **Stop 4 — Home (arrival):** derived **bring-inside** checklist of **destination-Home**
  items only. Then the **final** *Arriving home* safety checklist, whose **Finish trip**
  action marks the trip complete and opens the **star rating** prompt (§14).

**No deleting from the derived stop views.** Rows at stops 2–4 offer only the done checkbox and
the destination toggle — there is no delete action. Once the trip is under way an item is a
thing physically in the truck, not a line to edit; removing items from the trip is done at
**stop 0 (Home)**, on the editable checklists.

**Only what was handled travels to the next stop.** The derived stop views (stops 2–4) draw
from the trip's list, but an item appears at a stop **only if it was checked off at an earlier
stop**. An item left unchecked never made it into the truck — it wasn't found, or the user
chose not to bring it — so there is nothing to stow, sort, or bring inside for it. Handling is
the per-stop check (`stagesDone`), which the checklist card also records at the trip's current
stop. An item that was never handled simply never enters the route.

**The return warehouse is a catch-up for the campsite.** Stop 3 exists to stow what was
*forgotten* at the campsite, so an item **checked off at stop 2 does not appear at stop 3** —
it is already where it belongs and needs no second look. Only the items still unchecked at the
campsite carry over. Un-checking an item at stop 2 brings it back to stop 3. This does not
affect stop 4, where destination-**Home** items are still brought inside regardless of where
they were stowed.

**Remove after completion.** Each item row offers a **"Remove after completion"** toggle in
its "⋮" overflow menu (the item row itself shows only the checkbox and the destination icon).
It behaves like the persist pin: it is an **on/off flag** (`removeOnComplete`) that by itself
neither checks nor hides the item. The checklist-card checkbox and the stage checkbox are two
views of the same "handled" state: checking an item from its **checklist card** records it as
handled at the trip's **current stop** (and unchecking clears that stop), so both routes feed
the rule below. When it is **on**,
the item **never travels to a later stop**: being handled is exactly what retires it, and an
item that was never handled doesn't travel anyway (see the rule above). When it is **off**, the
item travels to the stops that follow the one where it was handled, subject to its destination.
The flag is independent of the persist pin: **a pinned item that's removed after completion
still recurs on the next trip** (§12), and it never propagates to Supermarket (it's
trip-management, not "bought").

**Batch flagging.** The trip's "⋮" menu offers **"Remove after completion"**, opening a
full-screen sheet listing every item of every non-hidden checklist, grouped by checklist.
Already-flagged items are shown highlighted, so the sheet doubles as the overview of what
is currently flagged. Tapping an item toggles its flag locally; **Save** writes only the
items whose flag changed and closes the sheet, and closing without saving discards the
edits. The flag written is the same `removeOnComplete` described above.

**Remove item.** The same "⋮" menu offers **"Remove item"**, which deletes the item from the
checklist immediately, with no confirmation. If the item is live-linked to a Supermarket item, that copy is
deleted too (§8/§15), and a pinned item is dropped from the recurring set (§12). Checked items
that should merely be hidden rather than deleted are handled by the card's "Hide completed"
toggle (§5).

**Per-stop, independent completion.** Each item is checked **independently at each stop**
(`stagesDone` = the stop indices it's been handled at). Checking it at one stop does not
check it at another. Item destination (§18) is what every derived view filters and groups by;
the displayed icon is remapped Home→Truck at stops 2 and 3 (stored destination unchanged).

### Safety procedures

- **Five checklists**, one per stop's transition: `leave_home`, `leave_warehouse_go`,
  `leave_campsite`, `leave_warehouse_return`, and the terminal `arrive_home`. Each is a
  global, shared template (`procedures` collection); defaults are seeded once (only for ids
  with no doc yet, so edits are never overwritten). Default steps:
  - *Leaving home:* (empty — user-defined)
  - *Leaving the warehouse (GO):* battery connected, hitch pin + chains, lights & brakes,
    tire pressure, jack raised, mirrors.
  - *Leaving the campsite:* antenna down, stabilizers up, windows/vents closed, tanks
    emptied, propane closed, walk-around.
  - *Leaving the warehouse (heading home):* **battery disconnected**, trailer aligned,
    wheels chocked, propane closed, RV locked.
  - *Arriving home (final checks):* truck unloaded, fridge/cooler emptied, trailer locked.
- **Editing is global**, in two places: quick add/remove inside a stop's dialog, and the full
  editor at **Manage → Safety checklists** (one section per checklist, incl. *Arriving home*),
  with add, rename, delete (immediate, unconfirmed), and drag-and-drop reorder. Renaming/reordering
  preserves step identity, so per-trip check state is unaffected.
- **Per-trip check state** on the trip document, per procedure id, synced live and reset each
  trip. (The warehouse is visited twice via two distinct ids, each with its own state.)
- **Interrupt on advance/finish (blocking-ish).** Opening the dialog, advancing/finishing is
  enabled only once every step is checked; with steps pending the only way through is an
  explicit **Skip (N)**, which records the skipped step ids + timestamp. Advancing
  records who/when. Never a hard lock.
- **Home dashboard.** Once a trip is active (or moving), the Home trip card shows a "right
  now" line: current stop, the next/finish procedure, and its pending-check count.

## 21. Item reminders ("Remind me")

- **Flagging.** Any trip checklist item's `⋮` menu offers **Remind me**, which asks who the
  reminder is for: **Diogo**, **Alice**, or **Both of us**. The choice is stored on the item;
  re-opening the dialog shows the current choice and offers **Turn off reminder**.
- **Trip items only.** Supermarket items have no reminder flag — they are covered by the daily
  Supermarket digest (§15).
- **Delivery.** A scheduled function runs at **18:00 America/Toronto** daily. For every trip
  whose `startDate` is **tomorrow** (and which is neither `cancelled` nor `completed`), it
  sends each flagged recipient **exactly one push** — titled `Tomorrow: <trip title>`, its body
  listing that person's reminded item names. Tapping it opens the trip.
- **Unchecked only.** Items already checked off are omitted from the push. A person with no
  reminded items gets no push; a trip with no flags is silent.
- **One-shot.** Every flagged item on that trip has its reminder cleared once the run completes
  — including checked ones — so a reminder never fires twice and never carries into a later
  trip. Re-flag the item to be reminded again.
- **In-app reminder modal.** When the app is opened **1 or 2 days before** the next/active
  trip's `startDate` (§4's trip selection), a modal on Home lists that trip's **unchecked**
  reminded items. It is **per-identity**: only items addressed to the current identity (or to
  **Both of us**) are shown — never the other person's reminders. It appears **at most once per
  day** per trip and identity (remembered on the device), and not at all when the person has no
  reminded items.
- **"Don't remind me anymore".** The modal has a checkbox and a Close button. Closing with the
  box ticked opts **this identity** out of every item listed: a reminder addressed only to them
  is turned off, while a **Both of us** reminder is narrowed to the other person so that
  person's reminder survives. Closing without ticking it (or dismissing the modal) changes
  nothing.

---

### Glossary of checklist phases

| Phase       | Label                 | Status                          |
|-------------|-----------------------|---------------------------------|
| `other`     | "Bring to Truck"      | active                          |
| `grocery`   | Groceries (per store) | legacy — migrated into `other`  |
| `pre_early` | Before the trip       | legacy — migrated into `other`  |
| `pre_dayof` | Day of departure      | legacy — migrated into `other`  |
| `pack_down` | Pack down / return    | legacy — migrated into `other`  |

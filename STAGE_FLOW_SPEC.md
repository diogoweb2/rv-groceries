# Stage-driven trip flow — build spec

*Decided 2026-07-06. This is the source of truth for the current build. Supersedes the
four-phase model for the trip detail screen. BUSINESS_RULES.md is updated to match as the
code lands.*

## Decisions locked

- **Lists collapse to two kinds:** per-store **Groceries** lists + one **Other** list per
  trip. The four phase sections (Before the trip / Day of departure / Pack down / Groceries)
  are gone. Existing non-grocery items migrate into "Other".
- **Per-stop completion:** the same item is checked **independently at each stop**. Checking
  it at Home does not check it at the campsite. Each stop keeps its own set of "done" items.
- **Load-and-check at the first Home stop:** the Home departure stop is the packing pass —
  check each item as it goes into the truck.

## The route

Fixed 5 stops (already built as the stepper): index 0–4.

| # | Stop | What the screen shows |
|---|------|-----------------------|
| 0 | **Home (departure)** | All items (Groceries + Other) as a **load-into-truck** checklist. Check = it's in the truck. Then the *Leaving home* safety checklist to advance. |
| 1 | **Warehouse (GO)** | **Only the safety checklist.** No item list — moving food truck→RV here is obvious and needs no checks. |
| 2 | **Campsite** | On **leaving**: all items as a **stow** checklist — each goes to **RV** (dest RV) or **Truck** (dest Truck, and dest **Home shown as Truck** — can't go home without riding in the truck). Check = stowed. Items first, **then** the *Leaving campsite* safety checklist. |
| 3 | **Warehouse (return)** | Items that still need to be **in the RV or in the truck** and aren't done yet, **Home shown as Truck**. Check = placed. Items first, **then** the *Leaving warehouse (return)* safety checklist. |
| 4 | **Home (arrival)** | Only **destination-Home** items, as a **bring-inside** checklist. Check = it's in the house. Then the **final** safety checklist, then the **star rating** prompt (existing feature). |

Common rule: at stops **2 and 3**, an item whose destination is **Home** is displayed with
the **Truck** icon/label, because at those moments it must be in the truck to eventually get
home. Its stored destination stays Home.

## Data model

- **Checklist.phase** keeps only `grocery` and a new `other`. Migration: for each trip, all
  items in `pre_early` / `pre_dayof` / `pack_down` checklists move into a single **"Other"**
  (`other`) checklist; emptied old checklists (including the auto lists "Spmkt->Truck" and
  "Bringing back items") are removed.
- **ChecklistItem.stagesDone?: number[]** — stop indices at which the item has been checked.
  Replaces the single `checked` boolean as the driver of the stage views. (`checked` is kept
  for the Groceries/Supermarket "bought" sync, which is independent of stage handling.)
- **Item destination** (Home / Truck / RV) is unchanged and is what every stage view derives
  from. Set at add time; editable via the row icon.

## Retired mechanisms

- **§8 bought-grocery → "Spmkt->Truck" copy** and **§18 destination-Home → "Bringing back
  items" copy** are replaced by the derived stage views (a Home item simply appears at the
  arrival stop; a grocery simply appears in the load-truck stop). The dedicated auto-lists
  and the copy-on-check logic are removed.
- Grocery ↔ Supermarket **item sync stays** (buy/qty/delete propagation, camping flag) — it's
  about buying, not stages.

## Open / to verify after first look

- Stop 3 (warehouse return) exact filter — currently "any item not yet done for this stop
  that belongs in RV or truck." May be too broad vs. stop 2; refine once seen in the app.
- Whether pinned checklists (§13) and persistent items (§12), which key on phase + checklist
  name, should now key on the "Other" list. For now they target "Other".

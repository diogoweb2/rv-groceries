# Ideas: Trip Flow, Item Locations & Safety Checklists

*Draft for discussion — 2026-07-05. Not implemented; not yet part of BUSINESS_RULES.md.*

## The problem, restated

The app today models a trip as **4 static phases** (Before / Day of / Pack down / Groceries).
But the real trip is a **sequence of legs with transition points**, and the real question at
each point is: **"what should be where right now, and what must I do before moving on?"**

Diogo's actual flow:

```
GO:      Home ──truck──▶ RV warehouse ──(move stuff truck→RV, hitch)──▶ Campsite ──(unhitch, set up)
RETURN:  Campsite ──(hitch, move stuff RV↔truck)──▶ RV warehouse ──(unhitch, move stuff RV↔truck)──▶ Home ──(unload truck→home)
```

Two gaps:

1. **Location tracking.** An item isn't just "packed / not packed" — it lives somewhere
   (Home, Truck, RV, Campsite) and needs to *end up* somewhere at each stage. "Bring back"
   is a weak special case of this: it only knows "came on the trip → should come home",
   with no notion of *where* it is in between.
2. **Procedural safety checks.** Forgetting to disconnect the trailer battery or check
   trailer alignment isn't a packing problem — it's a **transition procedure** that must be
   forced in front of the user at the right moment (e.g. "leaving the warehouse", "arriving
   at warehouse on return").

---

## Idea 1 — Model the trip as a sequence of **Stops & Transitions** (the backbone)

Replace (or overlay on) the 4 fixed phases with an ordered timeline of **stops**:

```
Home → RV Warehouse → Campsite → RV Warehouse → Home
```

Each **transition** (arriving at / leaving a stop) is a *moment* the app understands. The
trip detail gets a **"Where am I?" stepper** at the top: you tap "I'm at the warehouse now"
/ "Leaving for campsite", and the app shows **only what matters at that moment**:

- the **move list** for this transition (Idea 2),
- the **safety procedure** for this transition (Idea 3),
- nothing else (other lists collapse).

This is the single biggest change: the app stops being a pile of lists and becomes a
**guided flow** — "you are here, here's what to check before you move on."

Default template (editable, remembered like phase ordering):
`Home → Warehouse → Campsite → Warehouse → Home`, with a transition at each arrow plus
"arrive" hooks (set-up at campsite, unload at home).

## Idea 2 — Items have a **final destination**, and checklists become **move lists**

*(Revised 2026-07-05 — Diogo's simplification, replacing the earlier "journey presets".)*

Every item gets exactly **one** user-facing property: its **final destination** —
**Home / Truck / RV** — answering "where does this thing *belong* when the trip is over?"

- Soccer ball → **Home** (comes camping, but must come back)
- Food → **Home** (can't be left in the RV; leftovers come home)
- RV tool → **RV** (lives there)
- Big battery → **Truck** (may get used in the RV mid-trip, but ends up in the truck)

That's the whole input: one tap of three buttons at add time, with the checklist's default
preselected so Enter skips it. No routes, no journey names — the route on the way *out* is
obvious (nobody forgets to bring the soccer ball they packed); the only thing people forget
is the way **back**, and destination captures exactly that.

A second property — **current location** — is tracked *silently*: an item added while
planning starts at Home; checking it on a move list advances it (Home → Truck → RV …).
The user never sets it directly.

From `destination` + `current location` the app **derives every list automatically**:

- *At home, before leaving:* everything currently at Home that's coming on the trip →
  **load into truck** (the classic "don't forget to bring it" check stays).
- *At warehouse (GO):* destination-RV items in the truck → "move truck → RV";
  destination-RV items already in the RV → "verify it's there".
- *At campsite pack-out & warehouse (RETURN):* everything in the RV whose destination is
  Home or Truck → "take out of the RV" — soccer ball, food leftovers, big battery.
  **This is the complete replacement for "bring it back."**
- *At home:* everything in the truck with destination Home → "unload".
- *End of trip:* anything not at its destination → the "did it make it home?" sweep.

The grocery auto-move ("Spmkt→Truck") becomes simply: bought grocery = destination Home,
current location Home → appears on the load list. A per-stop **inventory view** ("what's in
the truck right now?") falls out for free.

## Idea 3 — **Safety / procedure checklists** bound to transitions

A new checklist type: **procedure**. Unlike packing lists, procedures:

- are **attached to a transition** ("leaving warehouse (GO)", "arriving warehouse (RETURN)",
  "leaving campsite"), not to a phase section;
- are **recurring by definition** — the same steps every trip, seeded automatically
  (like pinned checklists but always-on and per-transition);
- **reset unchecked** each trip and each occurrence (the warehouse procedure runs twice:
  once GO, once RETURN — possibly with different steps each direction);
- can be **blocking-ish**: when you tap "Leaving warehouse" in the stepper with unchecked
  safety steps, the app interrupts with the procedure ("3 safety checks pending — Battery
  disconnected? Trailer aligned? Hitch locked?") before letting you advance. Never a hard
  lock (you're offline in a field), but you must explicitly "skip" — and skipping is logged.

Starter procedures from your incidents:

- **Arriving at warehouse (RETURN):** disconnect trailer battery ⚡, check trailer alignment,
  chock wheels, close propane, lock RV.
- **Leaving warehouse (GO):** connect battery, check tire pressure, lights/brake check,
  hitch pin + safety chains, raise jack, mirrors.
- **Leaving campsite:** antenna down, stabilizers up, windows/vents closed, tanks emptied,
  walk-around.

Optional: a **push reminder** the day after return — "Did you disconnect the trailer
battery?" — if that step was never checked (notifications pipeline already exists, §2).

## Idea 4 — Smaller supporting ideas

- **"Right now" home card.** The Home dashboard's trip card shows the current stop and the
  next transition's outstanding count ("At campsite · 4 items + 5 safety checks before you
  leave"), instead of only overall packing progress.
- **Timeline print mode.** Print-all reorganized by transition, in trip order — a paper
  run-sheet of the whole trip (builds on §19).
- **Post-trip "did it make it home?" sweep.** At the final "arrive home" transition, list
  every item whose current location ≠ Home; anything left over is flagged ("Lantern still
  marked as in RV — intentional?"). One tap marks it `Lives in RV` for next time — this is
  how the app *learns* what permanently lives where.
- **Incident → procedure loop.** In Bugs & ideas (§17), a "trip incident" kind ("battery
  went flat") with a one-tap "add as safety step to a transition", so every mistake becomes
  a permanent guard.

## Migration & scope

- The 4 phases map cleanly onto the timeline: *Before the trip* → prep at Home;
  *Day of departure* → the Home→Warehouse and Warehouse→Campsite transitions;
  *Pack down* → the return transitions; *Groceries* stays as-is (feeds the "Home → truck"
  load list, as "Spmkt→Truck" already does).
- **Suggested order of value:**
  1. **Idea 3 (safety procedures)** — highest pain (dead battery), smallest build: a
     recurring, transition-tagged checklist type + the interrupt prompt.
  2. **Idea 1 (stop/transition stepper)** — the navigation backbone.
  3. **Idea 2 (item destinations/locations)** — the deep fix, replacing "bring back".
  4. Idea 4 extras.

## Decisions (answered 2026-07-05)

- **Stops:** always the same 5 (`Home → Warehouse → Campsite → Warehouse → Home`). No
  per-trip template editor needed for v1.
- **Stepper:** manual advance only.
- **Item property = final destination (Diogo's idea, supersedes journey presets):** each
  item carries one user-set property — final destination **Home / Truck / RV** — chosen
  with one tap at add time (checklist default preselected; Enter skips). Current location
  is tracked silently and everything else is derived. See revised Idea 2.
- **View:** Diogo and Alice share the same view and the same stepper position.
- **Destination-Home pickup point:** no fixed stop — an item in the RV headed home appears
  on the "take out of the RV" list at **every** return transition (campsite pack-out and
  warehouse) until checked; grab it whenever is convenient.
- **Change destination anytime:** item menu → Change destination; move lists re-derive
  immediately (see Q&A below). No more complete-and-recreate.

---

## Adding an item — what you choose (Q&A, 2026-07-05)

**Q: When I add an item to bring to the truck (GO time), do I choose whether it stays in
the RV, stays in the truck, or goes back home?**

Yes — but it's a single tap of three buttons: **final destination Home / Truck / RV**
(see revised Idea 2). The checklist's default destination is preselected (e.g. "Load into
truck" defaults to **Home** — most things come back), so for typical items Enter skips
straight past. The **pin (bring every trip)** toggle stays, independent of destination.

The end-of-trip **"did it make it home?" sweep** is the safety net: a wrong/missed destination
gets fixed there with one tap, and the app remembers for future trips.

**Q: Sometimes I change my mind about where an item should stay. Today there's no way to
move an item — I have to check it off (or delete it) and re-create it elsewhere.**

Fix this with a first-class **"Change destination / move item"** action, available anytime:

- Every item row's menu (and the item edit sheet) gets **"Change destination"** — repick
  Home / Truck / RV at any point during the trip, not just at add time.
- Changing the destination **re-derives the move lists immediately**: the item disappears
  from transitions it no longer belongs to and appears (unchecked) where it now does. Its
  *current location* is never touched — only where it's headed. Already-checked moves stay
  checked (history is preserved).
- Since move lists are *derived* from destination + location, this also replaces "move item
  between checklists" for stage lists — no delete-and-recreate. For plain checklists, the
  same menu offers **"Move to another list"** as a straight transfer.
- Mid-trip examples: at the warehouse you decide the camp chairs should just live in the RV
  → Change destination → **RV**; they drop off every return list and next trip appear under
  "Verify — lives in RV". Or the reverse: an RV-resident item needs to come home for repair
  → destination **Home**, and it surfaces on the return move lists.

**Q: I'm still at home and remember something already in the RV that must come home after
the trip?**

Destination **Home**, current location **RV** — the case today's "bring it back" flag
fundamentally can't express, because the item is never packed (it's not with you):

1. At home, add "old propane hose" with destination **Home**, into an "In the RV" list
   (so its current location starts as RV instead of Home).
2. It stays silent for the entire GO leg — it's not travelling with you; it only shows in
   the RV inventory view.
3. On the RETURN it surfaces on the **Move — RV → Truck** list at **both** return
   transitions (campsite pack-out and warehouse) until checked, so you grab it wherever is
   convenient.
4. At home it's on the unload list; the "did it make it home?" sweep catches it if missed.

---

## Simulated trip — "Sandbanks, Aug 14–17" with the new flow

### T-5 days — planning (at home)

Diogo creates the trip. As today, pinned checklists and persistent items seed it — including
**"Awning LED strip"**, pinned (persistent) from last trip because he never found one to buy.
The trip page now shows a **timeline stepper** at the top:

```
● Home  →  ○ Warehouse  →  ○ Campsite  →  ○ Warehouse  →  ○ Home
   you are here
```

Only the **Home stage** content is expanded: the *Before the trip* prep lists, Groceries,
and the "Load into truck" move list. Warehouse/campsite lists exist but are collapsed —
nothing to do there yet.

### T-3 days — groceries (Supermarket, unchanged flow)

Alice builds the NoFrills list in **Supermarket** and flags camping stuff with the tent
toggle / `-> camping`: *burgers → camping, buns → camping, marshmallows → camping, milk* (home
only). The flagged items mirror into the trip's NoFrills grocery checklist (§8/§15), exactly
as today.

Diogo shops. He checks off burgers, buns, milk — each checked camping item auto-copies into
the **"Load into truck"** move list at the Home stage (today's "Spmkt→Truck", now just a
destination Home → shows on the load list). **Marshmallows are out of stock.** He long-presses the item →
**"Couldn't get — pin for next trip"**: the item stays unbought, gets the persist pin (§12),
and will reappear automatically on the next trip's grocery list. When he completes the list,
Alice's notification reads: *"Diogo finished the NoFrills list. Couldn't get: marshmallows
(pinned for next trip)."*

### Day 0 — leaving home

Diogo opens the trip; stepper says **Home**. One screen: the **"Load into truck"** list —
camp chairs, cooler, burgers, buns, tools, plus **"Awning LED strip"** still unchecked. He
loads the truck, checking items as they go in; each check moves the item's location to
**Truck**. The LED strip he still doesn't have — he leaves it unchecked (it stays pinned, so
it carries to the next trip automatically).

He taps **"Leaving home →"**. The app: *"1 item not loaded: Awning LED strip."* He taps
**Skip** (logged). Stepper advances to **Warehouse**.

### At the warehouse (GO)

The screen now shows exactly two things:

1. **Move list — Truck → RV:** burgers, buns, camp chairs, bedding. Checking each one
   moves its location to **RV**. Cooler and tools stay in the truck (destination
   **Truck** — they never appear on this list).
2. **Verify — Lives in RV:** levelling blocks, hoses, BBQ. Quick confirm-taps.

He hitches up and taps **"Leaving warehouse →"**. The **safety procedure** interrupts:

> ⚠️ Before you go:
> ☐ Trailer battery connected
> ☐ Hitch pin + safety chains
> ☐ Lights & brake check
> ☐ Jack raised
> ☐ Trailer aligned on hitch

He checks all five. Stepper advances to **Campsite**. If Alice opens the app in the
passenger seat, she sees the same position and can check items too.

### At the campsite

Arrival shows the **set-up procedure** (chock wheels, stabilizers down, propane on…).
During the stay, the trip card on Home reads: *"At Campsite · next: leaving — 3 moves +
6 safety checks."* Mid-trip he can ask the inventory view "what's in the truck?" — it
answers: cooler, tools.

On the last morning he taps **"Leaving campsite →"**: the app shows the **pack-out move
list** — every item currently in the RV whose destination is Home or Truck (camp
chairs, bedding, cooler) — plus the departure procedure (antenna down, stabilizers up,
windows closed, tanks emptied, walk-around). This replaces today's "Bringing back items"
list, but it's generated from item locations instead of a one-off flag.

### At the warehouse (RETURN)

Two lists again:

1. **Move — RV → Truck:** bedding (goes home to wash), cooler leftovers, camp chairs.
2. **Stays in RV:** BBQ, hoses, levelling blocks — verify and leave.

He taps **"Leaving warehouse →"**. The safety interrupt — the one that would have saved
last week's battery:

> ⚠️ Before you go:
> ☐ **Trailer battery disconnected**
> ☐ Propane closed
> ☐ Wheels chocked
> ☐ Trailer aligned in its spot
> ☐ RV locked

### Arriving home

Final stage: **unload truck → home** (bedding, cooler, tools). Then the **"did it make it
home?" sweep**: the app lists anything not at its final destination — *"Camp chairs still marked as in Truck — did you unload them?"* He confirms they're
staying in the truck permanently → one tap changes their destination to **Truck** for all
future trips. Trip complete; rating prompt as today.

### Next morning (safety net)

No push arrives — the battery-disconnect step was checked. Had he skipped that procedure,
at 9am he'd get: *"⚡ Sandbanks trip: 'Trailer battery disconnected' was never checked."*

### Next trip is created

Seeded automatically with: all pinned checklists, **marshmallows** (pinned at the store) on
the NoFrills grocery list, and **"Awning LED strip"** (still unchecked/persistent) on the
load list. Nothing to remember by hand.

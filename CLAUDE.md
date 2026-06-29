# Project Instructions for Claude

## Business rules — READ AND MAINTAIN

[BUSINESS_RULES.md](BUSINESS_RULES.md) is the source of truth for this app's product/business
behavior. You **must**:

1. **Read it before** implementing, changing, or reasoning about any feature, flow, or rule —
   it defines the intended behavior (auth, trips, checklists, items, autocomplete catalog,
   grocery→RV auto-move, disabled features, data-integrity rules, etc.).
2. **Update it in the same change** whenever your work adds, removes, or alters a business rule.
   Treat the doc edit as part of the task, not an afterthought — a code change that affects
   behavior is not complete until BUSINESS_RULES.md reflects it.
3. **Flag conflicts.** If a request contradicts an existing rule, point out the conflict and
   confirm before proceeding, then update the doc to match the decision.
4. Keep it accurate to what the code actually does. If you discover the doc and code disagree,
   surface it rather than silently trusting either one.

Keep entries behavior-focused (rules, not code structure) and update the relevant numbered
section rather than appending duplicates.

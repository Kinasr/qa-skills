# Deferred functionality in a full inventory

An inventory entry the engineer chooses to leave for later is proposed as **Deferred
functionality**. It still belongs to this Feature, but its walk has not happened. Defer only a
whole functionality, and walk every part of one this run takes on. Finer deliberate deferral is
unsupported: it becomes neither a Parked question (an answer the engineer lacks) nor a Boundary
(behaviour handed elsewhere).

## Focus

With repeatable `--focus "<verb phrase>"`, read the References in full as usual. Only the focused
functionalities get full inventory entries. Every other functionality gets one line: its verb
phrase and Reference place, proposed as Deferred with the reason "outside this run's focus".
Confirm those proposals in one go. Every functionality in the References stays accounted for.

If a focus matches nothing, propose the closest functionality and ask before walking it. With no
support for the requested functionality in the References, stop and ask for a Reference that has
it. On an existing Feature, apply the re-run reference's pick-up and amendment routing first.

In a focused full inventory, retain existing Rules and the other deferred items in the light
pass; show them with the proposals. The engineer still settles every existing deferred item's
placement. Without `--focus`, build the full entries as usual.

## Reconcile every existing item

Read the existing list from `deep-dive feature`'s `deferred_functionality`.

Every full inventory, on a new or existing Feature, places every deferred item in one of four
ways:

- **Retained:** still belongs here, with its reason and Reference kept.
- **Walked:** this run accounts for its whole walk, then clears it.
- **Dropped:** a duplicate or misreading, with the reason shown.
- **Boundary:** the engineer confirms that the functionality belongs elsewhere; replace the item
  with that Boundary under the scope decisions reference's rules.

One overlapping Rule never clears an item. "Don't want to cover it" is not a drop reason; retain
it as Deferred. Reconcile overlap with Rules, Boundaries or other Features semantically with the
engineer. `deep-dive check` validates syntax and sources only; it raises no overlap error or
Finding. Clear an item only once its whole walk or another confirmed disposition is accounted
for. Amendment mode keeps and shows the list without reconciling it.

## Write and state Coverage

Keep deferred entries visible as Deferred; plan and walk the active functionalities only. Write
confirmed deferred items under `## Deferred` using the Feature file format, omitting an empty
section. They have no keys and claim no behaviour.

Coverage speaks for walked functionalities only. Whenever stating Coverage, say that limit and
give `deferred: <n>`, including zero. Deferred items never change a category's disposition and
never make one `awaiting`; that state still requires a tagged Parked question. Changes to the
list affect `coverage_digest`, while `/qa-next`'s per-item reminders remain even after Coverage
is current. The reminders route to `/qa-deep-dive <feature key> <the item's Reference URI>`.

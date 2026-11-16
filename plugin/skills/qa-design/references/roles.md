# Role review after filling

Check each listed Role against the steps of every case this Run wrote, and check every role-less
case against its preconditions and steps. A case is already in the working tree and unkept, so its
correction waits for the engineer.

- A Role in `roles` must act in a step: flag one that no step uses. Read a step as that Role's only
  when its action needs that actor. A Role needed only for setup belongs on the precondition, not in
  `roles`; with no acting Role, `roles` is empty.
- Flag a precondition that needs a signed-in user on a case with no Role: its session would open
  without the account the case names. A role-less case otherwise stays the default account.
- When the project has a Signed-out Role, a case about a signed-out visitor lists it; its session
  opens signed out, so the case needs neither a sign-in nor a sign-out step. A Signed-out Role is one
  whose Access note logs in as nobody (`via: none` in `.qa/train/access.md`). Use only a Role the
  project declares: with no Signed-out Role, a case cannot open signed out.
- Flag a role-less case whose precondition or steps need a signed-out session (its session would
  open as the default account instead of signed out). Check `.qa/train/access.md` for a `via: none`
  Access note:
  - With a Signed-out Role declared, propose adding that Signed-out Role to the case's `roles` (and
    removing any sign-out step).
  - With no Signed-out Role declared, propose creating one with a distinct Role name (such as
    `Visitor`, never a Role that signs in), naming `/qa-init --add-role <Name>` and
    `/qa-train access` (for its `via: none` Access note), then adding that Role to the case.
- When a case needs both a signed-out visitor and a signed-in Role together, propose listing both
  Roles in `roles` (with each step opened `As <Role>, `), using the declared Signed-out Role or
  proposing to create one as above.

Show each flag as a proposal, naming the case Key, the Role and the correction you propose. Change a
case's Roles only when the engineer asks; never rewrite a case silently.

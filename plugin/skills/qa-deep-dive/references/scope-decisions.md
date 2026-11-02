# Scope decisions while grilling

Use the `feature` output's `boundaries` and Rule `waiver` fields as the current scope record.

## Boundary

When the engineer says behaviour does not belong to this Feature, settle what owns it: name an
existing Feature key, or use `none` when it belongs to no Feature. Write a Boundary under
`## Boundaries` with `### boundary_<key>: <statement>` and `Owner: <feature_key | none>` as its first
non-blank line. Mint the key with `mint boundary --feature <slug>`. Keep existing keys unchanged;
put a withdrawn key in `retired:` and never reuse it.

## Waiver

Keep the behaviour as a Rule when the engineer deliberately leaves it without a Test Case. Record
their reason as `Waived: <reason>` in the Rule's field block, at its first non-blank line. The
Waiver does not change the Rule's claim.

## Existing Boundary crossing

Judge a possible crossing by the behaviour the Rule claims, not a passing mention of excluded
behaviour. Before adding or editing a Rule that claims behaviour a Boundary hands elsewhere, quote
the Boundary and ask the engineer whether the Rule should be included in this Feature despite that
Boundary. Write that Rule only after an explicit yes. Otherwise leave it out of this Feature; record
or update the Boundary if the engineer states its scope or owner differently.

A Waiver does not excuse a Rule from this scope check. It gives up a Test Case, not ownership of the
behaviour.

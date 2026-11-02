# Labels in a design run

A Test Case carries Tags and Custom fields beside its claim. They say how a case is used, never what
it claims, so the Delegate may leave them out and a wrong one costs the case nothing.

- **The brief lists only what a Delegate may assign**: the Tags that have a meaning, and each Custom
  field with its description and its allowed (not retired) values. A Delegate leaves a label out
  when unsure.
- **Labels are checked apart from the claim.** A label that is unknown, retired, a Tag with no
  meaning, or in the wrong shape is dropped from the case and reported in `dropped_labels` with the
  case, the field, the value and a `line`. A dropped label is never a reason to reject the reply or
  the case: word each and say the case was written without it.
- **Label definitions are part of the agreement's basis.** A changed Tag meaning, a new or retired
  value or a changed Custom field makes a recorded agreement stale: agree again.
- **`--regenerate` keeps the labels the engineer set.** A replaced case lends its Tags and
  Custom-field values to the regenerated case that covers the same Rules; the Delegate may add
  labels and never removes one. A replaced case no regenerated case matches by Rules takes its
  labels with it. Report each such label from `lost_labels` with its
  replaced `key`, `field`, `value` and `line`; a retired Tag or value is never given to a new case.
- **A missing required Custom field is no failure.** The case is unclassified, and `/qa-next` names
  it as a step.

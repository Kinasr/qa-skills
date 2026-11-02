# Coverage categories

A **Coverage category** is a kind of behaviour every Feature is checked for: the happy path,
permissions, input validation. The ten-category floor is shared by every project and never shortens;
a team adds the kinds it tests in `train/categories.md`. The deep dive and design resolve the floor
and the extensions into one effective walk order.

## Read the file

Run `evidence categories`. Its `train.categories` lists the extensions in walk order, each a `key`,
`name`, `meaning` and `after` anchor, and `train.retired` lists the keys never to reuse. Read
`.qa/train/categories.md` as it stands when you draft the whole file.

## Derive proposals

A new entry has:

- a **key** in kebab case, unique across the floor and every extension, and never a retired key;
- a **name** and a one-line **meaning** that say what kind of behaviour it covers;
- an **`after:` anchor**: a floor key or an earlier extension. Extensions sharing an anchor keep
  their file order.

The engineer adds a category their team tests. A proposal to change an existing key's name or
meaning is refused: meanings are immutable. The route is retire and add.

## The gate

A category names a kind of behaviour, never a screen, endpoint, component, role or other part of
the system under test. "Accessibility", "performance" and "localisation" pass; "checkout page",
"ISBN column" and "Admin dashboard" fail. If the proposal needs a system name to make sense, refuse
it and ask for the kind of behaviour behind it. The same idea as the Statability Test, read on the
key, name and meaning.

At the gate, show each proposal and each removal with the effect the check reports. A `statability`
hit on an added or edited entry is a refusal; on an unchanged entry it is a coherence finding to
put to the engineer.

## Removal

Removing an entry moves its key into the file's `retired:` list in the same draft. A retired key is
never reused, and the check refuses an entry that reuses one. Removing an extension that another
live entry is anchored to is refused, with the dependent key named: remove or retire that dependent
first. A category's key and meaning are never edited in place.

## Draft, check, write

Draft the whole file:

````markdown
---
type: train
key: categories
retired: [old-key]
---

# Categories

### accessibility: Accessibility

```yaml
meaning: Screen reader, keyboard and contrast behaviour.
after: permissions
```
````

Pipe it into `train check categories --stdin`:

- **`ok: false`**: fix every `errors` entry and check again. A changed meaning says to retire the
  key and add a new one; a removal without its key in `retired:` says to add it.
- **`statability`**: settle each as the gate above says.
- **`ok: true`** and nothing left unsettled: write the draft, byte for byte, to `path`.

The check's `categories` lists the keys added, edited and removed and its `effective` list is the
walk order the change produces. Close with the added keys, the retired keys, the `changeset` and
the suggested `commit`.

This file is shared information: it is never a command in Training status, and its absence is
never a Next step.

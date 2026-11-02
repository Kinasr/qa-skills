// @ts-check
// Label operations stay separate from claims, and copies come only from confirmed observations.
/** @import { LabelDefinitions, LabelProblem } from "./case-labels.mjs" */
import { labelDefinitions } from "./case-labels.mjs";
import { isMap } from "./dialect.mjs";
import { LEVEL_ON_CASE_SCHEMA_VERSION } from "./schema.mjs";

/**
 * @param {number} schemaVersion
 * @returns {boolean}
 */
export const canPublishLabels = (schemaVersion) => schemaVersion >= LEVEL_ON_CASE_SCHEMA_VERSION;

/**
 * @typedef {string | string[] | null} LabelValue
 * @typedef {{ mirror?: { tags?: string[] | null, tags_target?: string | null }, mirror_fields?: Record<string, LabelValue>, mirror_field_targets?: Record<string, string> }} LabelCopies
 * @typedef {{ id: string, kind: "tags" | "custom_field", name: string, destination: string, cardinality: "single" | "multiple", operation: "replace" | "delta", desired: LabelValue, clear: boolean, managed?: string[], known: boolean, copy: LabelValue }} PublishedLabel
 * @typedef {Omit<PublishedLabel, "known" | "copy"> & { field: string }} LabelOperation
 * @typedef {{ name: string, cardinality: "single" | "multiple" }} LabelDestinationRequest
 * @typedef {{ name: string, fields: Array<{ id: string, cardinality: "single" | "multiple" }> }} LabelDestination
 * @typedef {{ id: string, kind: "tags", destination: string, value: string[] } | { id: string, kind: "custom_field", destination: string, value: LabelValue }} ConfirmedLabel
 */

/** @type {readonly string[]} */
export const BUILTIN_DESTINATIONS = ["summary", "preconditions", "steps", "expected", "expected result", "roles", "level", "scenario", "test scenario", "status", "issue type", "issue_type", "automation status", "auto_status"];

/**
 * A destination name with case and separators removed, so `Issue Type` and `issue_type` agree.
 * @param {string} name
 * @returns {string}
 */
const destinationKey = (name) => name.toLowerCase().replace(/[\s_-]+/g, "");

/**
 * Whether a destination name is one of the built-in publish destinations.
 * @param {string} name
 * @returns {boolean}
 */
export const isBuiltinDestination = (name) => BUILTIN_DESTINATIONS.some((builtin) => destinationKey(builtin) === destinationKey(name));

/**
 * @param {unknown} value
 * @returns {string[]}
 */
const tagSet = (value) => [...new Set(/** @type {string[]} */ (value ?? []))].sort();

/**
 * The Tag names publish manages: active and retired, sorted.
 * @param {LabelDefinitions} definitions
 * @returns {string[]}
 */
export const managedTags = (definitions) => tagSet([...Object.keys(definitions.tags), ...definitions.retiredTags]);

/**
 * Whether the project declares any Tags at all, active or retired.
 * @param {LabelDefinitions} definitions
 * @returns {boolean}
 */
export const declaresTags = (definitions) => Object.keys(definitions.tags).length > 0 || definitions.retiredTags.length > 0;

/**
 * A single-valued copy: an empty or non-string value is null.
 * @param {unknown} value
 * @returns {LabelValue}
 */
export const singleLabelValue = (value) => (typeof value === "string" && value ? value : null);

/**
 * @param {{ tag_field?: string }} mapping
 * @returns {mapping is { tag_field: string }}
 */
export const hasPublishTags = (mapping) => Boolean(mapping.tag_field);

/**
 * Destinations to fetch, including the Custom field metadata used by Custom field publishing.
 * @param {LabelDefinitions} definitions
 * @param {{ tag_field?: string }} mapping
 * @returns {LabelDestinationRequest[]}
 */
export function configuredLabelDestinations(definitions, mapping) {
  return [...(hasPublishTags(mapping) ? [{ name: mapping.tag_field, cardinality: /** @type {const} */ ("multiple") }] : []),
    ...definitions.customFields.filter((f) => f.tracker_field !== undefined).map((f) => ({ name: /** @type {string} */ (f.tracker_field), cardinality: f.multiple ? /** @type {const} */ ("multiple") : /** @type {const} */ ("single") })),
  ];
}

/**
 * The configured-label projection. Presence is independent of the normalized value.
 * @param {Record<string, unknown>} data
 * @param {LabelDefinitions} definitions
 * @param {{ tag_field?: string }} mapping
 * @returns {PublishedLabel[]}
 */
export function publishedLabels(data, definitions, mapping) {
  const custom = customPublishedLabels(data, definitions);
  if (!hasPublishTags(mapping) || !declaresTags(definitions)) return custom;
  const mirror = /** @type {LabelCopies["mirror"]} */ (data.mirror);
  const desired = tagSet(data.tags);
  return [{ id: "label:tags", kind: "tags", name: "Tags", destination: mapping.tag_field,
    cardinality: "multiple", operation: mapping.tag_field === "labels" ? "delta" : "replace",
    desired, clear: !desired.length,
    ...(mapping.tag_field === "labels" && { managed: managedTags(definitions) }),
    known: mirror != null && Object.hasOwn(mirror, "tags") && mirror.tags_target === mapping.tag_field,
    copy: tagSet(mirror?.tags),
  }, ...custom];
}

/**
 * The configured Custom field projection: one replace row per mapped field.
 * @param {Record<string, unknown>} data
 * @param {LabelDefinitions} definitions
 * @returns {PublishedLabel[]}
 */
function customPublishedLabels(data, definitions) {
  const copies = isMap(data.mirror_fields) ? data.mirror_fields : {};
  const targets = isMap(data.mirror_field_targets) ? data.mirror_field_targets : {};
  return definitions.customFields.flatMap((field) => {
    if (field.tracker_field === undefined) return [];
    const normalize = (/** @type {unknown} */ value) => field.multiple ? tagSet(value) : singleLabelValue(value);
    const desired = normalize(data[field.name]);
    return [{ id: `label:field:${field.name}`, kind: /** @type {const} */ ("custom_field"), name: field.name,
      destination: field.tracker_field, cardinality: field.multiple ? /** @type {const} */ ("multiple") : /** @type {const} */ ("single"),
      operation: /** @type {const} */ ("replace"), desired, clear: desired === null || (Array.isArray(desired) && desired.length === 0),
      known: Object.hasOwn(copies, field.name) && targets[field.name] === field.tracker_field, copy: normalize(copies[field.name]) }];
  });
}

/**
 * @param {PublishedLabel[]} labels
 * @returns {boolean}
 */
export const labelsDiffer = (labels) => labels.some((label) => !label.known || !sameLabelValue(label.cardinality, label.desired, label.copy));

/**
 * @param {"single" | "multiple"} cardinality
 * @param {LabelValue} a
 * @param {LabelValue} b
 * @returns {boolean}
 */
export function sameLabelValue(cardinality, a, b) {
  if (cardinality === "multiple") return JSON.stringify(tagSet(a)) === JSON.stringify(tagSet(b));
  const scalar = (/** @type {LabelValue} */ value) => Array.isArray(value) && !value.length ? null : value ?? null;
  return scalar(a) === scalar(b);
}

/**
 * Resolve identities before displaying a Card; the Publisher receives no ambiguous field name.
 * @param {PublishedLabel[]} labels
 * @param {LabelDestination[]} destinations
 * @param {Record<string, unknown>} mapping
 * @returns {{ labels: LabelOperation[], problems: string[] }}
 */
export function resolveLabelDestinations(labels, destinations, mapping) {
  /** @type {LabelOperation[]} */
  const operations = [];
  /** @type {string[]} */
  const problems = [];
  const used = new Set([...BUILTIN_DESTINATIONS, mapping.marker_field]);
  for (const label of labels) {
    const fields = label.destination === "labels" ? [{ id: "labels", cardinality: "multiple" }] : Array.isArray(destinations) ? destinations.filter((d) => isMap(d) && d.name === label.destination).flatMap((d) => Array.isArray(d.fields) ? d.fields : []) : [];
    const field = fields[0];
    if (fields.length !== 1 || !isMap(field) || typeof field.id !== "string" || !field.id.trim() || field.cardinality !== label.cardinality || used.has(field.id) || (field.id === "labels" && label.destination !== "labels")) {
      problems.push(`${label.destination}: needs one distinct ${label.cardinality}-value tracker field`);
      continue;
    }
    used.add(field.id);
    const { known, copy, ...operation } = label;
    operations.push({ ...operation, field: field.id });
  }
  return { labels: operations, problems };
}

/**
 * @param {LabelOperation[]} operations
 * @param {ConfirmedLabel[] | undefined} confirmed
 * @returns {boolean}
 */
export function confirmedLabelsMatch(operations, confirmed) {
  return Array.isArray(confirmed) && confirmed.length === operations.length && new Set(confirmed.map((c) => c?.id)).size === confirmed.length && operations.every((op) => {
    const value = confirmed.find((c) => c?.id === op.id);
    return value !== undefined && value.kind === op.kind && value.destination === op.destination &&
      (op.cardinality === "multiple" ? Array.isArray(value.value) && value.value.every((v) => typeof v === "string") : value.value === null || typeof value.value === "string") &&
      sameLabelValue(op.cardinality, value.value, op.desired);
  });
}

/**
 * @param {LabelOperation[]} operations
 * @param {ConfirmedLabel[]} confirmed
 * @returns {LabelCopies}
 */
export function confirmedLabelCopies(operations, confirmed) {
  const tags = confirmed.find((c) => c.kind === "tags");
  return { ...(tags && { mirror: { tags: /** @type {string[]} */ (tags.value), tags_target: tags.destination } }), ...confirmedCustomCopies(operations, confirmed) };
}

/**
 * Copies for mapped Custom fields, only from confirmed values.
 * @param {LabelOperation[]} operations
 * @param {ConfirmedLabel[]} confirmed
 * @returns {LabelCopies}
 */
function confirmedCustomCopies(operations, confirmed) {
  /** @type {Record<string, LabelValue>} */
  const mirror_fields = {};
  /** @type {Record<string, string>} */
  const mirror_field_targets = {};
  for (const operation of operations) {
    if (operation.kind !== "custom_field") continue;
    const result = confirmed.find((c) => c.id === operation.id && c.kind === "custom_field" && c.destination === operation.destination);
    if (!result) continue;
    mirror_fields[operation.name] = result.value;
    mirror_field_targets[operation.name] = result.destination;
  }
  return Object.keys(mirror_fields).length ? { mirror_fields, mirror_field_targets } : {};
}

/**
 * The copies for the labels the tracker actually held, as recovered after a crash.
 * @param {Record<string, unknown>} data
 * @param {LabelDefinitions} definitions
 * @param {{ tag_field?: string }} mapping
 * @returns {LabelCopies}
 */
export function recoveredLabelCopies(data, definitions, mapping) {
  /** @type {LabelCopies} */
  const copies = {};
  const observations = /** @type {ConfirmedLabel[]} */ (data.label_values ?? []);
  if (hasPublishTags(mapping)) {
    const observation = observations.find((v) => v.id === "label:tags" && v.kind === "tags" && v.destination === mapping.tag_field);
    const actual = mapping.tag_field === "labels" && Array.isArray(data.labels) ? data.labels : observation?.value;
    if (actual !== undefined) {
      const managed = new Set(managedTags(definitions));
      const tags = tagSet(actual);
      copies.mirror = { tags: mapping.tag_field === "labels" ? tags.filter((v) => managed.has(v)) : tags, tags_target: mapping.tag_field };
    }
  }
  for (const field of definitions.customFields) {
    if (field.tracker_field === undefined) continue;
    const observation = observations.find((v) => v.id === `label:field:${field.name}` && v.kind === "custom_field" && v.destination === field.tracker_field);
    if (observation === undefined) continue;
    const value = field.multiple ? tagSet(observation.value) : singleLabelValue(observation.value);
    (copies.mirror_fields ??= {})[field.name] = value;
    (copies.mirror_field_targets ??= {})[field.name] = field.tracker_field;
  }
  return copies;
}

/**
 * @param {Record<string, unknown>} data
 * @returns {LabelProblem[]}
 */
export function publishDestinationProblems(data) {
  const mapping = isMap(data.tracker) ? data.tracker : {};
  const { tags, retiredTags: retired } = labelDefinitions(data);
  /** @type {LabelProblem[]} */
  const problems = [];
  if (mapping.marker_label !== undefined && (Object.hasOwn(tags, /** @type {string} */ (mapping.marker_label)) || retired.includes(/** @type {string} */ (mapping.marker_label)))) problems.push({ code: "invalid", field: "tracker.marker_label", message: "`tracker.marker_label` collides with an active or retired Tag" });
  if (mapping.tag_field !== undefined && (mapping.tag_field === mapping.marker_field || (typeof mapping.tag_field === "string" && isBuiltinDestination(mapping.tag_field)))) problems.push({ code: "invalid", field: "tracker.tag_field", message: "`tracker.tag_field` collides with the marker field or a built-in publish destination" });
  return [...problems, ...customDestinationProblems(data)];
}

/**
 * Custom field destinations must avoid every other publish destination.
 * @param {Record<string, unknown>} data
 * @returns {LabelProblem[]}
 */
function customDestinationProblems(data) {
  const mapping = isMap(data.tracker) ? data.tracker : {};
  const fields = labelDefinitions(data).customFields;
  return fields.flatMap((field) => {
    const destination = field.tracker_field;
    if (destination === undefined) return [];
    const collisions = ["labels", mapping.marker_field, mapping.tag_field];
    const builtin = typeof destination === "string" && isBuiltinDestination(destination);
    if (!collisions.includes(destination) && !builtin && !fields.some((other) => other !== field && other.tracker_field === destination)) return [];
    return [{ code: /** @type {const} */ ("invalid"), field: `custom_fields.${field.name}`, message: `Custom field ${field.name} tracker_field collides with another publish destination` }];
  });
}

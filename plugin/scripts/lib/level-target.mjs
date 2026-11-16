// @ts-check
// Shared Level target resolver (ADR-0068): maps planned Test levels to configured Targets,
// distinguishing explicit `level_targets` entries from the first-target default.

/**
 * Target slug and origin resolved for a Test level or Run.
 * @typedef {{
 *   slug: string,
 *   origin: string,
 * }} TargetSpec
 */

/**
 * One Test level's resolved Target and whether `level_targets` stated it explicitly.
 * @typedef {{
 *   level: string,
 *   target: TargetSpec,
 *   mapped: boolean,
 * }} LevelTargetEntry
 */

/**
 * Planned levels grouped by resolved Target in `targets` order.
 * @typedef {{
 *   target: TargetSpec,
 *   levels: string[],
 * }} TargetGroup
 */

/**
 * Full Level target resolution for a selection's planned levels.
 * @typedef {{
 *   overridden: boolean,
 *   defaultTarget: TargetSpec,
 *   entries: LevelTargetEntry[],
 *   byLevel: Map<string, LevelTargetEntry>,
 *   unmapped: string[],
 *   groups: TargetGroup[],
 *   singleTarget: TargetSpec | null,
 * }} LevelTargetResolution
 */

/**
 * @param {{
 *   targets: Record<string, string>,
 *   levelTargets?: Record<string, string>,
 *   levels: readonly string[],
 *   explicitTarget?: string,
 * }} options
 * @returns {LevelTargetResolution}
 */
export function resolveLevelTargets({ targets, levelTargets, levels, explicitTarget }) {
  const targetOrder = Object.keys(targets);
  const defaultSlug = targetOrder[0];
  /** @type {TargetSpec} */
  const defaultTarget = { slug: defaultSlug, origin: targets[defaultSlug] };
  const uniqueLevels = [...new Set(levels)];

  if (explicitTarget !== undefined) {
    /** @type {TargetSpec} */
    const override = { slug: explicitTarget, origin: targets[explicitTarget] };
    /** @type {LevelTargetEntry[]} */
    const entries = uniqueLevels.map((level) => ({ level, target: override, mapped: true }));
    return {
      overridden: true,
      defaultTarget,
      entries,
      byLevel: new Map(entries.map((entry) => [entry.level, entry])),
      unmapped: [],
      groups: [{ target: override, levels: uniqueLevels }],
      singleTarget: override,
    };
  }

  /** @type {LevelTargetEntry[]} */
  const entries = uniqueLevels.map((level) => {
    const mappedSlug = levelTargets && Object.hasOwn(levelTargets, level) ? levelTargets[level] : undefined;
    const mapped = typeof mappedSlug === "string" && Object.hasOwn(targets, mappedSlug);
    const slug = mapped ? /** @type {string} */ (mappedSlug) : defaultSlug;
    return { level, target: { slug, origin: targets[slug] }, mapped };
  });

  /** @type {Map<string, string[]>} */
  const bySlug = new Map();
  for (const entry of entries) {
    const list = bySlug.get(entry.target.slug) ?? [];
    list.push(entry.level);
    bySlug.set(entry.target.slug, list);
  }

  /** @type {TargetGroup[]} */
  const groups = targetOrder
    .filter((slug) => bySlug.has(slug))
    .map((slug) => ({
      target: { slug, origin: targets[slug] },
      levels: /** @type {string[]} */ (bySlug.get(slug)),
    }));

  return {
    overridden: false,
    defaultTarget,
    entries,
    byLevel: new Map(entries.map((entry) => [entry.level, entry])),
    unmapped: entries.filter((entry) => !entry.mapped).map((entry) => entry.level),
    groups,
    singleTarget: groups.length === 0 ? defaultTarget : groups.length === 1 ? groups[0].target : null,
  };
}

/**
 * Data carried on an `unmapped_levels` refusal.
 * @typedef {{
 *   levels: string[],
 *   planned_levels: string[],
 *   targets: string[],
 *   suggested_line: string,
 * }} UnmappedLevelsData
 */

/**
 * Whether the Level target resolution spans more than one Target.
 * @param {LevelTargetResolution} resolution
 * @returns {boolean}
 */
export function spansMultipleTargets(resolution) {
  return resolution.groups.length > 1;
}

/**
 * Whether an unmapped multi-target split must refuse (`unmapped_levels`): no explicit `target:`,
 * more than one configured target, more than one planned Test level, at least one planned level
 * resolved only by the first-target default, and either the planned levels resolve to more than
 * one target or none of the planned levels is mapped.
 * @param {LevelTargetResolution} resolution
 * @param {Record<string, string>} targets
 * @returns {boolean}
 */
export function hasUnmappedSplit(resolution, targets) {
  return !resolution.overridden &&
    Object.keys(targets).length > 1 &&
    resolution.entries.length > 1 &&
    resolution.unmapped.length > 0 &&
    (spansMultipleTargets(resolution) || resolution.unmapped.length === resolution.entries.length);
}

/**
 * Default refusal lines shared by commands that enforce Level target resolution.
 * @type {{ unmapped_levels: string, spanning_targets: string }}
 */
export const LEVEL_TARGET_REFUSALS = {
  unmapped_levels: "Add `level_targets` to `.qa/project.md` so every planned Test level names its Target.",
  spanning_targets: "The selection spans multiple Level targets; run one command per target.",
};

/**
 * Formats the refusal `line` for `unmapped_levels` or `spanning_targets` from its structured
 * fields, or returns `null` when `code` or its fields do not match.
 * @param {string} code
 * @param {Record<string, unknown>} data
 * @returns {string | null}
 */
export function levelTargetRefusalLine(code, data) {
  if (code === "unmapped_levels" && Array.isArray(data.levels) && Array.isArray(data.targets) && typeof data.suggested_line === "string") {
    return `Planned levels (${data.levels.join(", ")}) have no \`level_targets\` entry among targets (${data.targets.join(", ")}). Add to \`.qa/project.md\`: ${data.suggested_line} (or pass \`target:<slug>\`).`;
  }
  if (code === "spanning_targets" && Array.isArray(data.targets) && Array.isArray(data.commands)) {
    const cmds = /** @type {Array<{ command: string }>} */ (data.commands);
    return `Selection spans multiple Level targets (${data.targets.join(", ")}). Run one command per target:\n${cmds.map((c) => `  ${c.command}`).join("\n")}`;
  }
  return null;
}

/**
 * Builds the structured fields and suggested `level_targets` line for `unmapped_levels`.
 * @param {LevelTargetResolution} resolution
 * @param {Record<string, string>} targets
 * @param {Record<string, string>} [levelTargets]
 * @returns {UnmappedLevelsData}
 */
export function unmappedLevelsData(resolution, targets, levelTargets = {}) {
  const existing = Object.entries(levelTargets).map(([level, target]) => `${level}: ${target}`);
  const missing = resolution.unmapped.map((level) => `${level}: <target>`);
  return {
    levels: resolution.unmapped,
    planned_levels: resolution.entries.map((entry) => entry.level),
    targets: Object.keys(targets),
    suggested_line: `level_targets: {${[...existing, ...missing].join(", ")}}`,
  };
}

/**
 * One per-target command suggestion when a selection spans multiple Level targets.
 * @typedef {{
 *   target: string,
 *   origin: string,
 *   levels: string[],
 *   command: string,
 * }} TargetCommand
 */

/**
 * Data carried on a `spanning_targets` refusal.
 * @typedef {{
 *   targets: string[],
 *   commands: TargetCommand[],
 * }} SpanningTargetsData
 */

/**
 * Builds one `<skill> … level:<l>` command per resolved Target group, in `targets` order.
 * @param {string} skill
 * @param {LevelTargetResolution} resolution
 * @param {{ scope: readonly string[], tags: readonly string[] }} selection
 * @returns {SpanningTargetsData}
 */
export function spanningTargetsData(skill, resolution, selection) {
  const base = [...selection.scope, ...selection.tags.map((tag) => `tag:${tag}`)];
  /** @type {TargetCommand[]} */
  const commands = resolution.groups.map((group) => {
    const tokens = [...base, ...group.levels.map((level) => `level:${level}`)];
    return {
      target: group.target.slug,
      origin: group.target.origin,
      levels: group.levels,
      command: `${skill} ${tokens.join(" ")}`,
    };
  });
  return {
    targets: commands.map((c) => c.target),
    commands,
  };
}

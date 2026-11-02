// @ts-check
// One normalized state producer, reading the same predicates /qa-next projects: stored Findings
// with their Dismissal status, the scan's mechanical Findings, the impact check and the Stale
// obligations. It supplies annotations; it never rewrites a Rule or case row.
import { isUnclassified } from './case-labels.mjs';
import { impactCheckDue } from './scan-history.mjs';
import { isStoredFinding, storedCaseFindings, storedFeatureFindings } from './stored-findings.mjs';
/** @import {ShowCaseState, ShowFinding, ShowStateSection} from './page.d.mts' */
/** @import {ScanAcquisition, ScanResult} from './scan.mjs' */
/** @import {ShowInventoryEntry} from './show-acquisition.mjs' */
/** @import {ParsedEntry, QaFile} from './knowledge-file.mjs' */
/** @import {StoredFinding} from './stored-findings.mjs' */

// The scan's Finding kinds. Integrity errors belong to the errors section, and a review is a Review,
// never a Finding.
/** @type {ReadonlySet<string>} */
const FINDING_KINDS = new Set(['overreach', 'outcome_gap', 'divergence']);

/**
 * @param {unknown} value
 * @returns {string}
 */
const stringOf = (value) => (typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value));

/**
 * A stored Finding, projected into the page contract. Its kind lower-cased is the signal
 * `/qa-next` reports for the same stored Finding.
 * @param {StoredFinding} finding
 * @param {string} key
 * @param {string} feature
 * @returns {ShowFinding}
 */
function storedShowFinding(finding, key, feature) {
  const kind = finding.kind.toLowerCase();
  return {
    kind, code: kind, message: stringOf(finding.evidence), file: finding.file, line: finding.line, feature, key,
    ...(typeof finding.rests_on === 'string' && { rests_on: finding.rests_on }),
  };
}

/**
 * A scan Finding, projected into the page contract.
 * @param {ScanResult} result
 * @param {string} feature
 * @returns {ShowFinding}
 */
function scanShowFinding(result, feature) {
  return {
    kind: result.kind, code: result.code, message: stringOf(result.message), feature,
    ...(result.file !== undefined && { file: result.file }),
    ...(result.line !== undefined && { line: result.line }),
    ...(typeof result.rests_on === 'string' && { rests_on: result.rests_on }),
    ...(result.key !== undefined && { key: result.key }),
  };
}

/**
 * The Stale a changed Rule owes a case, before any Stale is stored (ADR-0043). Marked on the case;
 * the impact check due badge and `stale_obligations` carry the Feature-level signal.
 * @param {import('./page.d.mts').ShowStaleObligation} obligation
 * @param {string} feature
 * @returns {ShowFinding}
 */
function obligationFinding(obligation, feature) {
  return {
    kind: 'stale', code: 'affected_rule', feature, key: obligation.key, file: obligation.file, line: obligation.line,
    message: `Changed since the Watermark: ${obligation.causes.join(', ')}`,
    baseline: obligation.baseline, target: obligation.target, causes: obligation.causes, affects: obligation.affects,
    cause_digest: obligation.cause_digest, via: obligation.via, stored: obligation.stored,
  };
}

/**
 * @param {ShowInventoryEntry} feature
 * @param {ScanAcquisition} acquisition
 * @returns {ShowStateSection}
 */
export function showState(feature, { facts, config }) {
  const featureKey = feature.key;
  const owned = new Set(feature.files.map(file => file.rel));
  const cases = feature.files.flatMap(file => (file.cases ?? []).map(entry => ({ file, entry })));

  // Stored Findings come from the same projector /qa-next reads, never from raw YAML. A stored
  // Overreach already records the scan's mechanical one, so the scan result is not shown twice.
  const featureStoredAll = feature.featureFile === null ? [] : storedFeatureFindings(facts.history, feature.featureFile);
  const caseStoredAll = cases.flatMap(({ file, entry }) => storedCaseFindings(facts.history, file, entry).map(finding => ({ finding, key: entry.key })));
  /** @type {Array<StoredFinding & { key?: string }>} */
  const storedOverreaches = [
    ...featureStoredAll,
    ...caseStoredAll.map(({ finding, key }) => ({ ...finding, key })),
  ].filter(finding => finding.kind === 'Overreach');
  const featureStored = featureStoredAll
    .filter(finding => finding.status === 'open' && isStoredFinding(finding))
    .map(finding => storedShowFinding(finding, stringOf(finding.subject), featureKey));
  const caseStored = caseStoredAll
    .filter(({ finding }) => finding.status === 'open' && isStoredFinding(finding))
    .map(({ finding, key }) => storedShowFinding(finding, key, featureKey));

  // The scan's own Findings are already settled (a holding Dismissal suppressed them).
  const scanFindings = facts.results
    .filter(result => FINDING_KINDS.has(result.kind))
    .filter(result => result.feature === featureKey || (result.feature === undefined && result.file !== undefined && owned.has(result.file)))
    .filter(result => !(result.kind === 'overreach' && storedOverreaches.some(stored => stored.file === result.file && stored.key === result.key && stored.rests_on === result.rests_on)))
    .map(result => scanShowFinding(result, featureKey));

  const obligations = facts.history.stale_obligations.filter(obligation => obligation.feature === featureKey);
  // A Stale the case already stores is already in `caseStored`; only the ones the Scan still owes
  // are projected from the obligation, so one change is one Finding.
  const pendingObligations = obligations.filter(obligation => !obligation.stored);
  const obligationFindings = pendingObligations.map(obligation => obligationFinding(obligation, featureKey));

  /** @param {ParsedEntry} entry @param {QaFile} file @returns {ShowCaseState} */
  const caseState = (entry, file) => {
    const review = facts.history.reviews.find(fact => fact.file === file.rel && fact.key === entry.key);
    const findings = [
      ...caseStored.filter(finding => finding.key === entry.key && finding.file === file.rel),
      ...scanFindings.filter(finding => finding.key === entry.key && (finding.file === undefined || finding.file === file.rel)),
      ...pendingObligations.filter(obligation => obligation.key === entry.key).map(obligation => obligationFinding(obligation, featureKey)),
    ];
    const mirrored = divergenceMirrors(file.rel, entry.key);
    const flags = [];
    const uncited = facts.uncited_cases.some(uncitedCase => uncitedCase.feature === featureKey && uncitedCase.key === entry.key);
    if (uncited) flags.push('uncited');
    const unclassified = isUnclassified(/** @type {Record<string, unknown>} */ (entry.data), config.labels.customFields);
    if (unclassified) flags.push('unclassified');
    return {
      review: {
        status: review?.status ?? 'unreviewed',
        overdue: facts.results.some(result => result.kind === 'review_overdue' && result.file === file.rel && result.key === entry.key),
        stamp: entry.data.review ?? null,
        deadline: typeof entry.data.review_by === 'string' ? entry.data.review_by : null,
      },
      annotations: { findings, flags, mirrored },
      uncited, unclassified,
    };
  };

  /**
   * The Mirrored values a Divergence makes visible, keyed by the Divergence's code. A case with a
   * Mirrored copy that agrees with the knowledge shows nothing.
   * @param {string} file
   * @param {string} key
   * @returns {Record<string, unknown>}
   */
  function divergenceMirrors(file, key) {
    /** @type {Record<string, unknown>} */
    const mirrored = {};
    for (const result of facts.results) {
      if (result.kind !== 'divergence' || result.key !== key || result.file !== file) continue;
      if (result.feature !== undefined && result.feature !== featureKey) continue;
      if (result.mirror !== undefined) mirrored[result.code] = result.mirror;
    }
    return mirrored;
  }

  const rules = (feature.featureFile?.rules ?? []);
  const ruleRows = Object.fromEntries(rules.map(rule => {
    const findings = [
      ...featureStored.filter(finding => finding.key === rule.key || finding.rests_on === rule.key),
      ...caseStored.filter(finding => finding.rests_on === rule.key),
      ...scanFindings.filter(finding => finding.rests_on === rule.key),
    ];
    // A changed Rule carries the Stale the Scan owes every case it affects. A stored Stale whose own
    // record already names this Rule is on it above, so one change is one badge.
    for (const obligation of obligations.filter(candidate => candidate.affects.includes(rule.key))) {
      if (!findings.some(finding => finding.kind === 'stale' && finding.key === obligation.key)) findings.push(obligationFinding(obligation, featureKey));
    }
    const flags = [];
    if (facts.uncovered_rules.some(uncovered => uncovered.feature === featureKey && uncovered.rule === rule.key)) flags.push('uncovered');
    if (rule.waiver !== null) flags.push('waived');
    return [rule.key, { findings, flags, mirrored: {} }];
  }));

  const history = facts.history.features.find(row => row.feature === featureKey);
  return {
    cases: Object.fromEntries(cases.map(({ file, entry }) => [entry.key, caseState(entry, file)])),
    rules: ruleRows,
    findings: [...featureStored, ...caseStored, ...scanFindings, ...obligationFindings],
    impact_due: history !== undefined && impactCheckDue(history),
    stale_obligations: obligations,
  };
}

// Shared page data contract.
// Holds the page data contract and imports no Node module.
import type { CaseSectionKind } from './case-sections.mjs';

export interface DismissalRule {
  pattern: string;
}

export interface DismissalValidation {
  [field: string]: DismissalRule | undefined;
}

export interface InboxFact {
  id: string;
  n?: number;
  kind?: string;
  line?: string;
}

export interface InboxItemQuestions {
  findings?: {
    choices: string[];
  };
  // accept and leave always; reject only for a case with no Tracker key, retire only for one with
  // a Tracker key. Reject and retire stand alone: choosing one clears the case's finding answers.
  review: {
    choices: string[];
  };
}

export interface InboxItemTextsRule {
  feature: string;
  key: string;
  text: string | null;
}

export interface InboxItemTexts {
  case?: string;
  rules?: InboxItemTextsRule[];
}

export interface InboxReviewStamp {
  by: string;
  at: string;
  commit?: string | null;
}

export interface InboxItemReviewState {
  status?: string;
  stamp?: InboxReviewStamp | null;
  [key: string]: unknown;
}

export interface InboxItem {
  key: string;
  label?: string;
  feature?: string;
  scenario?: string | null;
  file?: string;
  why?: Array<{ line: string }>;
  explanation?: string;
  proposal?: string[];
  texts?: InboxItemTexts;
  facts: InboxFact[];
  questions?: InboxItemQuestions;
  review_state?: InboxItemReviewState;
  constraints?: string[];
}

export interface InboxSummaries {
  features?: Record<string, string | undefined>;
  scenarios?: Record<string, string | undefined>;
  cases?: Record<string, string | undefined>;
  rules?: Record<string, Record<string, string>>;
}

export interface InboxTerm {
  term: string;
  explanation: string;
}

export interface PageLimits {
  warn: number;
  max: number;
}

export interface InboxPageModel {
  layout?: "inbox" | string;
  command?: string;
  card_page?: number;
  run?: string;
  page?: string;
  terms?: InboxTerm[];
  summaries?: InboxSummaries;
  items: InboxItem[];
  validation?: DismissalValidation;
  limits?: PageLimits;
}

export interface NextStamp {
  generated_at: string;
  head: string | null;
  dirty: boolean;
  root: string;
  refresh: string;
}

export interface NextMigrationDeclaration {
  key?: unknown;
  file: string;
  line?: number;
}

export interface NextMigration {
  migrations?: { version: number; command: string }[];
  pending: boolean;
  count?: number;
  declarations?: NextMigrationDeclaration[];
}

export interface NextSchema {
  code: string;
  version: number | string;
  supported: number | string;
}

export interface NextRunHealthItem {
  code: string;
  message?: string;
}

export interface NextTrainingCommand {
  command: string;
  trained: boolean;
  conventions: number;
  practices: number;
}

export interface NextTraining {
  commands: NextTrainingCommand[];
  access_notes: number;
}

export interface NextGlobal {
  migration: NextMigration;
  schema: NextSchema;
  run_health: NextRunHealthItem[];
  training?: NextTraining;
}

export interface NextExecutionResult {
  kind: string;
  key: string;
  label: string;
  result: string;
  reason?: string;
  date: string;
  target: string;
  out_of_date: boolean;
  at_login?: boolean;
  file: string;
  line: number;
  hint: string | null;
}

export interface NextExecutions {
  passed: { count: number; out_of_date: number };
  results: NextExecutionResult[];
}

export interface NextFeatureInfo {
  kind: string;
  signal: string;
  count: number;
  labels: { signal: string };
}

export interface NextFeature {
  key: string;
  label: string;
  nothing_pending?: boolean;
  information: NextFeatureInfo[];
  counts: Record<string, number>;
  executions?: NextExecutions | null;
  top_next_step?: NextStep | null;
}

export interface NextLocation {
  file: string;
  line?: number;
}

export interface NextRoute {
  type: string;
  command?: string;
  args?: string[];
  text?: string;
}

export interface NextStepLabels {
  signal: string;
  feature?: string | null;
  detail?: string | null;
  scenario?: string;
  keys?: string[];
}

export interface NextStep {
  kind: string;
  feature: string | null;
  command?: string;
  // Transcribed from scan-history.mjs's `UpstreamChange`, which owns the shape: a page contract
  // cannot import a JSDoc typedef.
  because?: Array<{ ref: string; via: string[] }>;
  labels: NextStepLabels;
  keys: string[];
  count?: number;
  scenario?: string;
  locations: NextLocation[];
  file?: string;
  line?: number;
  prerequisites: string[];
  route: NextRoute;
  optional_routes?: NextRoute[];
}

export interface NextLegendEntry {
  kind: string;
  emoji: string;
  label: string;
}

export interface NextPageModel {
  layout: "next";
  command?: string;
  stamp: NextStamp;
  global: NextGlobal;
  features: NextFeature[];
  next_steps: NextStep[];
  start_here: NextStep | null;
  summaries?: InboxSummaries;
  legend: NextLegendEntry[];
}

export type PageModel = InboxPageModel | NextPageModel | ShowPageModel;

export interface PageLayout {
  title: string;
  heading: (model: { layout?: string; command?: string }) => string;
}

export interface FindingAnswer {
  answer?: string;
  reason?: string;
  ticket?: string;
  fix?: string;
  target?: string;
}

export interface CaseSelection {
  review?: string;
  findings?: Record<string, FindingAnswer>;
  comment?: string;
}

export type Selections = Record<string, CaseSelection>;

export interface ReplyItemFinding {
  answer: string;
  fix?: string;
  target?: string;
  reason?: string;
  ticket?: string;
}

export interface ReplyItem {
  key: string;
  review?: string;
  findings?: Record<string, ReplyItemFinding>;
  comment?: string;
}

export interface ReplyPayload {
  card_page?: number;
  run?: string;
  page?: string;
  count: number;
  items: ReplyItem[];
  comment?: string;
}

export interface PreparedReply {
  block: string | null;
  length: number;
  taken: number;
  left: number;
  warning: boolean;
  overLimit: boolean;
  oversized: string[];
  commentTooLarge: boolean;
}


// Knowledge page section contracts. Each later ticket fills its own producer/view slot.
export interface ShowHeaderSection {
  title: string;
  intro: string;
  references: unknown[];
  provenance: unknown;
}
export interface ShowRuleRow {
  key: string;
  statement: string;
  elaboration: string;
  direct_covers: number;
}
export interface ShowRulesSection { rows: Readonly<Record<string, ShowRuleRow>> }
export interface ShowFeature {
  key: string;
  header: ShowHeaderSection;
  rules: ShowRulesSection;
  scenarios: ShowScenariosSection;
  knowledge: ShowKnowledgeSection;
  errors: ShowErrorsSection;
  state: ShowStateSection;
  links: ShowLinksSection;
  summary: ShowSummaryRow;
}
export interface ShowPageModel {
  layout: "show";
  stamp: NextStamp;
  migration: ShowMigration;
  schema: { code: string; version: number | null; supported: number };
  features: Readonly<Record<string, ShowFeature>>;
  labels: ShowLabels;
  errors: ShowErrorsSection;
  scope: string | null;
}

export interface ShowLabels {
  tags: Record<string, string>;
  retiredTags: string[];
  customFields: ShowCustomField[];
  levels: string[];
}
export interface ShowReview {
  status: "fresh" | "void" | "unreviewed";
  overdue: boolean;
  stamp: unknown;
  deadline: string | null;
}
export interface ShowAnnotations {
  findings: ShowFinding[];
  flags: string[];
  mirrored: Record<string, unknown>;
}
export interface ShowCaseState {
  review: ShowReview;
  annotations: ShowAnnotations;
  uncited: boolean;
  unclassified: boolean;
}
export interface ShowStateSection {
  cases: Readonly<Record<string, ShowCaseState>>;
  rules: Readonly<Record<string, ShowAnnotations>>;
  findings: ShowFinding[];
  impact_due: boolean;
  stale_obligations: ShowStaleObligation[];
}
export interface ShowCaseRow {
  key: string;
  title: string;
  line: number;
  data: Record<string, unknown>;
  sections: ShowCaseSection[];
}
export interface ShowScenarioRow {
  key: string;
  title: string;
  file: string;
  data: Record<string, unknown>;
  cases: Readonly<Record<string, ShowCaseRow>>;
}
export interface ShowScenariosSection { rows: Readonly<Record<string, ShowScenarioRow>> }
export interface ShowKnowledgeSection {
  // Transcribed from deferred.mjs's `DeferredFunctionality` and parked-questions.mjs's
  // `ParkedQuestion`, which own the shapes; this contract has no Node imports.
  deferred: Array<{ functionality: string; reason: string; reference: string; place: string | null; line: number }>;
  parked: Array<{ text: string; line: number }>;
  boundaries: ShowBoundary[];
  waivers: Array<{ key: string; reason: string; elaboration: string }>;
  coverage: ShowCoverage | null;
  coverage_due: ShowCoverageDue | null;
  deferred_count: number;
  parked_count: number;
}
export interface ShowErrorsSection { rows: ShowFinding[] }
export interface ShowRuleLink { feature: string; key: string; summary: string }
export interface ShowLinksSection {
  rules: Readonly<Record<string, {
    covers: string[];
    relied_on_by: ShowRuleLink[];
    dependencies: ShowRuleLink[];
    dependents: ShowRuleLink[];
  }>>;
}
export interface ShowSummaryRow {
  rules: number;
  cases: number;
  uncovered: number;
  parked: number;
  deferred: number;
  findings: number;
}
export interface ShowFilterState {
  query: string;
  rules: { uncovered: boolean; waived: boolean; findings: boolean };
  cases: { level: string; tag: string; custom: Record<string, string>; review: string; finding: string; uncited: boolean; selected: readonly string[] | null; selectedFeature: string | null };
}
export interface ShowNavigation {
  openFeature: (feature: string) => void;
  openCase: (feature: string, scenario: string, key: string) => void;
  selectCases: (feature: string, keys: readonly string[]) => void;
}
export interface ShowLazyMount { open: () => void; mount: () => void }


// Page-owned serializable slices transcribed from the producers. This contract has no Node
// imports: the same data is checked in the Node writer and the standalone browser program.
export interface ShowMigration {
  pending: boolean;
  count: number;
  declarations: Array<{ file: string; line: number; key: unknown; malformed?: true; block_key?: unknown }>;
  migrations: Array<{ version: number; command: string }>;
}
export interface ShowCustomField {
  name: string; description: string; values: string[]; retired: string[]; multiple: boolean; required: boolean;
}
export interface ShowFinding {
  kind: string; code: string; message: string; file?: string; line?: number; feature?: string; rests_on?: string;
  [key: string]: unknown;
}
export interface ShowCaseSection { kind: CaseSectionKind; line: number; end: number; text: string }
export interface ShowBoundary { key: string; statement: string; owner: string | null; line: number; end: number; elaboration: string }
export interface ShowCoverage {
  line: number;
  lines: Array<{ key: string; disposition: "covered" | "n/a" | "awaiting"; rules: string[]; na: Array<{ functionality: string; reason: string }>; reason: string | null; line: number }>;
  problems: Array<{ code: string; message: string; line?: number; [key: string]: unknown }>;
}
export interface ShowCoverageDue { trigger: string; detail: string }
export interface ShowStaleObligation {
  feature: string; file: string; line: number; key: string;
  baseline: string; target: string | null; causes: string[]; affects: string[]; cause_digest: string;
  via: Array<"covers" | "relies_on">; stored: boolean;
}

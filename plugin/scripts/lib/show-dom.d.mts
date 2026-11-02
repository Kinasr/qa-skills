// DOM-only rendering contract; serialized section data remains in page.d.mts.
import type { ShowAnnotations, ShowFeature, ShowFilterState, ShowLazyMount, ShowNavigation, ShowPageModel } from './page.d.mts';
export interface ShowRenderContext {
  node: <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, parent?: Element) => HTMLElementTagNameMap[K];
  lazy: (parent: Element, title: string, build: (parent: HTMLElement) => void) => ShowLazyMount;
  keyed: (parent: Element, text: string, feature: string) => void;
  annotate: (parent: Element, annotations: ShowAnnotations) => void;
  reference: (parent: Element, reference: string) => void;
  caseAnnotations: (parent: Element, feature: string, key: string) => void;
  registerCase: (feature: string, scenario: string, key: string, open: () => void) => void;
  ruleLinks: (parent: Element, feature: ShowFeature, key: string) => void;
  filters: ShowFilterState;
  filterChanged: () => void;
  navigation: ShowNavigation;
  model: ShowPageModel;
}
export type ShowSectionRequest =
  | { phase: 'page'; parent: HTMLElement; ctx: ShowRenderContext }
  | { phase: 'feature'; parent: HTMLElement; feature: ShowFeature; ctx: ShowRenderContext }
  | { phase: 'rule'; parent: Element; feature: ShowFeature; key: string; ctx: ShowRenderContext }
  | { phase: 'annotation'; parent: Element; annotations: ShowAnnotations; ctx: ShowRenderContext }
  | { phase: 'reference'; parent: Element; reference: string; ctx: ShowRenderContext };
// Opaque DOM boundary, as for mountCardPage. Implementations cast once to ShowSectionRequest.
export type ShowSectionView = (request: unknown) => void;
export interface ShowMountContext {
  app: HTMLElement;
  header: HTMLElement;
  node: ShowRenderContext['node'];
}

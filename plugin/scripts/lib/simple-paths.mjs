// @ts-check
// Simple paths from one root over a directed graph whose edges each lie on the target side or only
// on the baseline side, without walking every one of them. For each wanted node the result is what
// an exhaustive walk over all simple paths would give: the first `limit` paths in visit order,
// whether more exist, and whether the paths run over target edges, baseline edges or both. A graph
// of layered diamonds has 2^layers simple paths, so the walk is bounded instead of exhaustive:
//
//   - The sample is found one path at a time, and only down branches that still reach the node
//     without crossing the path so far, so every step is on a path to be reported. It stops at
//     `limit + 1` paths: one more than the sample proves it is cut.
//   - Whether any path is pure is plain reachability, over target edges alone and baseline edges alone.
//   - Whether a path mixes the sides cannot be read off reachability once the graph has a cycle: a
//     walk may cross an edge twice that no simple path crosses once. Deciding it exactly is the
//     problem of a simple path through a given edge, which is NP-hard on a directed graph, so the
//     walk is used when it is exact (the node is not downstream of a cycle) and an exact search,
//     bounded by a step budget, when it is not. A search that runs out of budget answers "both":
//     the answer a walk gives.
//
// Only a node whose sample is cut and whose cut paths decide the label pays for any of this: a node
// with `limit` or fewer paths has every path in its sample, and its label is read off them.

/** @typedef {"target" | "baseline"} PathSide */
/** @typedef {{ to: string, side: PathSide }} PathEdge */
/** @typedef {"target" | "baseline" | "both" | "none"} PathEdges */
/** @typedef {{ paths: string[][], truncated: boolean, edges: PathEdges }} PathFacts */

// Steps the exact search may take for one root: a call of the search, or a node the look-ahead pops.
/** @type {number} */
export const DEFAULT_BUDGET = 200_000;

const TARGET = 1;
const BASELINE = 2;
const MIXED = TARGET | BASELINE;

/**
 * @param {PathSide} side
 * @returns {number}
 */
const bitOf = (side) => (side === "target" ? TARGET : BASELINE);

/**
 * The label of the paths to a node other than the root, given each one's sides as a mask: 1 for
 * target edges only, 2 for baseline only, 3 for both. There is at least one path, and each has an edge.
 * @param {readonly number[]} masks
 * @returns {PathEdges}
 */
function edgesOfMasks(masks) {
  let target = false;
  let baseline = false;
  for (const mask of masks) {
    if (mask === MIXED) return "both";
    if (mask === TARGET) target = true;
    else baseline = true;
  }
  return target && baseline ? "both" : target ? "target" : "baseline";
}

/**
 * The nodes reachable from `root`, in breadth-first order, with each one's edges. An edge from a
 * node to itself is no step of a simple path and is dropped.
 * @param {string} root
 * @param {(node: string) => readonly PathEdge[]} successors
 * @returns {{ order: string[], out: Map<string, PathEdge[]>, into: Map<string, string[]> }}
 */
function reachFrom(root, successors) {
  /** @type {Map<string, PathEdge[]>} */
  const out = new Map([[root, []]]);
  /** @type {Map<string, string[]>} */
  const into = new Map();
  const order = [root];
  for (let i = 0; i < order.length; i++) {
    const node = order[i];
    const edges = successors(node).filter((edge) => edge.to !== node);
    out.set(node, edges);
    for (const { to } of edges) {
      if (!out.has(to)) {
        out.set(to, []);
        order.push(to);
      }
      const from = into.get(to);
      if (from) from.push(node);
      else into.set(to, [node]);
    }
  }
  return { order, out, into };
}

/**
 * The strongly connected components of the graph reached from `root`: each node's component, and
 * which components hold more than one node. Tarjan's algorithm, without recursion.
 * @param {string} root
 * @param {Map<string, PathEdge[]>} out
 * @returns {{ component: Map<string, number>, cyclic: Set<number> }}
 */
function componentsFrom(root, out) {
  /** @type {Map<string, number>} */
  const index = new Map([[root, 0]]);
  /** @type {Map<string, number>} */
  const low = new Map([[root, 0]]);
  /** @type {Map<string, number>} */
  const component = new Map();
  /** @type {Map<number, number>} */
  const sizes = new Map();
  const stack = [root];
  const onStack = new Set(stack);
  /** @type {Array<{ node: string, next: number }>} */
  const frames = [{ node: root, next: 0 }];
  let counter = 1;
  let count = 0;
  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    const edges = /** @type {PathEdge[]} */ (out.get(frame.node));
    if (frame.next < edges.length) {
      const { to } = edges[frame.next++];
      if (!index.has(to)) {
        index.set(to, counter);
        low.set(to, counter++);
        stack.push(to);
        onStack.add(to);
        frames.push({ node: to, next: 0 });
      } else if (onStack.has(to)) {
        low.set(frame.node, Math.min(/** @type {number} */ (low.get(frame.node)), /** @type {number} */ (index.get(to))));
      }
      continue;
    }
    frames.pop();
    const lowest = /** @type {number} */ (low.get(frame.node));
    if (lowest === index.get(frame.node)) {
      let size = 0;
      /** @type {string} */
      let member;
      do {
        member = /** @type {string} */ (stack.pop());
        onStack.delete(member);
        component.set(member, count);
        size++;
      } while (member !== frame.node);
      sizes.set(count++, size);
    }
    const parent = frames[frames.length - 1];
    if (parent) low.set(parent.node, Math.min(/** @type {number} */ (low.get(parent.node)), lowest));
  }
  return { component, cyclic: new Set([...sizes].filter(([, size]) => size > 1).map(([id]) => id)) };
}

/**
 * The facts of each wanted node reachable from `root`. `successors` lists a node's edges in the
 * order the walk visits them, each target node once, and is asked once per node. The sample is the
 * first `limit` simple paths in that order, which is the order an exhaustive depth-first walk meets them.
 * @param {{
 *   root: string,
 *   wanted: (node: string) => boolean,
 *   successors: (node: string) => readonly PathEdge[],
 *   limit: number,
 *   budget?: number,
 * }} args
 * @returns {Map<string, PathFacts>}
 */
export function simplePathFacts({ root, wanted, successors, limit, budget = DEFAULT_BUDGET }) {
  const { order, out, into } = reachFrom(root, successors);
  const { component, cyclic } = componentsFrom(root, out);
  const cap = limit + 1;
  let left = budget;

  /**
   * @param {string} node
   * @returns {number}
   */
  const componentOf = (node) => /** @type {number} */ (component.get(node));

  // The nodes of the graph that reach `node`, itself included.
  /**
   * @param {string} node
   * @returns {Set<string>}
   */
  function reaching(node) {
    const seen = new Set([node]);
    const queue = [node];
    for (let i = 0; i < queue.length; i++) {
      for (const from of into.get(queue[i]) ?? []) {
        if (!seen.has(from)) {
          seen.add(from);
          queue.push(from);
        }
      }
    }
    return seen;
  }

  // The path being built: which nodes it holds, and how many of each component, so a branch whose
  // component holds none of them needs no search to know it can still reach the node.
  /**
   * @returns {{ onPath: Set<string>, push: (node: string) => void, pop: (node: string) => void, crowded: (node: string) => boolean }}
   */
  function pathState() {
    const onPath = new Set([root]);
    /** @type {Map<number, number>} */
    const held = new Map([[componentOf(root), 1]]);
    return {
      onPath,
      push(node) {
        onPath.add(node);
        held.set(componentOf(node), (held.get(componentOf(node)) ?? 0) + 1);
      },
      pop(node) {
        onPath.delete(node);
        held.set(componentOf(node), /** @type {number} */ (held.get(componentOf(node))) - 1);
      },
      // Another node of this node's component is on the path: a way to the target may cross it.
      crowded: (node) => /** @type {number} */ (held.get(componentOf(node))) > 1,
    };
  }

  // Whether `from` still reaches `target` without touching the path: a route of nodes that reach it.
  /**
   * @param {string} from
   * @param {string} target
   * @param {Set<string>} canReach
   * @param {Set<string>} onPath
   * @returns {boolean}
   */
  function clearRoute(from, target, canReach, onPath) {
    const seen = new Set([from]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      for (const { to } of /** @type {PathEdge[]} */ (out.get(queue[i]))) {
        if (to === target) return true;
        if (seen.has(to) || onPath.has(to) || !canReach.has(to)) continue;
        seen.add(to);
        queue.push(to);
      }
    }
    return false;
  }

  // The first `cap` simple paths from the root to `target`, in visit order, each with its sides.
  /**
   * @param {string} target
   * @returns {Array<{ path: string[], mask: number }>}
   */
  function firstPaths(target) {
    const canReach = reaching(target);
    const state = pathState();
    const path = [root];
    /** @type {Array<{ path: string[], mask: number }>} */
    const found = [];
    /**
     * @param {string} node
     * @param {number} mask
     * @returns {void}
     */
    const extend = (node, mask) => {
      for (const edge of /** @type {PathEdge[]} */ (out.get(node))) {
        if (found.length >= cap) return;
        const to = edge.to;
        if (state.onPath.has(to) || !canReach.has(to)) continue;
        state.push(to);
        path.push(to);
        if (to === target) found.push({ path: [...path], mask: mask | bitOf(edge.side) });
        else if (!state.crowded(to) || clearRoute(to, target, canReach, state.onPath)) extend(to, mask | bitOf(edge.side));
        path.pop();
        state.pop(to);
      }
    };
    extend(root, 0);
    return found;
  }

  // The nodes reachable from the root over edges of one side only.
  /**
   * @param {number} bit
   * @returns {Set<string>}
   */
  function reachOver(bit) {
    const seen = new Set([root]);
    const queue = [root];
    for (let i = 0; i < queue.length; i++) {
      for (const { to, side } of /** @type {PathEdge[]} */ (out.get(queue[i]))) {
        if (bitOf(side) === bit && !seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
      }
    }
    return seen;
  }

  // The sides every node can be reached with by some walk from `start` (not a simple path), as a set
  // of masks: bit `m` set when a walk with sides `m` ends there. A node on a walk may repeat. A
  // search charges the budget a step for each node it pops; the walk from the root does not.
  /**
   * @param {string} start
   * @param {number} startMask
   * @param {(node: string) => boolean} allowed
   * @param {string | null} stopAt a node no walk goes past: a simple path to it ends there
   * @param {boolean} charged
   * @returns {Map<string, number> | null} null when the budget ran out
   */
  function walkMasks(start, startMask, allowed, stopAt, charged) {
    /** @type {Map<string, number>} */
    const reached = new Map([[start, 1 << startMask]]);
    /** @type {Array<[string, number]>} */
    const queue = [[start, startMask]];
    for (let i = 0; i < queue.length; i++) {
      const [node, mask] = queue[i];
      if (charged && --left < 0) return null;
      if (node === stopAt) continue;
      for (const { to, side } of /** @type {PathEdge[]} */ (out.get(node))) {
        if (!allowed(to)) continue;
        const next = mask | bitOf(side);
        const seen = reached.get(to) ?? 0;
        if (seen & (1 << next)) continue;
        reached.set(to, seen | (1 << next));
        queue.push([to, next]);
      }
    }
    return reached;
  }

  // Everything below the cyclic nodes: a walk to any other node repeats none, so it is a simple path.
  const downstreamOfCycles = lazily(() => {
    const seen = new Set(order.filter((node) => cyclic.has(componentOf(node))));
    const queue = [...seen];
    for (let i = 0; i < queue.length; i++) {
      for (const { to } of /** @type {PathEdge[]} */ (out.get(queue[i]))) {
        if (!seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
      }
    }
    return seen;
  });
  const reachByTarget = lazily(() => reachOver(TARGET));
  const reachByBaseline = lazily(() => reachOver(BASELINE));
  const walksFromRoot = lazily(() => /** @type {Map<string, number>} */ (walkMasks(root, 0, () => true, null, false)));

  // Whether a simple path from the root to `target` has edges of both sides: true, false, or null
  // when the budget ran out. A depth-first search over simple paths that gives up on a branch no walk
  // from there can finish with both sides.
  /**
   * @param {string} target
   * @returns {boolean | null}
   */
  function mixedPathExists(target) {
    const canReach = reaching(target);
    const state = pathState();
    /**
     * @param {string} node
     * @param {number} mask
     * @returns {boolean | null}
     */
    const extend = (node, mask) => {
      if (--left < 0) return null;
      for (const edge of /** @type {PathEdge[]} */ (out.get(node))) {
        const to = edge.to;
        if (state.onPath.has(to) || !canReach.has(to)) continue;
        const next = mask | bitOf(edge.side);
        if (to === target) {
          if (next === MIXED) return true;
          continue;
        }
        state.push(to);
        const walks = walkMasks(to, next, (n) => canReach.has(n) && !state.onPath.has(n), target, true);
        const open = walks === null ? null : (walks.get(target) ?? 0) & (1 << MIXED) ? extend(to, next) : false;
        state.pop(to);
        if (open !== false) return open;
      }
      return false;
    };
    return extend(root, 0);
  }

  // The label of a node whose sample is cut, from the paths found and what reachability says of the rest.
  /**
   * @param {string} target
   * @param {Array<{ mask: number }>} found
   * @returns {PathEdges}
   */
  function cutEdges(target, found) {
    const overTarget = reachByTarget().has(target);
    const overBaseline = reachByBaseline().has(target);
    if (found.some(({ mask }) => mask === MIXED) || (overTarget && overBaseline)) return "both";
    const pure = overTarget ? "target" : "baseline";
    if (!(/** @type {number} */ (walksFromRoot().get(target)) & (1 << MIXED))) return pure;
    if (!downstreamOfCycles().has(target)) return "both";
    return mixedPathExists(target) === false ? pure : "both";
  }

  /** @type {Map<string, PathFacts>} */
  const facts = new Map();
  for (const node of order) {
    if (!wanted(node)) continue;
    if (node === root) {
      facts.set(node, { paths: [[root]], truncated: false, edges: "none" });
      continue;
    }
    const found = firstPaths(node);
    const truncated = found.length > limit;
    facts.set(node, {
      paths: found.slice(0, limit).map(({ path }) => path),
      truncated,
      edges: truncated ? cutEdges(node, found) : edgesOfMasks(found.map(({ mask }) => mask)),
    });
  }
  return facts;
}

/**
 * A function that computes its value on the first call and returns it after.
 * @template T
 * @param {() => T} compute
 * @returns {() => T}
 */
function lazily(compute) {
  /** @type {{ value: T } | null} */
  let made = null;
  return () => (made ??= { value: compute() }).value;
}

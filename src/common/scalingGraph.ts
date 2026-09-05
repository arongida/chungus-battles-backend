// Ordering engine for "scaling" stat sources — item skills / talents whose AURA output is
// computed FROM another stat (Titan's Might: strength from max HP; Ironblood: bonus regen from
// regen; ...). Reading the live, fully-derived player stat for that input is what caused the old
// exponential bug: a source that both reads and writes the same stat (Last Stand's
// `defense = defense * ratio`) diverges the instant it can see its own output, since there is no
// fixed point — `D = D0 + r*D` has no solution for r >= 1.
//
// The fix: every scaling source declares which stats it READS and which it WRITES. Sources are
// topologically sorted once (buildScalingOrder, called by scalingRegistry.ts at module load) so
// each source's snapshot contains only sources ordered strictly BEFORE it — complete except for
// the parts that depend on it. A self-reference (a source reading a stat it also writes) is
// simply never an edge to itself, so it's excluded by construction rather than by convention.
//
// A node is one skill/talent ID, not one item instance — see ScalingNodeId below for why.

import type { StatsSnapshot } from './statsUtils';

/** The only stats a scaling source may read or write — exactly the fields StatsSnapshot carries.
 *  attackSpeed is deliberately absent: nothing scales off attack speed today (Fluid Motion,
 *  Berserk and Merchant's capstone all WRITE it but never read it as an input), and
 *  recalculatePlayerStats accumulates every source's attackSpeed unconditionally each tick
 *  regardless of aura-pass order, so it needs no ordering. Extending this to a stat that IS read
 *  as scaling input is a deliberate type-level decision (widen StatsSnapshot first), not a
 *  silent gap. */
export type StatKey = keyof StatsSnapshot;

/** One node per skill/talent ID — never per item instance. Two equipped copies of the same
 *  Mythic skill both read the SAME pre-node snapshot and fold their output in together
 *  afterwards; without this collapse, two copies of a "+= defense" skill would each see the
 *  other's contribution and climb every tick (`A = 50+B, B = 50+A, ...`), the very shape of the
 *  old bug, just between two items instead of two skills. */
export type ScalingNodeId = `skill:${number}` | `talent:${number}`;

export function skillNode(skillId: number): ScalingNodeId {
  return `skill:${skillId}`;
}

export function talentNode(talentId: number): ScalingNodeId {
  return `talent:${talentId}`;
}

export interface ScalingDeclaration {
  /** Stats this source's output is computed FROM. */
  reads: StatKey[];
  /** Stats this source contributes TO. */
  writes: StatKey[];
  /** Deterministic tie-break for a genuine cycle (two sources that mutually read what the other
   *  writes — see itemSkillBalance.ts's BULWARK/STRONG pair for the concrete case, and
   *  talentScaling.ts's MERCHANT_5 for a node forced after everything else). Forces this node
   *  after every listed one, dropping the reverse edge if the natural read/write overlap would
   *  otherwise have produced one. Only reach for this when buildScalingOrder actually throws —
   *  it is a deliberate design call about which source's output the other sees, not a routine
   *  setting. */
  after?: ScalingNodeId[];
}

export interface ScalingNodeDef extends ScalingDeclaration {
  id: ScalingNodeId;
}

/**
 * Topologically sorts every declared scaling source. Pure function of the declarations — no
 * module-load-order dependency — so callers (scalingRegistry.ts) pass the combined item + talent
 * declaration list explicitly. Throws (at module load, via scalingRegistry.ts) if a cycle
 * survives every `after` tie-break, naming the stuck nodes so the fix is to add an `after` on one
 * of them, not to debug a runaway stat at 3am.
 */
export function buildScalingOrder(defs: ScalingNodeDef[]): ScalingNodeId[] {
  const byId = new Map<ScalingNodeId, ScalingNodeDef>();
  defs.forEach((d) => byId.set(d.id, d));

  // adjacency.get(A) = set of nodes that must run AFTER A (an edge A -> B means "A before B").
  const adjacency = new Map<ScalingNodeId, Set<ScalingNodeId>>();
  const indegree = new Map<ScalingNodeId, number>();
  defs.forEach((d) => {
    adjacency.set(d.id, new Set());
    indegree.set(d.id, 0);
  });

  const addEdge = (from: ScalingNodeId, to: ScalingNodeId) => {
    if (from === to) return; // self-reference: excluded by construction, not an edge.
    const forward = adjacency.get(from)!;
    if (forward.has(to)) return;
    forward.add(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  };
  const removeEdge = (from: ScalingNodeId, to: ScalingNodeId) => {
    const forward = adjacency.get(from);
    if (forward?.delete(to)) {
      indegree.set(to, (indegree.get(to) ?? 1) - 1);
    }
  };

  // Natural edges: A -> B whenever A writes a stat B reads.
  defs.forEach((a) => {
    defs.forEach((b) => {
      if (a.id === b.id) return;
      if (a.writes.some((stat) => b.reads.includes(stat))) addEdge(a.id, b.id);
    });
  });

  // `after` tie-breaks always win over a conflicting natural edge — see ScalingDeclaration.after.
  defs.forEach((d) => {
    (d.after ?? []).forEach((mustPrecede) => {
      if (!byId.has(mustPrecede)) {
        throw new Error(`Scaling graph: ${d.id} declares after:[${mustPrecede}], which is not a registered scaling node.`);
      }
      removeEdge(d.id, mustPrecede);
      addEdge(mustPrecede, d.id);
    });
  });

  // Kahn's algorithm. Each pass processes every currently-zero-indegree node (in declaration
  // order, for a deterministic result); repeats until nothing is left or nothing progressed.
  const order: ScalingNodeId[] = [];
  const remaining = new Set(defs.map((d) => d.id));
  let progressed = true;
  while (remaining.size > 0 && progressed) {
    progressed = false;
    for (const d of defs) {
      if (!remaining.has(d.id)) continue;
      if ((indegree.get(d.id) ?? 0) > 0) continue;
      order.push(d.id);
      remaining.delete(d.id);
      adjacency.get(d.id)!.forEach((to) => {
        indegree.set(to, (indegree.get(to) ?? 1) - 1);
      });
      progressed = true;
    }
  }

  if (remaining.size > 0) {
    throw new Error(
      `Scaling graph has a cycle among: ${[...remaining].join(', ')}. ` +
      `Two of these sources both read a stat the other writes — add an \`after\` tie-break on ` +
      `one of them (see itemSkillBalance.ts's BULWARK, or talentScaling.ts's MERCHANT_5, for ` +
      `the pattern).`
    );
  }

  return order;
}

// Aggregates every declared scaling source (item skills + talents) into one topologically sorted
// order, computed once at module load — see scalingGraph.ts for the algorithm and the reasoning
// behind it. This is the one module that imports both itemSkillBalance.ts and talentScaling.ts;
// scalingGraph.ts itself stays a leaf (types + the sort algorithm only) so those two files can
// import IT without a cycle back through this one.

import { ScalingDeclaration, ScalingNodeDef, ScalingNodeId, buildScalingOrder, skillNode, talentNode } from './scalingGraph';
import { ITEM_SKILLS } from '../items/behavior/itemSkillBalance';
import { TALENT_SCALING } from '../talents/behavior/talentScaling';

const nodeDefs: ScalingNodeDef[] = [];

Object.values(ITEM_SKILLS).forEach((def) => {
  if (def.scaling) nodeDefs.push({ id: skillNode(def.id), ...def.scaling });
});

Object.entries(TALENT_SCALING).forEach(([talentId, decl]) => {
  nodeDefs.push({ id: talentNode(Number(talentId)), ...decl });
});

/** Every scaling node, in dependency order. The AURA pass (DraftAuraTriggerCommand /
 *  FightAuraTriggerCommand, via triggerUtils.runScalingSources) runs sources in exactly this
 *  order, folding each one's output into the running snapshot before the next runs. Computed
 *  once here, at module load, so a cycle fails the server's startup instead of surfacing as an
 *  in-game stat bug. */
export const SCALING_ORDER: ScalingNodeId[] = buildScalingOrder(nodeDefs);

/** Item skill IDs that are scaling sources — used to skip them in the generic
 *  triggerEquippedItems AURA pass (they already ran, in order, via runScalingSources) and to
 *  filter buildFloorSnapshot's talent sum (see statsUtils.ts). */
export const SCALING_SKILL_IDS: Set<number> = new Set(
  Object.values(ITEM_SKILLS).filter((d) => d.scaling).map((d) => d.id)
);

/** Talent IDs that are scaling sources — same purpose as SCALING_SKILL_IDS above, talent side. */
export const SCALING_TALENT_IDS: Set<number> = new Set(
  Object.keys(TALENT_SCALING).map(Number)
);

/** The same declarations keyed by node id. The read/write pairs are a machine-readable synergy
 *  graph — "this source turns max HP into strength" — which the bot policy (src/bot/v2/synergy.ts)
 *  reads to recognize combinations like Strong -> Bulwark -> Titan's Might without hand-authoring
 *  them. Built from the same nodeDefs array as SCALING_ORDER, so it can never disagree with it. */
export const SCALING_DECLARATIONS: Map<ScalingNodeId, ScalingDeclaration> = new Map(
  nodeDefs.map((d) => [d.id, { reads: d.reads, writes: d.writes, after: d.after }])
);

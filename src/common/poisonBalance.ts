/** Poison DoT constants. Mirrors the BURN_DAMAGE_PER_STACK / BURN_DURATION_MS pattern in
 *  items/behavior/uniqueItemBalance.ts — kept here instead since poison has no single "owning"
 *  item and is referenced from PlayerSchema, FightRoom, statsUtils and TalentBehaviors. */

/** Fraction of the victim's max HP each poison stack deals per tick. */
export const POISON_DAMAGE_PER_STACK_FRACTION = 0.002;
/** How long one application of stacks lives before decaying. 5 ticks at
 *  POISON_DAMAGE_PER_STACK_FRACTION = exactly 1% max HP per stack over its life. */
export const POISON_DURATION_MS = 5000;
/** Base gap between poison ticks. */
export const POISON_TICK_INTERVAL_MS = 1000;
/** Healing multiplier while poisoned — flat, does not scale with stacks. */
export const POISON_HEALING_EFFECTIVENESS = 0.5;

/** Festering Wounds: stacks required on the enemy before the tick rate doubles. */
export const FESTERING_WOUNDS_STACK_THRESHOLD = 10;
/** Multiplier applied to POISON_TICK_INTERVAL_MS while Festering Wounds is live. */
export const FESTERING_WOUNDS_INTERVAL_MULTIPLIER = 0.5;
/** itemId of the weapon Festering Wounds grants once, for free, on pick. */
export const FESTERING_WOUNDS_GRANT_ITEM_ID = 18; // Dagger of Poison

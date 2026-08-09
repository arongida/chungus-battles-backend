// Server-only, per-item runtime state for class/shield item skills — keyed by object identity
// (same WeakMap idiom as talents/behavior/weaponWhispererState.ts and merchantDiscountState.ts).
// Extracted out of ItemSkillBehaviors.ts into its own module so itemSkillStatus.ts (the live
// status-line refresher, see itemSkillBalance.ts's `status()`) can read the same counters the
// behaviors write, without ItemSkillBehaviors.ts and itemSkillBalance.ts importing each other.

import type { Item } from '../schema/ItemSchema';

// Per-fight attack counters, keyed by item instance (rebuilt fresh each fight from DB
// snapshots — same WeakMap idiom as ItemBehaviors.ts's secondWindUsed).
export const coatedEdgeCounters = new WeakMap<Item, number>();
export const openingActCounters = new WeakMap<Item, number>();
export const crushingBlowCounters = new WeakMap<Item, number>();
export const protectionMoneyLastProcMs = new WeakMap<Item, number>();
// Shield Bash: last proc time (clock-elapsed ms), reset on FIGHT_START — same idiom as
// protectionMoneyLastProcMs above.
export const shieldBashLastProcMs = new WeakMap<Item, number>();
// Brace: hits-taken counter, reset on FIGHT_START — same idiom as coatedEdgeCounters above.
export const braceCounters = new WeakMap<Item, number>();
// Bulk Discount: undiscounted price/sellPrice per SHOP item, captured the first tick a slot is
// seen. Every later tick recomputes from this stable base rather than the shop item's current
// (possibly already-discounted) price — aura fires every 1s, so subtracting from the live price
// each tick would compound the discount down to 0 within a few seconds. A slot rebuilt into a
// new Item object (rebuildShopSlot/revalidateUpgradePreviews) is a fresh WeakMap key, so it
// re-captures a correct undiscounted base automatically.
export const bulkDiscountBasePrices = new WeakMap<Item, { price: number; sellPrice: number }>();

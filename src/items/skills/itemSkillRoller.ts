// Rolls and grants class-item skills. Called from ShopUpgradeUtils.applyRarityUpgrade the
// moment a class item's rarity crosses into Legendary — see that file for the hook.

import { Item } from '../schema/ItemSchema';
import { Player } from '../../players/schema/PlayerSchema';
import { ItemClass, ItemRarity, ItemType } from '../types/ItemTypes';
import { ITEM_SKILLS, ItemSkillDefinition, POTION_SKILLS, SHIELD_SKILLS, SKILLS_BY_CLASS } from '../behavior/itemSkillBalance';

/** Deterministic hash-to-[0,1) — NOT Math.random(). Legendary shop-preview slots
 *  (DraftRoom.updateShop / revalidateUpgradePreviews) rebuild on every 1s aura tick and on
 *  every buy/sell/drink; a random roll would make the displayed skill flicker constantly. This
 *  seed is stable for as long as (playerId, itemId, skillRollNonce) doesn't change — i.e. for the
 *  item's whole life once it leaves the shop (DraftRoom.updateShop stamps a fresh
 *  item.skillRollNonce on every unowned shop slot on every reroll, so the preview can change
 *  before purchase, then freezes the instant the item is bought/owned) — so an owned item's
 *  preview always shows exactly what buying/upgrading it will grant. */
function seededRandom(...parts: number[]): number {
  let h = 2166136261;
  for (const p of parts) {
    h ^= Math.trunc(p);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** True when `def` is still a legal roll for `item` — i.e. it's in `item`'s pool (class/shield)
 *  and at least one of its `slots` overlaps `item.equipOptions`. Shared by rollItemSkill's own
 *  filter and refreshFutureItemSkill's latch check, so a rebalance that moves a skill out of an
 *  item's eligible slots is honored the same way in both places. */
export function isSkillEligibleForItem(def: ItemSkillDefinition, item: Item): boolean {
  const pool = item.type === ItemType.SHIELD ? SHIELD_SKILLS : SKILLS_BY_CLASS[item.class as ItemClass];
  if (!pool || !pool.includes(def)) return false;
  const equipOptions = new Set(Array.from(item.equipOptions));
  return def.slots.some((s) => equipOptions.has(s));
}

/** Rolls a skill for `item` from its pool — the shield-only pool for any ItemType.SHIELD
 *  (regardless of `class`, which shields leave empty), otherwise its `class`'s pool — filtered
 *  to slots the item can actually be equipped in (an ON_ATTACK skill on a helmet would never
 *  fire — see itemSkillBalance.ts). Returns null for non-class, non-shield items or an item whose
 *  equipOptions don't overlap any skill's slot list.
 *
 *  Spread fix: narrows the eligible pool to whichever skill(s) this player has used the LEAST
 *  among their other owned items before doing the seeded pick (falling back to an even seeded
 *  pick only among ties), instead of sampling uniformly across the whole pool every time. Sampling
 *  independently per item let several items land on the same popular skill while another skill
 *  never showed up on anything the player owned. Counts items that have ALREADY been granted a
 *  real skillId/skillId2, AND other items' LATCHED futureSkillId previews (see
 *  refreshFutureItemSkill) — a latched preview is exactly as stable as a real grant within one
 *  tick, so counting it here is what keeps two simultaneously-previewing items from both landing
 *  on the same popular skill. An unlatched preview is never visible to countUsage, since latching
 *  happens before any of this player's OTHER items get a chance to re-roll in the same tick. */
export function rollItemSkill(item: Item, player: Player, options?: { exclude?: number }): ItemSkillDefinition | null {
  // Quest items (e.g. Gambler's Dice, tagged 'merchant' for set-bonus purposes only) run their
  // own bespoke rarity/behavior progression outside applyRarityUpgrade's Legendary gate — same
  // reasoning as Weapon Whisperer's quest-tag guard (TalentBehaviors.ts) — so they must never
  // enter the class-skill pool, whether for a real grant or a futureSkill preview.
  if (item.tags?.includes('quest')) return null;
  const pool = item.type === ItemType.SHIELD ? SHIELD_SKILLS : SKILLS_BY_CLASS[item.class as ItemClass];
  if (!pool || pool.length === 0) return null;

  const equipOptions = new Set(Array.from(item.equipOptions));
  let slotEligible = pool.filter((def) => def.slots.some((s) => equipOptions.has(s)));
  // Weapon Whisperer's second skill slot excludes whatever slot 1 already rolled, so the two
  // skills on the same weapon are never identical.
  if (options?.exclude) slotEligible = slotEligible.filter((def) => def.id !== options.exclude);
  if (slotEligible.length === 0) return null;

  const usage = new Map<number, number>(slotEligible.map((def) => [def.id, 0]));
  const countUsage = (i: Item) => {
    if (i === item) return;
    if (i.skillId && usage.has(i.skillId)) usage.set(i.skillId, usage.get(i.skillId)! + 1);
    if (i.skillId2 && usage.has(i.skillId2)) usage.set(i.skillId2, usage.get(i.skillId2)! + 1);
    if (!i.skillId && i.futureSkillId && usage.has(i.futureSkillId)) usage.set(i.futureSkillId, usage.get(i.futureSkillId)! + 1);
  };
  player.equippedItems.forEach(countUsage);
  player.inventory.forEach(countUsage);
  const minUsage = Math.min(...slotEligible.map((def) => usage.get(def.id)!));
  const leastUsed = slotEligible.filter((def) => usage.get(def.id) === minUsage);

  // Count owned copies of this same itemId that have already rolled a skill, so two copies of
  // one item don't always land on the identical skill among the tied candidates above (the seed
  // below is otherwise a pure function of playerId+itemId). Stable across the 1s aura-tick
  // preview rebuilds — a granted skillId is latched (see applyRarityUpgrade's `if
  // (!target.skillId)` guard) and persisted, so this never flickers the shop the way an
  // inventory-index discriminator would. Excludes dual-wield ghost copies, which clone skillId
  // from the real weapon rather than rolling.
  let copyIndex = 0;
  const countCopy = (i: Item) => {
    if (i !== item && i.itemId === item.itemId && i.skillId && !i.tags?.includes('dual_wield_copy')) copyIndex++;
  };
  player.equippedItems.forEach(countCopy);
  player.inventory.forEach(countCopy);

  const seed = seededRandom(player.playerId, item.itemId, ItemRarity.LEGENDARY, copyIndex, item.skillRollNonce || 0);
  const index = Math.min(Math.floor(seed * leastUsed.length), leastUsed.length - 1);
  return leastUsed[index];
}

/** Locks in a rolled skill on `item`: sets the display fields and unions the skill's trigger
 *  types onto item.triggerTypes (deduped — some class items, e.g. every warrior shield, already
 *  carry triggers of their own). Idempotent-safe to call again for the same def. */
export function grantItemSkill(item: Item, def: ItemSkillDefinition): void {
  item.skillId = def.id;
  item.skillName = def.name;
  item.skillDescription = def.describe(item.rarity);
  def.triggerTypes.forEach((t) => {
    if (!item.triggerTypes.includes(t)) item.triggerTypes.push(t);
  });
}

/** Weapon Whisperer's second skill slot (ItemSchema.ts's skillId2/skillName2/skillDescription2)
 *  — same shape as grantItemSkill above, targeting the "2" fields. The only granter of slot 2;
 *  normal rarity-upgrade progression (ShopUpgradeUtils.applyRarityUpgrade) never touches it. */
export function grantItemSkill2(item: Item, def: ItemSkillDefinition): void {
  item.skillId2 = def.id;
  item.skillName2 = def.name;
  item.skillDescription2 = def.describe(item.rarity);
  def.triggerTypes.forEach((t) => {
    if (!item.triggerTypes.includes(t)) item.triggerTypes.push(t);
  });
}

/** Grants a shield its skill if it doesn't have one yet — the shield equivalent of
 *  ShopUpgradeUtils.applyRarityUpgrade's class-item skill roll, except shields roll from
 *  Common (no rarity gate) since they're replacing a mechanic that already worked at every
 *  rarity. No-op for non-shields or a shield that already rolled (the `!item.skillId` latch
 *  makes this idempotent and safe to call every aura tick — see call sites in
 *  DraftAuraTriggerCommand, Player.ts, DraftRoom.rebuildShopSlot and Shady Shields). */
/** Grants a Health Flask (or any item.type === 'potion') its brew if it doesn't have one yet —
 *  same idempotent-latch shape as ensureShieldSkill above, called from the same sweep sites plus
 *  DraftRoom.rebuildShopSlot. Deliberately does NOT go through rollItemSkill: a potion is a
 *  one-shot consumable, not gear the player builds around, so there's no `slots` filter and no
 *  least-used spread to coordinate against other owned items — just a flat seeded pick across
 *  POTION_SKILLS. Reroll agency comes from item.skillRollNonce exactly like class/shield skills:
 *  DraftRoom.updateShop stamps a fresh nonce on every unowned shop slot per shop build, so a
 *  flask's brew changes on reroll and freezes the moment it's bought. */
export function ensurePotionEffect(item: Item, player: Player): void {
  if (item.type !== 'potion' || item.skillId) return;
  if (POTION_SKILLS.length === 0) return;
  const seed = seededRandom(player.playerId, item.itemId, item.skillRollNonce || 0);
  const index = Math.min(Math.floor(seed * POTION_SKILLS.length), POTION_SKILLS.length - 1);
  const def = POTION_SKILLS[index];
  grantItemSkill(item, def);
  // A flask is titled by what it does — "Stoneskin", "Antidote", etc. — rather than the generic
  // Mongo template name, since the template covers seven different rolled effects now. Latched by
  // the same `!item.skillId` guard above, so this only ever happens once per item.
  item.name = def.name;
}

export function ensureShieldSkill(item: Item, player: Player): void {
  if (item.type !== ItemType.SHIELD || item.skillId) return;
  const def = rollItemSkill(item, player);
  if (def) grantItemSkill(item, def);
}

/** Re-describes an already-granted skill at the item's current rarity — called on the
 *  Legendary -> Mythic step so the tooltip reflects the stronger tier's numbers. */
export function refreshItemSkillDescription(item: Item): void {
  if (!item.skillId) return;
  const def = ITEM_SKILLS[item.skillId];
  if (!def) return;
  item.skillDescription = def.describe(item.rarity);
}

/** Re-syncs a persisted item's skill display fields and triggerTypes against the CURRENT
 *  ITEM_SKILLS table — called on every DB->schema load (Player.ts's buildItemSchema,
 *  Item.ts's getItemSchemaObject) so a rebalanced/renamed skill (e.g. Shadowstep, War Chest)
 *  doesn't keep showing a stale name/description from whatever table was live when the item
 *  was granted, or silently stop firing because it's missing a newly-added trigger type. A
 *  no-op for items with no skillId, or a skillId ITEM_SKILLS no longer defines (in which case
 *  the stale display fields are left alone rather than guessed at). Triggers are only ever
 *  added, never pruned — items can carry their own unrelated triggerTypes. */
export function reconcileItemSkill(item: Item): void {
  if (!item.skillId) return;
  const def = ITEM_SKILLS[item.skillId];
  if (!def) return;
  item.skillName = def.name;
  item.skillDescription = def.describe(item.rarity);
  // Potions are titled by their rolled effect (see ensurePotionEffect) — re-sync that too, same
  // "don't show a stale name after a future rebalance renames the skill" reasoning this whole
  // function exists for.
  if (item.type === 'potion') item.name = def.name;
  def.triggerTypes.forEach((t) => {
    if (!item.triggerTypes.includes(t)) item.triggerTypes.push(t);
  });
}

/** Slot-2 counterpart of reconcileItemSkill — re-syncs Weapon Whisperer's second granted skill
 *  against the current ITEM_SKILLS table on every DB->schema load. No-op for the vast majority
 *  of items, which never had a second skill granted. */
export function reconcileItemSkill2(item: Item): void {
  if (!item.skillId2) return;
  const def = ITEM_SKILLS[item.skillId2];
  if (!def) return;
  item.skillName2 = def.name;
  item.skillDescription2 = def.describe(item.rarity);
  def.triggerTypes.forEach((t) => {
    if (!item.triggerTypes.includes(t)) item.triggerTypes.push(t);
  });
}

/** Fills item.futureSkill*(Id/Name/Description) with the skill this class item WILL roll once it
 *  reaches Legendary. LATCHED: once a real skill has been picked for this item (item.futureSkillId
 *  set), that same id is kept and only re-described from the current ITEM_SKILLS table — it is
 *  never re-rolled. This is what makes the shop-preview text an actual promise: without the latch,
 *  every other owned item genuinely rolling a real skill shifts rollItemSkill's least-used pool
 *  (see its doc comment) and silently changes what THIS item was shown to grant. The very first
 *  time this runs for an item (no existing futureSkillId, or one that's no longer a legal roll —
 *  e.g. a rebalance moved it out of this item's slots) it calls rollItemSkill for a fresh pick,
 *  same coordinated-spread reasoning as before. Clears the fields once they're no longer
 *  meaningful: shields (which already roll from Common — no "future" state for them), a non-class
 *  item, or an item that already has a real skillId (the real skill supersedes the preview) or has
 *  already reached Legendary. Cheap and idempotent — safe to call every aura tick, same contract
 *  as ensureShieldSkill; called from exactly the same sweep sites. */
export function refreshFutureItemSkill(item: Item, player: Player): void {
  const eligible = item.type !== ItemType.SHIELD && !!item.class && !item.skillId && item.rarity < ItemRarity.LEGENDARY;
  if (!eligible) {
    if (item.futureSkillId) {
      item.futureSkillId = 0;
      item.futureSkillName = '';
      item.futureSkillDescription = '';
    }
    return;
  }

  if (item.futureSkillId) {
    const latched = ITEM_SKILLS[item.futureSkillId];
    if (latched && isSkillEligibleForItem(latched, item)) {
      item.futureSkillName = latched.name;
      item.futureSkillDescription = latched.describe(ItemRarity.LEGENDARY);
      return;
    }
    // Latch is no longer valid (skill removed/rebalanced out of this item's slots) — fall through
    // to a fresh roll rather than keep showing a promise this item can never actually fire.
  }

  const def = rollItemSkill(item, player);
  if (!def) {
    if (item.futureSkillId) {
      item.futureSkillId = 0;
      item.futureSkillName = '';
      item.futureSkillDescription = '';
    }
    return;
  }
  item.futureSkillId = def.id;
  item.futureSkillName = def.name;
  item.futureSkillDescription = def.describe(ItemRarity.LEGENDARY);
}

// Rolls and grants class-item skills. Called from ShopUpgradeUtils.applyRarityUpgrade the
// moment a class item's rarity crosses into Legendary — see that file for the hook.

import { Item } from '../schema/ItemSchema';
import { Player } from '../../players/schema/PlayerSchema';
import { ItemClass, ItemRarity, ItemType } from '../types/ItemTypes';
import { ITEM_SKILLS, ItemSkillDefinition, POTION_SKILLS, SHIELD_SKILLS, SKILLS_BY_CLASS } from '../behavior/itemSkillBalance';

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
 *  Uniform random pick across the slot-eligible pool — no coordination against the player's other
 *  items. Two items (or two copies of the same item) can land on the same skill; that's by design.
 *  Safe to call with `Math.random()` rather than a seeded hash because every caller latches the
 *  result the moment it's rolled (refreshFutureItemSkill for the preview, applyRarityUpgrade for
 *  the real grant) instead of re-rolling on every tick — see refreshFutureItemSkill's doc comment. */
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

  return slotEligible[Math.floor(Math.random() * slotEligible.length)];
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
 *  one-shot consumable, not gear the player builds around, so there's no `slots` filter to apply —
 *  just a flat random pick across POTION_SKILLS, latched by the `!item.skillId` guard below the
 *  moment it's rolled (a fresh shop roll is a new object with skillId unset, so rerolling still
 *  varies the brew on offer; buying/owning freezes it). */
export function ensurePotionEffect(item: Item, player: Player): void {
  if (item.type !== 'potion' || item.skillId) return;
  if (POTION_SKILLS.length === 0) return;
  const def = POTION_SKILLS[Math.floor(Math.random() * POTION_SKILLS.length)];
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
 *  reaches Legendary. LATCHED: the first time this runs for an item (no existing futureSkillId, or
 *  one that's no longer a legal roll — e.g. a rebalance moved it out of this item's slots), it
 *  calls rollItemSkill for a fresh uniform-random pick and keeps that id from then on, only
 *  re-describing it from the current ITEM_SKILLS table on later calls. This is what makes the
 *  shop-preview text an actual promise instead of a value that could be re-rolled out from under
 *  the player on the next aura tick. Clears the fields once they're no longer meaningful: shields
 *  (which already roll from Common — no "future" state for them), a non-class item, or an item
 *  that already has a real skillId (the real skill supersedes the preview) or has already reached
 *  Legendary. Cheap and idempotent — safe to call every aura tick, same contract as
 *  ensureShieldSkill; called from exactly the same sweep sites. */
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

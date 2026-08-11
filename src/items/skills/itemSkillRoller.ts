// Rolls and grants class-item skills. Called from ShopUpgradeUtils.applyRarityUpgrade the
// moment a class item's rarity crosses into Legendary — see that file for the hook.

import { Item } from '../schema/ItemSchema';
import { Player } from '../../players/schema/PlayerSchema';
import { ItemClass, ItemRarity, ItemType } from '../types/ItemTypes';
import { ITEM_SKILLS, ItemSkillDefinition, SHIELD_SKILLS, SKILLS_BY_CLASS } from '../behavior/itemSkillBalance';

/** Deterministic hash-to-[0,1) — NOT Math.random(). Legendary shop-preview slots
 *  (DraftRoom.updateShop / revalidateUpgradePreviews) rebuild on every 1s aura tick and on
 *  every buy/sell/drink; a random roll would make the displayed skill flicker constantly. This
 *  seed is stable for as long as (playerId, itemId) doesn't change — i.e. for the item's whole
 *  life on that character — so the preview always shows exactly what buying it will grant. */
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

/** Rolls a skill for `item` from its pool — the shield-only pool for any ItemType.SHIELD
 *  (regardless of `class`, which shields leave empty), otherwise its `class`'s pool — filtered
 *  to slots the item can actually be equipped in (an ON_ATTACK skill on a helmet would never
 *  fire — see itemSkillBalance.ts). Duplicates are allowed by design — the same skill can be
 *  rolled regardless of what the player already owns, with no cap on how many copies they end up
 *  with. Returns null for non-class, non-shield items or an item whose equipOptions don't
 *  overlap any skill's slot list. */
export function rollItemSkill(item: Item, player: Player, options?: { exclude?: number }): ItemSkillDefinition | null {
  const pool = item.type === ItemType.SHIELD ? SHIELD_SKILLS : SKILLS_BY_CLASS[item.class as ItemClass];
  if (!pool || pool.length === 0) return null;

  const equipOptions = new Set(Array.from(item.equipOptions as any as Iterable<string>));
  let slotEligible = pool.filter((def) => def.slots.some((s) => equipOptions.has(s)));
  // Weapon Whisperer's second skill slot excludes whatever slot 1 already rolled, so the two
  // skills on the same weapon are never identical.
  if (options?.exclude) slotEligible = slotEligible.filter((def) => def.id !== options.exclude);
  if (slotEligible.length === 0) return null;

  // Count owned copies of this same itemId that have already rolled a skill, so two copies of
  // one item don't always land on the identical skill (the seed below is otherwise a pure
  // function of playerId+itemId). Stable across the 1s aura-tick preview rebuilds — a granted
  // skillId is latched (see applyRarityUpgrade's `if (!target.skillId)` guard) and persisted, so
  // this never flickers the shop the way an inventory-index discriminator would. Excludes
  // dual-wield ghost copies, which clone skillId from the real weapon rather than rolling.
  let copyIndex = 0;
  const countCopy = (i: Item) => {
    if (i !== item && i.itemId === item.itemId && i.skillId && !i.tags?.includes('dual_wield_copy')) copyIndex++;
  };
  player.equippedItems.forEach(countCopy);
  player.inventory.forEach(countCopy);

  const seed = seededRandom(player.playerId, item.itemId, ItemRarity.LEGENDARY, copyIndex);
  const index = Math.min(Math.floor(seed * slotEligible.length), slotEligible.length - 1);
  return slotEligible[index];
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

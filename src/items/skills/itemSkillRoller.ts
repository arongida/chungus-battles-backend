// Rolls and grants class-item skills. Called from ShopUpgradeUtils.applyRarityUpgrade the
// moment a class item's rarity crosses into Legendary — see that file for the hook.

import { Item } from '../schema/ItemSchema';
import { Player } from '../../players/schema/PlayerSchema';
import { ItemClass, ItemRarity } from '../types/ItemTypes';
import { ITEM_SKILLS, ItemSkillDefinition, SKILLS_BY_CLASS } from '../behavior/itemSkillBalance';

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

/** Rolls a skill for `item` from its class's pool, filtered to slots the item can actually be
 *  equipped in (an ON_ATTACK skill on a helmet would never fire — see itemSkillBalance.ts) and,
 *  per design, drawn without replacement against every skill the player currently owns on any
 *  other item (equipped or in inventory). Falls back to allowing a duplicate only if every
 *  slot-eligible skill is already owned. Returns null for non-class items or an item whose
 *  equipOptions don't overlap any skill's slot list. */
export function rollItemSkill(item: Item, player: Player): ItemSkillDefinition | null {
  const pool = SKILLS_BY_CLASS[item.class as ItemClass];
  if (!pool || pool.length === 0) return null;

  const equipOptions = new Set(Array.from(item.equipOptions as any as Iterable<string>));
  const slotEligible = pool.filter((def) => def.slots.some((s) => equipOptions.has(s)));
  if (slotEligible.length === 0) return null;

  const owned = new Set<number>();
  player.equippedItems.forEach((i) => { if (i.skillId) owned.add(i.skillId); });
  player.inventory.forEach((i) => { if (i.skillId) owned.add(i.skillId); });

  const candidates = slotEligible.filter((def) => !owned.has(def.id));
  const pickFrom = candidates.length > 0 ? candidates : slotEligible;

  const seed = seededRandom(player.playerId, item.itemId, ItemRarity.LEGENDARY);
  const index = Math.min(Math.floor(seed * pickFrom.length), pickFrom.length - 1);
  return pickFrom[index];
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

/** Re-describes an already-granted skill at the item's current rarity — called on the
 *  Legendary -> Mythic step so the tooltip reflects the stronger tier's numbers. */
export function refreshItemSkillDescription(item: Item): void {
  if (!item.skillId) return;
  const def = ITEM_SKILLS[item.skillId];
  if (!def) return;
  item.skillDescription = def.describe(item.rarity);
}

import { Item } from '../items/schema/ItemSchema';
import { Player } from '../players/schema/PlayerSchema';
import { ItemRarity, ItemType } from '../items/types/ItemTypes';
import { cloneItem } from '../items/db/Item';
import { rollItemStats } from '../items/stats/itemStatRoller';
import { TalentType } from '../talents/types/TalentTypes';
import { ensureShieldSkill, grantItemSkill, isSkillEligibleForItem, refreshFutureItemSkill, refreshItemSkillDescription, rollItemSkill } from '../items/skills/itemSkillRoller';
import { ITEM_SKILLS } from '../items/behavior/itemSkillBalance';
import {
  BURN_DAMAGE_PER_STACK,
  BURN_DURATION_MS,
  chungiHpDamageFraction,
  floweringStaffCooldownReduction,
  floweringStaffRegenSteal,
  FLOWERING_STAFF_MAX_STEAL,
  frostbiteChillThreshold,
  frostbiteFreezeMs,
  magicRingCooldownReduction,
  magicWandCooldownReduction,
  NON_UPGRADEABLE_ITEM_IDS,
  scytheSoulValue,
  secondWindHealFraction,
  secondWindInvulnMs,
  SECOND_WIND_THRESHOLD,
  selfBurnStacks,
  TWO_HANDED_WEAPON_IDS,
  wandOfFireBurnStacks,
} from '../items/behavior/uniqueItemBalance';
import { POISON_DAMAGE_PER_STACK_FRACTION, POISON_DURATION_MS } from '../common/poisonBalance';

// Note: Health Flask (6) has no entry here — its rarity is pinned to Common (it's in
// NON_UPGRADEABLE_ITEM_IDS and excluded from shop lucky-find), so updateRarityDescription's
// `rarity <= 1` guard means it would never fire; the DB-authored description is always accurate.
const itemDescriptionUpdaters: Partial<Record<number, (item: Item, player: Player) => string>> = {
  7: (item) => `Max damage equals ${Math.round(chungiHpDamageFraction(item.rarity) * 100)}% of your max HP.`,
  8: (item) => {
    const steal = floweringStaffRegenSteal(item.rarity).toFixed(2);
    return `2-handed — Every 2s, steals ${steal} hp regen from the enemy (up to ${FLOWERING_STAFF_MAX_STEAL} total).`;
  },
  14: (item) => {
    const stacks = wandOfFireBurnStacks(item.rarity);
    const selfStacks = selfBurnStacks(stacks);
    return `Every 2s, ignites the enemy with ${stacks} burn stack${stacks > 1 ? 's' : ''} and yourself with ${selfStacks} (${BURN_DAMAGE_PER_STACK} damage per stack per second, for ${BURN_DURATION_MS / 1000}s).`;
  },
  702: (item) => `Every 1s during battle: Gains bonus stats. Evolves on level up.`,
  18: (item) => {
    const stacks = item.rarity;
    const totalHpPct = parseFloat((POISON_DAMAGE_PER_STACK_FRACTION * 100 * (POISON_DURATION_MS / 1000)).toFixed(2));
    return `Applies ${stacks} poison stack${stacks > 1 ? 's' : ''} on hit. Each stack deals ${totalHpPct}% max HP over ${POISON_DURATION_MS / 1000}s. Any poison halves healing.`;
  },
  59: (item) => `2-handed — Cannot be blocked or absorbed. Each hit reaps a soul: +${scytheSoulValue(item.rarity)} max damage for the rest of the fight.`,
  703: (item) => {
    const multiplier = item.rarity / 2;
    return multiplier === 1
      ? 'Max damage equals your current income.'
      : `Max damage equals ${multiplier}x your current income.`;
  },
  27: (item) => {
    const healPct = Math.round(secondWindHealFraction(item.rarity) * 100);
    const invulnSec = (secondWindInvulnMs(item.rarity) / 1000).toFixed(2);
    return `The first time you fall below ${Math.round(SECOND_WIND_THRESHOLD * 100)}% HP in a fight, heal ${healPct}% of your max HP and become invulnerable for ${invulnSec}s. Once per fight.`;
  },
  82: (item) => {
    const stacks = frostbiteChillThreshold(item.rarity);
    const freezeSec = (frostbiteFreezeMs(item.rarity) / 1000).toFixed(2);
    return `Every landed hit chills the enemy. At ${stacks} stacks, freeze them solid for ${freezeSec}s and reset the stacks. Freezes at most once per second.`;
  },
};

function updateRarityDescription(target: Item, player: Player): void {
  if (target.rarity <= 1) return;
  const updater = itemDescriptionUpdaters[target.itemId];
  if (updater) target.description = updater(target, player);
}

/** Returns true when this step just brought `target` to MYTHIC (i.e. it wasn't already there) —
 *  callers that represent a genuine acquisition (as opposed to rolling/previewing an unowned
 *  shop item) should react to a true return by calling grantLuckyFindMythicBonus. */
export function applyRarityUpgrade(target: Item, source: Item, player: Player, increaseSellPrice = true): boolean {
  const wasMythic = target.rarity >= ItemRarity.MYTHIC;
  target.rarity++;
  if (increaseSellPrice) target.sellPrice += source.sellPrice;
  updateRarityDescription(target, player);
  // Affixes always merge at 100% regardless of class.
  target.affectedStats.mergeInto(source.affectedStats);

  // Weapon base stats stack at 50% of the merged source's rolled values.
  // Two-handers merge max damage at 100% — their authored damage is the
  // payoff for the blocked off-hand.
  if (target.type === ItemType.WEAPON) {
    const maxDamageScale = TWO_HANDED_WEAPON_IDS.has(target.itemId) ? 1 : 0.5;
    target.baseMinDamage   += source.baseMinDamage   * 0.5;
    target.baseMaxDamage   += source.baseMaxDamage   * maxDamageScale;
    target.baseAttackSpeed += source.baseAttackSpeed * 0.5;
  }

  // Class-item skill: rolled once the moment a class item first reaches Legendary; the Mythic
  // step re-describes the same skill at its stronger tier instead of rolling again. Scoped to
  // `target.class` so unique/quest items are untouched. Runs for shop-preview clones too (see
  // DraftRoom.updateShop/rebuildShopSlot), which is why rollItemSkill is seeded deterministically
  // rather than using Math.random() — otherwise the preview would re-roll every 1s aura tick.
  //
  // Shields already carry a skill from Common (ensureShieldSkill — see its call sites), so this
  // never needs to roll one; it only needs to re-describe it here at the item's new rarity.
  if (target.type === ItemType.SHIELD) {
    refreshItemSkillDescription(target);
  } else if (target.class && target.rarity >= ItemRarity.LEGENDARY) {
    if (!target.skillId) {
      // Honor whatever the shop/inventory preview already promised (item.futureSkillId — see
      // refreshFutureItemSkill's latch) rather than rolling fresh here: a fresh roll is
      // independently random and would silently grant a different skill than the one the player
      // was shown. Only falls back to a genuine roll when there's no usable latch — quest items,
      // shields (routed through the branch above), or an item that reached Legendary without ever
      // previewing (e.g. a talent instantly maxing an item's rarity).
      const latched = target.futureSkillId ? ITEM_SKILLS[target.futureSkillId] : null;
      const def = latched && isSkillEligibleForItem(latched, target) ? latched : rollItemSkill(target, player);
      if (def) grantItemSkill(target, def);
    } else {
      refreshItemSkillDescription(target);
    }
  }
  // Legendary skill preview (item.futureSkill*): re-synced on every upgrade step, not just the
  // Legendary one — it needs to clear the moment a real skillId lands, and it's a no-op below
  // Legendary anyway (refreshFutureItemSkill's own eligibility check), so one unconditional call
  // covers both without duplicating the branching above.
  refreshFutureItemSkill(target, player);

  return !wasMythic && target.rarity >= ItemRarity.MYTHIC;
}

/** Permanent Lucky Find chance granted per Mythic forged. Percent form exists so the ~9
 *  user-facing log strings can't drift from the number actually applied. */
export const LUCKY_FIND_MYTHIC_BONUS = 0.02;
export const LUCKY_FIND_MYTHIC_BONUS_PERCENT = LUCKY_FIND_MYTHIC_BONUS * 100;

/** Permanently grants the Lucky Find Mythic-acquisition bonus (PlayerSchema.luckyFindMythicBonus)
 *  — call exactly once per NEW Mythic item genuinely obtained (shop buy/upgrade, loss-reward item
 *  upgrade, or a talent/item instantly maxing an owned/equipped item to Mythic). Deliberately NOT
 *  called for shop-preview rolling (DraftRoom.updateShop, applyLuckyShopUpgrades, Gold Genie's
 *  shop-item floor) since those items haven't been acquired yet — the bonus is earned at the
 *  moment of purchase (DraftRoom.buyItem), not when an un-bought shop slot happens to roll high.
 *  Does not send any message — callers own their own room-appropriate celebration (draft_log or
 *  combat_log, plus a `reward_gain` with `luckyFind: true` for the avatar fireworks/floating
 *  text), since the right message type differs between DraftRoom and FightRoom. */
export function grantLuckyFindMythicBonus(player: Player): void {
  player.luckyFindMythicBonus += LUCKY_FIND_MYTHIC_BONUS;
  // Bump the live displayed chance immediately too — the next aura tick will re-seed it from
  // base+bonus anyway, but this avoids a brief window where the badge lags.
  player.luckyFindChance += LUCKY_FIND_MYTHIC_BONUS;
}

/** Base (un-modified) lucky-find rarity-up chance for a shop slot at this level.
 *  Seeded onto Player.luckyFindChance each draft aura tick (DraftAuraTriggerCommand)
 *  and once at draft-phase setup (DraftRoom.setUpState) — talents (e.g. Black Market
 *  Contact, TalentBehaviors) may then scale that hidden stat before it's read below. */
export function baseLuckyFindChance(level: number): number {
  return 0.10 + 0.02 * (level - 1);
}

/** Base (un-modified) shop reroll cost, seeded onto Player.refreshShopCost each draft
 *  aura tick and at draft setup; talents (Comrade +income, VIP Pass surcharge) then adjust it. */
export const BASE_REFRESH_SHOP_COST = 2;

/** Bargain Hunter's free shop rerolls granted per round (contributed into
 *  Player.freeRerollGrant, stacking additively with the Haggler item skill — see
 *  TalentBehaviors.ts and DraftAuraTriggerCommand). */
export const BARGAIN_HUNTER_FREE_REROLLS = 3;

/** Base (un-modified) active-potion capacity, seeded onto Player.potionCapacity each draft aura
 *  tick before aura talents run; Flash Sale (MERCHANT_1) adds to it while owned — see
 *  DraftRoom.drinkItem for where the cap is actually enforced. */
export const BASE_POTION_CAPACITY = 1;

/**
 * Lucky shop rolls: each shop slot has a chance — Player.luckyFindChance, seeded from
 * baseLuckyFindChance and potentially scaled by talents — to arrive at a higher rarity.
 * Every successful step re-rolls the chance, so an item can chain up to MYTHIC. Each step
 * merges a freshly rolled copy of the item template — same mechanic as the tier-5
 * instant-mythic talents.
 *
 * `source` must be the template-shaped roll for this slot (not the upgraded
 * target) so authored-stat items don't compound their already-merged stats.
 * Price grows by 50% of the slot's pre-upgrade price per step.
 *
 * Returns the number of rarity steps applied.
 */
export function applyLuckyShopUpgrades(target: Item, source: Item, player: Player): number {
  const chance = player.luckyFindChance;

  let wantedSteps = 0;
  while (target.rarity + wantedSteps < ItemRarity.MYTHIC && Math.random() < chance) {
    wantedSteps++;
  }
  return applyExtraRaritySteps(target, source, player, wantedSteps);
}

/**
 * Applies exactly `steps` rarity steps to `target` by merging freshly rolled copies of
 * `source` (stopping early at MYTHIC), then re-prices the slot for the steps actually
 * applied. Shared by applyLuckyShopUpgrades (chance-rolled steps) and
 * DraftRoom.rebuildShopSlot (restoring a preview's already-rolled lucky steps).
 *
 * Returns the number of steps actually applied (may be less than `steps` if MYTHIC
 * was hit first).
 */
export function applyExtraRaritySteps(target: Item, source: Item, player: Player, steps: number): number {
  if (steps <= 0) return 0;
  const pristine = cloneItem(source);
  const basePrice = target.price;

  let applied = 0;
  while (applied < steps && target.rarity < ItemRarity.MYTHIC) {
    const rolled = cloneItem(pristine);
    rollItemStats(rolled);
    applyRarityUpgrade(target, rolled, player, false);
    applied++;
  }
  if (applied > 0) {
    target.price = Math.round(basePrice * (1 + 0.5 * applied));
    target.sellPrice = Math.floor(target.price * 0.7);
  }
  return applied;
}

/** Equipped items eligible for a rarity upgrade. Skips non-upgradeable ids,
 *  quest items (own rarity progression), synthetic itemId-0 fists (Martial
 *  Artist's martial_fist and the plain unarmed fist — never in the DB, so
 *  getItemById would return null for them) and MYTHIC items. Entries carry
 *  their slot key for the MapSchema re-set gotcha. */
export function getEquippedUpgradeableItems(player: Player): Array<{ item: Item; slot: string }> {
  const candidates: Array<{ item: Item; slot: string }> = [];

  player.equippedItems.forEach((item, slot) => {
    if (
      item.itemId > 0 &&
      !NON_UPGRADEABLE_ITEM_IDS.has(item.itemId) &&
      !item.tags?.includes('quest') &&
      !item.tags?.includes('dual_wield_copy') &&
      item.rarity < ItemRarity.MYTHIC
    ) {
      candidates.push({ item, slot });
    }
  });

  return candidates;
}

/** Sum of remaining rarity steps (to MYTHIC) across all upgrade-eligible equipped
 *  items — the ceiling on how many rarity-upgrade rolls can actually land, since
 *  each roll bumps one item by exactly one step. */
export function totalRemainingRaritySteps(player: Player): number {
  return getEquippedUpgradeableItems(player)
    .reduce((sum, { item }) => sum + (ItemRarity.MYTHIC - item.rarity), 0);
}

/** Gold added to Player.refreshShopCost per reroll while VIP Pass is owned — its membership fee.
 *  Applied as a delta, like Comrade's +income. */
export const VIP_PASS_REROLL_SURCHARGE = 1;

/** True when the player owns VIP Pass (202), which guarantees at least one shop slot is an item
 *  the player already owns — see DraftRoom.updateShop. */
export function hasVipPass(player: Player): boolean {
  return player.talents?.some((t) => t.talentId === TalentType.VIP_PASS) ?? false;
}

/** Distinct itemIds the player currently owns (equipped ∪ inventory) that are eligible for a
 *  rarity upgrade — i.e. findOwnedUpgradeTarget would return non-null for them. Backs VIP Pass's
 *  guaranteed-owned-item shop slot: DraftRoom.updateShop picks a random id from this list and
 *  rolls its DB template into an empty slot, which the normal upgrade-preview construction below
 *  then turns into a preview. Delegates eligibility to findOwnedUpgradeTarget itself (rather than
 *  re-implementing the MYTHIC/dual_wield_copy/NON_UPGRADEABLE_ITEM_IDS rules here) so the two
 *  can't drift apart. */
export function getOwnedUpgradeableItemIds(player: Player): number[] {
  const ids = new Set<number>();
  player.equippedItems.forEach((item) => { if (item.itemId > 0) ids.add(item.itemId); });
  player.inventory.forEach((item) => { if (item.itemId > 0) ids.add(item.itemId); });
  return Array.from(ids).filter((id) => findOwnedUpgradeTarget(player, id) !== null);
}

/** Shared by Misconduct, Robbery and Grand Robbery: takes a shop item for free.
 *  With `upgrade` set, the item first gains one rarity step (which also raises its
 *  price by 50%), then always sells for 100% of its final price.
 *  Returns the rarity steps applied and whether this steal newly forged a Mythic,
 *  so the caller can send its own draft_log / reward_gain celebration. */
export function stealShopItem(
  item: Item, player: Player, upgrade: boolean, reduceIncome: boolean = true
): { steps: number; becameMythic: boolean } {
  let steps = 0;
  const upgradeable = !NON_UPGRADEABLE_ITEM_IDS.has(item.itemId) && item.rarity < ItemRarity.MYTHIC;
  if (upgrade && upgradeable) {
    steps = applyExtraRaritySteps(item, item, player, 1);
  }
  const becameMythic = steps > 0 && item.rarity >= ItemRarity.MYTHIC;
  player.gold += item.price;    // refund AFTER re-pricing so getItem nets to free
  player.getItem(item);         // debits item.price, marks sold, handles preview replacement
  item.sellPrice = item.price;  // stolen items sell for full price
  if (player.baseStats.income > 0 && reduceIncome) player.baseStats.income -= 1;
  return { steps, becameMythic };
}

export function findOwnedUpgradeTarget(player: Player, itemId: number): Item | null {
  if (NON_UPGRADEABLE_ITEM_IDS.has(itemId)) {
    return null;
  }

  const candidates: Item[] = [];

  player.equippedItems.forEach((item) => {
    if (item.itemId === itemId && item.rarity < ItemRarity.MYTHIC && !item.tags?.includes('dual_wield_copy')) {
      candidates.push(item);
    }
  });

  player.inventory.forEach((item) => {
    if (item.itemId === itemId && item.rarity < ItemRarity.MYTHIC) {
      candidates.push(item);
    }
  });

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => b.rarity - a.rarity);
  return candidates[0];
}

// Behavior implementations for class-item skills (see itemSkillBalance.ts for the pool +
// tuning, itemSkillRoller.ts for how a skill gets rolled/granted). Wired into dispatch via
// Item.executeBehavior (ItemSchema.ts), which runs this alongside the item's normal
// ItemBehaviors entry (a shield that rolls a skill must keep its shield behavior too).
//
// Two dedicated stat fields carry skill output: item.skillAffectedStats / skillAffectedEnemyStats
// (ItemSchema.ts), NOT the item's own affectedStats/affectedEnemyStats. Those already hold the
// item's real rolled/upgraded stats (merged by ShopUpgradeUtils.applyRarityUpgrade) — writing
// continuous aura output into them would get permanently baked into the item's "true" stats the
// next time it's rarity-upgraded or saved mid-tick. skillAffectedStats is never persisted to
// Mongo (see items/db/Item.ts) and is accumulated by statsUtils.recalculatePlayerStats exactly
// like affectedStats, so aura-driven `=` writes here self-clear every tick with no FIGHT_END
// reset needed (same convention as talent auras — see TalentBehaviors.ts ZEALOT/WARRIOR_4).

import { ItemBehaviorContext } from './ItemBehaviorContext';
import { TriggerType } from '../../common/types';
import { ItemClass, ItemRarity } from '../types/ItemTypes';
import { ItemSkillType } from '../types/ItemSkillTypes';
import { ITEM_SKILLS, skillValues } from './itemSkillBalance';
import { CombatLogMessage, RewardGainMessage, fmt } from '../../common/MessageTypes';
import { OnDamageTriggerCommand } from '../../commands/triggers/OnDamageTriggerCommand';
import { applyExtraRaritySteps } from '../../commands/ShopUpgradeUtils';
import type { Item } from '../schema/ItemSchema';

// Per-fight attack counters, keyed by item instance (rebuilt fresh each fight from DB
// snapshots — same WeakMap idiom as ItemBehaviors.ts's floweringStaffLastProcMs).
const coatedEdgeCounters = new WeakMap<Item, number>();
const openingActCounters = new WeakMap<Item, number>();
const crushingBlowCounters = new WeakMap<Item, number>();
const protectionMoneyLastProcMs = new WeakMap<Item, number>();
// Bulk Discount: undiscounted price/sellPrice per SHOP item, captured the first tick a slot is
// seen. Every later tick recomputes from this stable base rather than the shop item's current
// (possibly already-discounted) price — aura fires every 1s, so subtracting from the live price
// each tick would compound the discount down to 0 within a few seconds. A slot rebuilt into a
// new Item object (rebuildShopSlot/revalidateUpgradePreviews) is a fresh WeakMap key, so it
// re-captures a correct undiscounted base automatically.
const bulkDiscountBasePrices = new WeakMap<Item, { price: number; sellPrice: number }>();

export const ItemSkillBehaviors: Record<number, (context: ItemBehaviorContext) => void> = {
  // ---------------------------------------------------------------- ROGUE ----

  [ItemSkillType.EXPLOIT_WEAKNESS]: (context) => {
    const { attacker, defender, item, client, commandDispatcher, trigger } = context;
    if (trigger !== TriggerType.ON_ATTACK || !attacker || !defender || !item) return;
    const { ratio } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const bonus = defender.defense * ratio;
    if (bonus <= 0) return;
    const damageAfterDefense = defender.getDamageAfterDefense(bonus);
    commandDispatcher?.dispatch(new OnDamageTriggerCommand(), { defender, damage: damageAfterDefense, attacker });
    defender.takeDamage(damageAfterDefense, client);
    client?.send('combat_log', {
      text: `${attacker.name}'s ${item.name} exploits ${defender.name}'s defense for ${fmt(bonus)} bonus damage!`,
      kind: 'item', attackerId: attacker.playerId, defenderId: defender.playerId, itemId: item.itemId, damage: bonus,
    } as CombatLogMessage);
  },

  [ItemSkillType.FLUID_MOTION]: (context) => {
    const { attacker, item, trigger, attackerSnapshot } = context;
    if (trigger !== TriggerType.AURA || !attacker || !item) return;
    const { ratio } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const base = attackerSnapshot ?? attacker;
    item.skillAffectedStats.accuracy = Math.ceil(Math.max(0, base.dodgeRate) * ratio);
  },

  [ItemSkillType.PLAGUE_BEARER]: (context) => {
    const { attacker, defender, item, trigger } = context;
    if (trigger !== TriggerType.AURA || !attacker || !item) return;
    if (!defender || defender.poisonStack <= 0) {
      item.skillAffectedStats.attackSpeed = 1;
      return;
    }
    const { ratioPerStack } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    item.skillAffectedStats.attackSpeed = 1 + defender.poisonStack * ratioPerStack;
  },

  [ItemSkillType.COATED_EDGE]: (context) => {
    const { defender, item, client, clock, trigger } = context;
    if (!item) return;
    if (trigger === TriggerType.FIGHT_START) {
      coatedEdgeCounters.set(item, 0);
      return;
    }
    if (trigger !== TriggerType.ON_ATTACK || !defender || !clock) return;
    const { every, stacks } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const count = (coatedEdgeCounters.get(item) ?? 0) + 1;
    coatedEdgeCounters.set(item, count);
    if (count % every !== 0) return;
    defender.addPoisonStacks(clock, client, stacks);
  },

  [ItemSkillType.SHADOWSTEP]: (context) => {
    const { defender, item, client, trigger } = context;
    if (!item) return;
    if (trigger === TriggerType.FIGHT_END) {
      item.skillAffectedStats.dodgeRate = 0;
      return;
    }
    if (trigger !== TriggerType.ON_DODGE || !defender) return;
    const { healRatio, dodgeCost } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const healed = defender.heal(Math.round(defender.maxHp * healRatio));
    if (healed > 0) client?.send('healing', { playerId: defender.playerId, healing: healed });
    // Accumulating -= write (unlike every AURA skill's self-clearing =) — the cost is meant to
    // persist for the rest of the fight; FIGHT_END above is the only reset. Clamp against the
    // live dodgeRate so this can't drive the stat negative once other sources also touch it.
    const consumed = Math.min(dodgeCost, Math.max(0, defender.dodgeRate));
    if (consumed > 0) item.skillAffectedStats.dodgeRate -= consumed;
    client?.send('combat_log', {
      text: `${defender.name}'s ${item.name} melts into the shadows: +${fmt(healed)} HP, ${consumed} dodge rate spent.`,
      kind: 'item', defenderId: defender.playerId, itemId: item.itemId,
    } as CombatLogMessage);
  },

  [ItemSkillType.OPENING_ACT]: (context) => {
    const { attacker, defender, item, client, commandDispatcher, damage, trigger } = context;
    if (!item) return;
    if (trigger === TriggerType.FIGHT_START) {
      openingActCounters.set(item, 0);
      return;
    }
    if (trigger !== TriggerType.ON_ATTACK || !attacker || !defender || !damage) return;
    const { count } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const used = openingActCounters.get(item) ?? 0;
    if (used >= count) return;
    openingActCounters.set(item, used + 1);
    // `damage` is already the post-defense damage this hit just dealt (ON_ATTACK fires before
    // takeDamage in FightRoom.tryWeaponAttack) — mirroring it as bonus damage doubles the total.
    commandDispatcher?.dispatch(new OnDamageTriggerCommand(), { defender, damage, attacker });
    defender.takeDamage(damage, client);
    client?.send('combat_log', {
      text: `${attacker.name}'s ${item.name} opens with a flourish — double damage!`,
      kind: 'item', attackerId: attacker.playerId, defenderId: defender.playerId, itemId: item.itemId, damage,
    } as CombatLogMessage);
  },

  [ItemSkillType.SMOKE_BOMB]: (context) => {
    const { attacker, defender, item, client, clock, trigger } = context;
    if (!item) return;
    if (trigger === TriggerType.FIGHT_END) {
      item.skillAffectedEnemyStats.accuracy = 0;
      return;
    }
    if (trigger !== TriggerType.FIGHT_START || !defender || !clock) return;
    const { ratio, durationMs } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const debuff = Math.round(defender.accuracy * ratio);
    item.skillAffectedEnemyStats.accuracy = -debuff;
    clock.setTimeout(() => { item.skillAffectedEnemyStats.accuracy = 0; }, durationMs);
    client?.send('combat_log', {
      text: `${attacker?.name ?? 'Smoke Bomb'}'s ${item.name} blinds ${defender.name}: -${pctText(ratio)} accuracy for ${durationMs / 1000}s!`,
      kind: 'item', attackerId: attacker?.playerId, defenderId: defender.playerId, itemId: item.itemId,
    } as CombatLogMessage);
  },

  [ItemSkillType.LIGHT_FINGERS]: (context) => {
    const { shop, item, trigger } = context;
    if ((trigger !== TriggerType.SHOP_START && trigger !== TriggerType.AFTER_REFRESH) || !shop || !item) return;
    const { count } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const unsold = Array.from(shop).filter((i) => !i.sold);
    unsold.sort((a, b) => a.price - b.price);
    unsold.slice(0, count).forEach((i) => { i.price = 0; i.sellPrice = 0; });
  },

  // -------------------------------------------------------------- WARRIOR ----

  [ItemSkillType.BATTLE_FOCUS]: (context) => {
    const { attacker, item, trigger, attackerSnapshot } = context;
    if (trigger !== TriggerType.AURA || !attacker || !item) return;
    const { ratio } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const base = attackerSnapshot ?? attacker;
    item.skillAffectedStats.accuracy = Math.ceil(Math.max(0, base.defense) * ratio);
  },

  [ItemSkillType.INTIMIDATING_PRESENCE]: (context) => {
    const { attacker, defender, item, trigger } = context;
    if (trigger !== TriggerType.AURA || !attacker || !item) return;
    if (!defender) {
      item.skillAffectedEnemyStats.attackSpeed = 1;
      return;
    }
    const { ratio } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    item.skillAffectedEnemyStats.attackSpeed = Math.max(1 - ratio, 0.3);
  },

  [ItemSkillType.TITANS_MIGHT]: (context) => {
    const { attacker, item, trigger, attackerSnapshot } = context;
    if (trigger !== TriggerType.AURA || !attacker || !item) return;
    const { divisor } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const base = attackerSnapshot ?? attacker;
    item.skillAffectedStats.strength = Math.floor(Math.max(0, base.maxHp) / divisor);
  },

  [ItemSkillType.IRON_HIDE]: (context) => {
    const { attacker, item, trigger, attackerSnapshot } = context;
    if (trigger !== TriggerType.AURA || !attacker || !item) return;
    const { divisor } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const base = attackerSnapshot ?? attacker;
    item.skillAffectedStats.defense = Math.floor(Math.max(0, base.maxHp) / divisor);
  },

  [ItemSkillType.BULWARK]: (context) => {
    const { attacker, item, client, clock, trigger, attackerSnapshot } = context;
    if (!item) return;
    if (trigger === TriggerType.AURA) {
      if (!attacker) return;
      const { hpRatio } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
      const base = attackerSnapshot ?? attacker;
      item.skillAffectedStats.maxHp = Math.round(Math.max(0, base.maxHp) * hpRatio);
      return;
    }
    if (trigger !== TriggerType.FIGHT_START || !attacker) return;
    const { invulnMs } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    if (invulnMs <= 0 || !clock) return;
    attacker.setInvincible(clock, invulnMs, client);
    client?.send('combat_log', {
      text: `${attacker.name}'s ${item.name} braces for impact: ${invulnMs / 1000}s invulnerability!`,
      kind: 'item', attackerId: attacker.playerId, itemId: item.itemId,
    } as CombatLogMessage);
  },

  [ItemSkillType.LAST_STAND]: (context) => {
    const { attacker, item, trigger, attackerSnapshot } = context;
    if (trigger !== TriggerType.AURA || !attacker || !item) return;
    const { defenseRatio, hpRegen } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const base = attackerSnapshot ?? attacker;
    const below = attacker.maxHp > 0 && attacker.hp < attacker.maxHp * 0.5;
    item.skillAffectedStats.defense = below ? Math.round(base.defense * defenseRatio) : 0;
    item.skillAffectedStats.hpRegen = below ? hpRegen : 0;
  },

  [ItemSkillType.WARLORDS_ROAR]: (context) => {
    const { attacker, defender, item, client, trigger } = context;
    if (!item) return;
    if (trigger === TriggerType.FIGHT_END) {
      item.skillAffectedEnemyStats.strength = 0;
      return;
    }
    if (trigger !== TriggerType.FIGHT_START || !attacker || !defender) return;
    const { ratio } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const reduction = Math.round(attacker.defense * ratio);
    if (reduction <= 0) return;
    item.skillAffectedEnemyStats.strength = -reduction;
    client?.send('combat_log', {
      text: `${attacker.name}'s ${item.name} lets out a warlord's roar: ${defender.name} loses ${reduction} strength!`,
      kind: 'item', attackerId: attacker.playerId, defenderId: defender.playerId, itemId: item.itemId,
    } as CombatLogMessage);
  },

  [ItemSkillType.CRUSHING_BLOW]: (context) => {
    const { attacker, defender, item, client, commandDispatcher, damage, trigger } = context;
    if (!item) return;
    if (trigger === TriggerType.FIGHT_START) {
      crushingBlowCounters.set(item, 0);
      return;
    }
    if (trigger !== TriggerType.ON_ATTACK || !attacker || !defender || !damage) return;
    const { every, ratio } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const count = (crushingBlowCounters.get(item) ?? 0) + 1;
    crushingBlowCounters.set(item, count);
    if (count % every !== 0) return;
    const bonus = damage * ratio;
    commandDispatcher?.dispatch(new OnDamageTriggerCommand(), { defender, damage: bonus, attacker });
    defender.takeDamage(bonus, client);
    client?.send('combat_log', {
      text: `${attacker.name}'s ${item.name} lands a crushing blow for ${fmt(bonus)} bonus damage!`,
      kind: 'item', attackerId: attacker.playerId, defenderId: defender.playerId, itemId: item.itemId, damage: bonus,
    } as CombatLogMessage);
  },

  // ------------------------------------------------------------- MERCHANT ----

  [ItemSkillType.HAGGLER]: (context) => {
    const { attacker, item, trigger, shop } = context;
    if (trigger !== TriggerType.AURA || !attacker || !item || !shop) return;
    const { count } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    // hagglerRerollsUsed is a per-shop-PHASE counter (reset in DraftRoom.onJoin, not per shop
    // build) — re-seeding the synced remaining-count from it each tick means a paid refresh
    // can't accidentally refund an already-spent free reroll.
    attacker.hagglerFreeRerolls = Math.max(0, count - attacker.hagglerRerollsUsed);
  },

  [ItemSkillType.STORE_CREDIT]: (context) => {
    const { attacker, item, trigger, shop } = context;
    if (trigger !== TriggerType.AURA || !attacker || !item || !shop) return;
    const { cap } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    attacker.storeCreditFreeClaim = !attacker.storeCreditClaimUsed;
    attacker.storeCreditFreeClaimCap = cap;
  },

  [ItemSkillType.CASH_BACK]: (context) => {
    const { attacker, item, client, trigger } = context;
    if (trigger !== TriggerType.ON_SELL || !attacker || !item) return;
    const { gold, xp } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    if (gold > 0) attacker.gold += gold;
    const xpGained = xp > 0 ? xp : 0;
    if (xpGained > 0) attacker.xp += xpGained;
    if (gold <= 0 && xpGained <= 0) return;
    client?.send('reward_gain', {
      playerId: attacker.playerId,
      gold: gold > 0 ? gold : undefined,
      xp: xpGained > 0 ? xpGained : undefined,
    } as RewardGainMessage);
  },

  [ItemSkillType.COMPOUND_INTEREST]: (context) => {
    const { attacker, item, trigger, attackerSnapshot } = context;
    if (trigger !== TriggerType.AURA || !attacker || !item) return;
    const { ratio } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const base = attackerSnapshot ?? attacker;
    item.skillAffectedStats.income = Math.round(Math.max(0, base.income) * ratio);
  },

  [ItemSkillType.MARKET_MANIPULATION]: (context) => {
    const { attacker, item, shop, trigger } = context;
    if ((trigger !== TriggerType.SHOP_START && trigger !== TriggerType.AFTER_REFRESH) || !attacker || !item || !shop) return;
    const { count } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const eligible = Array.from(shop).filter((i) => !i.sold && i.rarity < ItemRarity.MYTHIC);
    for (let n = 0; n < count && eligible.length > 0; n++) {
      const idx = Math.floor(Math.random() * eligible.length);
      const [picked] = eligible.splice(idx, 1);
      applyExtraRaritySteps(picked, picked, attacker, 1);
    }
  },

  [ItemSkillType.BULK_DISCOUNT]: (context) => {
    const { attacker, item, shop, trigger } = context;
    if (trigger !== TriggerType.AURA || !attacker || !item || !shop) return;
    const { perItem } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    let merchantCount = 0;
    attacker.equippedItems.forEach((i) => { if (i.class === ItemClass.MERCHANT) merchantCount++; });
    //attacker.inventory.forEach((i) => { if (i.class === ItemClass.MERCHANT) merchantCount++; });
    const discount = merchantCount * perItem;
    shop.forEach((shopItem) => {
      if (shopItem.sold) return;
      let base = bulkDiscountBasePrices.get(shopItem);
      if (!base) {
        base = { price: shopItem.price, sellPrice: shopItem.sellPrice };
        bulkDiscountBasePrices.set(shopItem, base);
      }
      shopItem.price = Math.max(0, base.price - discount);
      shopItem.sellPrice = Math.max(0, base.sellPrice - discount);
    });
  },

  [ItemSkillType.PROTECTION_MONEY]: (context) => {
    const { defender, item, client, clock, trigger } = context;
    if (trigger !== TriggerType.ON_ATTACKED || !defender || !item) return;
    const { gold, cooldownMs } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    if (cooldownMs > 0 && clock) {
      const last = protectionMoneyLastProcMs.get(item);
      if (last !== undefined && clock.elapsedTime - last < cooldownMs) return;
      protectionMoneyLastProcMs.set(item, clock.elapsedTime);
    }
    defender.gold += gold;
    client?.send('reward_gain', { playerId: defender.playerId, gold } as RewardGainMessage);
  },

  [ItemSkillType.WAR_CHEST]: (context) => {
    const { attacker, item, client, trigger } = context;
    if (!item) return;
    if (trigger === TriggerType.FIGHT_END) {
      item.skillAffectedStats.strength = 0;
      item.skillAffectedStats.defense = 0;
      return;
    }
    if (trigger !== TriggerType.FIGHT_START || !attacker) return;
    const { maxGold, strengthPerGold, defensePerGold } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const spend = Math.min(maxGold, Math.max(0, Math.floor(attacker.gold)));
    if (spend <= 0) return;
    attacker.gold -= spend;
    const strength = spend * strengthPerGold;
    const defense = spend * defensePerGold;
    item.skillAffectedStats.strength = strength;
    item.skillAffectedStats.defense = defense;
    client?.send('combat_log', {
      text: `${attacker.name}'s ${item.name} opens the war chest: ${spend} gold spent for +${strength} strength and +${defense} defense!`,
      kind: 'item', attackerId: attacker.playerId, itemId: item.itemId, goldDelta: -spend,
    } as CombatLogMessage);
  },
};

function pctText(n: number): string {
  return `${Math.round(n * 100)}%`;
}

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
import { ItemSkillType } from '../types/ItemSkillTypes';
import { ITEM_SKILLS, skillValues, BULK_DISCOUNT_MAX_DISCOUNT_FRACTION } from './itemSkillBalance';
import { CombatLogMessage, RewardGainMessage, fmt } from '../../common/MessageTypes';
import { OnDamageTriggerCommand } from '../../commands/triggers/OnDamageTriggerCommand';
import { stealShopItem } from '../../commands/ShopUpgradeUtils';
import type { Item } from '../schema/ItemSchema';
// Per-item runtime counters — moved to their own module so itemSkillStatus.ts's live status-line
// refresher can read the same state these behaviors write, see itemSkillState.ts's header comment.
import {
  coatedEdgeCounters, openingActCounters, crushingBlowCounters, protectionMoneyLastProcMs,
  shieldBashLastProcMs, braceCounters, bulkDiscountBasePrices, smokeBombUsed,
} from './itemSkillState';

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
    defender.takeDamage(damageAfterDefense, client, 'normal', 'skill');
    client?.send('combat_log', {
      text: `${attacker.name}'s ${item.name} exploits ${defender.name}'s defense for ${fmt(bonus)} bonus damage!`,
      kind: 'item', attackerId: attacker.playerId, defenderId: defender.playerId, itemId: item.itemId, damage: bonus,
    } as CombatLogMessage);
  },

  [ItemSkillType.FLUID_MOTION]: (context) => {
    const { attacker, item, trigger, attackerSnapshot } = context;
    if (trigger !== TriggerType.AURA || !attacker || !item) return;
    const { perDodgeRate } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const base = attackerSnapshot ?? attacker;
    item.skillAffectedStats.attackSpeed = 1 + Math.floor(Math.max(0, base.dodgeRate) / perDodgeRate) * 0.01;
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

  // The actual counting + empowerment (the first `count` attacks from this weapon ARE empowered
  // hits — same mechanic as Unstoppable Force / WARRIOR_3 / Crushing Blow) happens directly in
  // FightRoom.tryWeaponAttack, before the dodge roll — see its header comment for why this
  // ON_ATTACK trigger fires too late to gate the same swing. Only the FIGHT_START reset lives
  // here; ON_ATTACK is no longer in this skill's triggerTypes.
  [ItemSkillType.OPENING_ACT]: (context) => {
    const { item, trigger } = context;
    if (!item) return;
    if (trigger === TriggerType.FIGHT_START) {
      openingActCounters.set(item, 0);
    }
  },

  [ItemSkillType.SMOKE_BOMB]: (context) => {
    const { attacker, item, client, clock, trigger } = context;
    if (!item) return;
    if (trigger === TriggerType.FIGHT_END) {
      smokeBombUsed.delete(item);
      item.skillAffectedStats.dodgeRate = 0;
      if (attacker) attacker.damageDisabled = false;
      return;
    }
    // Once-per-fight conditional: only checked on AURA (every ~1s), and only fires the first
    // time it observes the attacker below the HP threshold. `clock` gates this to fight-time
    // aura ticks only — DraftAuraTriggerCommand's context never sets one, so this can't
    // accidentally fire while browsing the shop.
    if (trigger !== TriggerType.AURA || !attacker || !clock || smokeBombUsed.get(item)) return;
    const { hpThreshold, durationMs, dodgeRate } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    if (attacker.maxHp <= 0 || attacker.hp >= attacker.maxHp * hpThreshold) return;
    smokeBombUsed.set(item, true);
    item.skillAffectedStats.dodgeRate = dodgeRate;
    attacker.setVanished(clock, durationMs);
    client?.send('combat_log', {
      text: `${attacker.name}'s ${item.name} bursts — vanished for ${durationMs / 1000}s!`,
      kind: 'item', attackerId: attacker.playerId, itemId: item.itemId,
    } as CombatLogMessage);
    clock.setTimeout(() => {
      item.skillAffectedStats.dodgeRate = 0;
      client?.send('combat_log', {
        text: `${attacker.name} reappears from the smoke!`,
        kind: 'item', attackerId: attacker.playerId, itemId: item.itemId,
      } as CombatLogMessage);
    }, durationMs);
  },

  [ItemSkillType.LIGHT_FINGERS]: (context) => {
    const { attacker, shop, item, client, trigger } = context;
    if (trigger !== TriggerType.SHOP_START || !attacker || !shop || !item) return;
    const { count } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const unsold = Array.from(shop).filter((i) => !i.sold);
    unsold.sort((a, b) => a.price - b.price);
    unsold.slice(0, count).forEach((i) => {
      const originalPrice = i.price;
      // upgrade=false (steal as-is, no rarity step), reduceIncome=false (this isn't Misconduct's
      // income-for-power trade) — nets to free and drops straight into inventory/equip via
      // player.getItem inside stealShopItem.
      stealShopItem(i, attacker, false, false);
      // Stolen goods aren't quite as clean as a real purchase: sell for the normal 70% cut
      // instead of stealShopItem's default "sells for full price" (that default suits Misconduct,
      // which pays for the steal with lost income).
      i.sellPrice = Math.floor(originalPrice * 0.7);
      client?.send('draft_log', `${item.name} lifts ${i.name} from the shop — yours for free!`);
    });
  },

  // -------------------------------------------------------------- WARRIOR ----

  [ItemSkillType.BATTLE_FOCUS]: (context) => {
    const { attacker, item, trigger, attackerSnapshot } = context;
    if (trigger !== TriggerType.AURA || !attacker || !item) return;
    const { ratio } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const base = attackerSnapshot ?? attacker;
    item.skillAffectedStats.accuracy = Math.ceil(Math.max(0, base.strength) * ratio);
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
    const reduction = Math.round(defender.strength * ratio);
    if (reduction <= 0) return;
    item.skillAffectedEnemyStats.strength -= reduction;
    client?.send('combat_log', {
      text: `${attacker.name}'s ${item.name} lets out a warlord's roar: ${defender.name} loses ${reduction} strength!`,
      kind: 'item', attackerId: attacker.playerId, defenderId: defender.playerId, itemId: item.itemId,
    } as CombatLogMessage);
  },

  // The actual counting + empowerment (every `every`th attack from this weapon IS the shared
  // empowered hit — same mechanic as Unstoppable Force / WARRIOR_3) happens directly in
  // FightRoom.tryWeaponAttack, before the dodge roll — see its header comment for why this
  // ON_ATTACK trigger fires too late to gate the same swing. Only the FIGHT_START reset lives
  // here; the ON_ATTACK case is a no-op kept so legacy items that already rolled the old
  // ON_ATTACK triggerType (never pruned, see itemSkillRoller.ts) don't hit a missing case.
  [ItemSkillType.CRUSHING_BLOW]: (context) => {
    const { item, trigger } = context;
    if (!item) return;
    if (trigger === TriggerType.FIGHT_START) {
      crushingBlowCounters.set(item, 0);
    }
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

  // Insider Trading (renamed from Market Manipulation): AURA write straight into
  // Player.luckyFindChance. Purely additive (`+=`) — DraftAuraTriggerCommand re-seeds
  // luckyFindChance from base+mythic-bonus before the equipped-item aura pass runs, and applies
  // luckyFindChanceMultiplier (VIP Pass / Black Market Contact) after it, so this composes the
  // same order-independent way every other lucky-find source already does.
  [ItemSkillType.MARKET_MANIPULATION]: (context) => {
    const { attacker, item, trigger } = context;
    if (trigger !== TriggerType.AURA || !attacker || !item) return;
    const { chance } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    attacker.luckyFindChance += chance;
  },

  // Only accumulates the rate here — Player.bulkDiscountPercentPerLuckPercent is re-seeded to 0 each
  // aura tick (DraftAuraTriggerCommand) before this runs. The actual shop repricing happens in
  // DraftAuraTriggerCommand itself, AFTER luckyFindChanceMultiplier has been applied, so it always
  // reads the tick's final lucky-find value rather than racing Insider Trading's write within the
  // same equipped-item iteration (equippedItems iteration order is arbitrary).
  [ItemSkillType.BULK_DISCOUNT]: (context) => {
    const { attacker, item, trigger } = context;
    if (trigger !== TriggerType.AURA || !attacker || !item) return;
    const { percentPerLuckPercent } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    attacker.bulkDiscountPercentPerLuckPercent += percentPerLuckPercent;
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

  // ---------------------------------------------------------------- SHIELD ----
  // Rolled onto any shield (itemSkillRoller.ts's type-based branch), active from Common. In
  // ON_ATTACKED, `attacker` is the incoming striker and `defender` is the shield's owner (see
  // OnAttackedTriggerCommand.ts — it fires on the defender's equipped items); in FIGHT_START /
  // FIGHT_END / AURA, `attacker` is the shield's owner (see FightStartTriggerCommand /
  // FightEndTriggerCommand / FightAuraTriggerCommand — each side's own context always names its
  // own player `attacker`).

  [ItemSkillType.AEGIS]: (context) => {
    const { attacker, item, client, clock, trigger } = context;
    if (trigger !== TriggerType.FIGHT_START || !attacker || !clock || !item) return;
    const { invulnMs } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    attacker.setInvincible(clock, invulnMs, client);
    client?.send('combat_log', {
      text: `${attacker.name}'s ${item.name} raises Aegis: ${(invulnMs / 1000).toFixed(1)}s invulnerability!`,
      kind: 'item', attackerId: attacker.playerId, itemId: item.itemId,
    } as CombatLogMessage);
  },

  [ItemSkillType.RIPOSTE]: (context) => {
    const { attacker, defender, item, client, commandDispatcher, trigger } = context;
    if (!item) return;
    if (trigger === TriggerType.FIGHT_END) {
      item.skillAffectedStats.defense = 0;
      return;
    }
    if (trigger !== TriggerType.ON_ATTACKED || !attacker || !defender) return;
    const { ratio, defenseCost } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const rawCounter = defender.defense * ratio;
    if (rawCounter <= 0) return;
    const counterDamage = attacker.getDamageAfterDefense(rawCounter);
    commandDispatcher?.dispatch(new OnDamageTriggerCommand(), { defender: attacker, damage: counterDamage, attacker: defender });
    attacker.takeDamage(counterDamage, client, 'normal', 'skill');
    const defCost = defenseCost * defender.defense * 0.01;
    const consumed = Math.min(defCost, Math.max(0, defender.defense));
    if (consumed > 0) item.skillAffectedStats.defense -= consumed;
    client?.send('combat_log', {
      text: `${defender.name}'s ${item.name} ripostes ${attacker.name} for ${fmt(counterDamage)} damage${consumed > 0 ? ` — ${consumed} defense spent!` : '!'}`,
      kind: 'item', attackerId: defender.playerId, defenderId: attacker.playerId, itemId: item.itemId, damage: counterDamage,
    } as CombatLogMessage);
  },

  [ItemSkillType.SHIELD_WALL]: (context) => {
    const { attacker, defender, item, trigger } = context;
    if (!item) return;
    if (trigger === TriggerType.FIGHT_END) {
      item.skillAffectedStats.defense = 0;
      return;
    }
    if (trigger === TriggerType.AURA) {
      if (!attacker) return;
      const { attackSpeedPenalty } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
      // Self-clearing `=` write, same field convention as every other AURA skill — safe to share
      // skillAffectedStats with the accumulating ON_ATTACKED write below since they touch
      // disjoint fields (attackSpeed here, defense there).
      item.skillAffectedStats.attackSpeed = 1 - attackSpeedPenalty;
      return;
    }
    if (trigger !== TriggerType.ON_ATTACKED || !defender) return;
    const { defensePerHit, maxDefense } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const current = item.skillAffectedStats.defense;
    if (current >= maxDefense) return;
    item.skillAffectedStats.defense = Math.min(maxDefense, current + defensePerHit);
  },

  // ON_ATTACKED naming per the header comment above: `attacker` is the incoming striker,
  // `defender` is the shield's owner — so this stuns `attacker`, the player who just swung.
  [ItemSkillType.SHIELD_BASH]: (context) => {
    const { attacker, defender, item, client, clock, trigger } = context;
    if (!item) return;
    if (trigger === TriggerType.FIGHT_START) {
      shieldBashLastProcMs.delete(item);
      return;
    }
    if (trigger !== TriggerType.ON_ATTACKED || !attacker || !defender || !clock) return;
    const { stunMs, cooldownMs } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const last = shieldBashLastProcMs.get(item);
    if (last !== undefined && clock.elapsedTime - last < cooldownMs) return;
    shieldBashLastProcMs.set(item, clock.elapsedTime);
    attacker.setStunned(clock, stunMs, client);
    // Dedicated 'stun' kind (not 'item') so the frontend can pop a floating "Stunned!" text over
    // the stunned player, the same way 'dodge'/'block' do — see fight-animation.service.ts.
    client?.send('combat_log', {
      text: `${defender.name}'s ${item.name} bashes ${attacker.name}: stunned for ${(stunMs / 1000).toFixed(1)}s!`,
      kind: 'stun', attackerId: attacker.playerId, defenderId: defender.playerId, itemId: item.itemId,
    } as CombatLogMessage);
  },

  [ItemSkillType.BRACE]: (context) => {
    const { defender, item, trigger } = context;
    if (!item) return;
    if (trigger === TriggerType.FIGHT_START) {
      braceCounters.set(item, 0);
      return;
    }
    if (trigger !== TriggerType.ON_ATTACKED || !defender) return;
    const { every } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const count = (braceCounters.get(item) ?? 0) + 1;
    braceCounters.set(item, count);
    if (count % every !== 0) return;
    // Sets a one-shot flag instead of a timed invulnerability window — consumed by the exact
    // weapon swing that triggered ON_ATTACKED (FightRoom.tryWeaponAttack), so it can't accumulate
    // or bleed onto DoT ticks / other attacks the way a duration-based window did at high attack
    // speed. Combat log is emitted there, once the block is actually applied.
    defender.pendingBlockSource = item;
  },
};

/** Applies Bulk Discount's accumulated rate (Player.bulkDiscountPercentPerLuckPercent, written by
 *  the AURA behavior above) to every unsold shop slot, as a percentage off each item's own base
 *  price — NOT a flat gold amount, which used to let a single stacked-luck discount zero out
 *  every cheap item in the shop at once while barely touching expensive ones. Called from
 *  DraftAuraTriggerCommand AFTER luckyFindChanceMultiplier has been applied for the tick — not
 *  from the AURA behavior itself — because the discount needs to read the player's FINAL
 *  lucky-find value for this tick, and equippedItems iteration order can't guarantee Insider
 *  Trading's luckyFindChance write already happened by the time Bulk Discount's own AURA handler
 *  runs. Reuses bulkDiscountBasePrices so repeatedly discounting the live (already-discounted)
 *  price can't compound toward 0. The fraction is capped at BULK_DISCOUNT_MAX_DISCOUNT_FRACTION
 *  so even extreme stacked luck can't make the shop free. */
export function applyBulkDiscount(player: { luckyFindChance: number; bulkDiscountPercentPerLuckPercent: number }, shop: Iterable<Item>): void {
  const discountFraction = Math.min(BULK_DISCOUNT_MAX_DISCOUNT_FRACTION, player.luckyFindChance * 100 * player.bulkDiscountPercentPerLuckPercent);
  for (const shopItem of shop) {
    if (shopItem.sold) continue;
    let base = bulkDiscountBasePrices.get(shopItem);
    if (!base) {
      base = { price: shopItem.price, sellPrice: shopItem.sellPrice };
      bulkDiscountBasePrices.set(shopItem, base);
    }
    shopItem.price = Math.max(1, Math.round(base.price * (1 - discountFraction)));
    shopItem.sellPrice = Math.max(1, Math.round(base.sellPrice * (1 - discountFraction)));
  }
}

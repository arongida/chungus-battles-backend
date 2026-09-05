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
  shieldBashLastProcMs, braceCounters, bulkDiscountBasePrices, smokeBombUsed, battleFocusCounters,
  ironbloodCleansed,
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
    // No `?? attacker` fallback (see scalingGraph.ts) — a missing snapshot here would mean
    // reading the live, fully-derived dodgeRate instead of the pre-node one, silently
    // reintroducing the old self-feeding bug for any future skill that writes dodgeRate.
    if (!attackerSnapshot) {
      console.error('FLUID_MOTION fired AURA without an attackerSnapshot — skipping.');
      return;
    }
    const { perDodgeRate } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    item.skillAffectedStats.attackSpeed = 1 + Math.floor(Math.max(0, attackerSnapshot.dodgeRate) / perDodgeRate) * 0.01;
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
    const dodgeCostValue = dodgeCost * defender.dodgeRate * 0.01;
    const consumed = Math.min(dodgeCostValue, Math.max(0, defender.dodgeRate));
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

  // Reworked (Season 26): from an unconditional shop-start freebie (which just grabbed whatever
  // was cheapest — usually junk, no choice, no cost) into a sell-triggered steal: you must give
  // up an item to get one, and it costs 1 income (same tax as Misconduct/Robbery). No longer
  // capped at the sold item's price — any shop item is fair game, so the income drain is the only
  // brake left on the value gained. ON_SELL only reaches equipped items via triggerEquippedItems
  // (unlike the old SHOP_START, which also swept inventory copies) — see itemSkillBalance.ts's
  // describe().
  [ItemSkillType.LIGHT_FINGERS]: (context) => {
    const { attacker, shop, item, client, trigger, soldItem } = context;
    if (trigger !== TriggerType.ON_SELL || !attacker || !shop || !item || !soldItem) return;
    const { upgrade } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const candidates = Array.from(shop).filter((i) => !i.sold);
    if (candidates.length === 0) return;
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    const originalPrice = chosen.price;
    // upgrade (1 at Mythic, 0 at Legendary) steps the stolen item's rarity up once; reduceIncome
    // is the theft's real cost — guarded there against going below 0, same as Misconduct/Robbery.
    stealShopItem(chosen, attacker, upgrade > 0, true);
    // Stolen goods aren't quite as clean as a real purchase: sell for the normal 70% cut instead
    // of stealShopItem's default "sells for full price" — otherwise sell -> steal -> sell would be
    // a value-neutral loop instead of one that bleeds value (on top of the income cost) each pass.
    chosen.sellPrice = Math.floor(originalPrice * 0.7);
    client?.send('draft_log', `${item.name} lifts ${chosen.name} from the shop after selling ${soldItem.name} — free, but costs 1 income!`);
  },

  // -------------------------------------------------------------- WARRIOR ----

  // Reworked (Season 26): from a flat accuracy drip into a conditional anti-dodge comeback — every
  // `every`th time this player's attack is dodged, their next weapon attack is charged empowered
  // (unavoidable, +50% damage). Shares the same empoweredAttackSource flag as Unstoppable Force
  // (TalentBehaviors.ts WARRIOR_3), consumed in FightRoom.tryWeaponAttack. FIGHT_START resets the
  // per-item dodge counter (same idiom as Coated Edge/Brace); ON_ATTACK_DODGED
  // (OnDodgeTriggerCommand's attacker-side pass) increments it and charges on the Nth dodge.
  [ItemSkillType.BATTLE_FOCUS]: (context) => {
    const { attacker, item, client, trigger } = context;
    if (!item) return;
    if (trigger === TriggerType.FIGHT_START) {
      battleFocusCounters.set(item, 0);
      return;
    }
    if (trigger !== TriggerType.ON_ATTACK_DODGED || !attacker) return;
    const { every } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const count = (battleFocusCounters.get(item) ?? 0) + 1;
    battleFocusCounters.set(item, count);
    if (count % every !== 0) return;
    // Guarded like Unstoppable Force — don't clobber an attack another source already charged;
    // the dodge is still counted above either way, so the next Nth dodge tries again.
    if (attacker.empoweredAttackSource) return;
    attacker.empoweredAttackSource = item;
    client?.send('combat_log', {
      text: `${attacker.name}'s ${item.name} reads the dodge — the next attack won't miss!`,
      kind: 'item', attackerId: attacker.playerId, itemId: item.itemId,
    } as CombatLogMessage);
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
    // No `?? attacker` fallback (see scalingGraph.ts) — a missing snapshot would mean reading
    // the live, fully-derived maxHp, silently reintroducing the old self-feeding bug.
    if (!attackerSnapshot) {
      console.error('TITANS_MIGHT fired AURA without an attackerSnapshot — skipping.');
      return;
    }
    const { divisor } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    item.skillAffectedStats.strength = Math.floor(Math.max(0, attackerSnapshot.maxHp) / divisor);
  },

  // Ironblood (reworked Season 27 from Iron Hide — see itemSkillBalance.ts's header comment on
  // the old versions). Grants bonus HP regen; while poisoned, that regen cleanses stacks instead
  // of healing. `attackerSnapshot.hpRegen` already includes Last Stand's emergency regen bonus
  // when both are equipped and active, so the cleanse rate benefits from it the same tick.
  [ItemSkillType.IRONBLOOD]: (context) => {
    const { attacker, item, client, trigger, attackerSnapshot } = context;
    if (!item) return;
    if (trigger === TriggerType.FIGHT_END) {
      item.skillAffectedStats.hpRegen = 0;
      if (attacker) attacker.regenSuppressed = false;
      ironbloodCleansed.set(item, 0);
      return;
    }
    if (trigger !== TriggerType.AURA || !attacker) return;
    // No `?? attacker` fallback (see scalingGraph.ts): a missing snapshot would mean reading the
    // live, fully-derived hpRegen, which already includes this skill's OWN previous tick's
    // output — exactly the self-feeding shape this system exists to prevent.
    if (!attackerSnapshot) {
      console.error('IRONBLOOD fired AURA without an attackerSnapshot — skipping.');
      return;
    }
    const { regenBonus } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    // Self-clearing `=` write, recomputed from the pre-node snapshot every tick — it can never
    // compound on itself. Draft has no poison, so this is the only branch that ever runs there,
    // which is what makes the bonus show up in the draft stat panel like Bulwark's max HP.
    const bonus = Math.round(Math.max(0, attackerSnapshot.hpRegen) * regenBonus);
    item.skillAffectedStats.hpRegen = bonus;

    if (bonus > 0 && attacker.poisonStack > 0) {
      const cleansed = attacker.consumePoisonStacks(bonus);
      if (cleansed > 0) {
        attacker.regenSuppressed = true;
        ironbloodCleansed.set(item, (ironbloodCleansed.get(item) ?? 0) + cleansed);
        client?.send('combat_log', {
          text: `${attacker.name}'s ${item.name} burns ${cleansed} poison stack${cleansed === 1 ? '' : 's'} out of their blood!`,
          kind: 'item', attackerId: attacker.playerId, itemId: item.itemId,
        } as CombatLogMessage);
      }
    }
  },

  [ItemSkillType.BULWARK]: (context) => {
    const { attacker, item, client, clock, trigger, attackerSnapshot } = context;
    if (!item) return;
    if (trigger === TriggerType.AURA) {
      if (!attacker) return;
      // No `?? attacker` fallback (see scalingGraph.ts) — see TITANS_MIGHT above.
      if (!attackerSnapshot) {
        console.error('BULWARK fired AURA without an attackerSnapshot — skipping.');
        return;
      }
      const { hpRatio } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
      item.skillAffectedStats.maxHp = Math.round(Math.max(0, attackerSnapshot.maxHp) * hpRatio);
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
    // No `?? attacker` fallback (see scalingGraph.ts) — see TITANS_MIGHT above.
    if (!attackerSnapshot) {
      console.error('LAST_STAND fired AURA without an attackerSnapshot — skipping.');
      return;
    }
    const { defenseRatio, hpRegen } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const below = attacker.maxHp > 0 && attacker.hp < attacker.maxHp * 0.5;
    item.skillAffectedStats.defense = below ? Math.round(attackerSnapshot.defense * defenseRatio) : 0;
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
    // Contributes into the shared free-reroll grant pool (Player.freeRerollGrant) rather than
    // writing freeRerollCharges directly, so this stacks additively with the Bargain Hunter talent
    // regardless of which runs first — freeRerollCharges is derived from the pool's total once
    // every source has run (see DraftAuraTriggerCommand's post-pass).
    attacker.freeRerollGrant += count;
  },

  [ItemSkillType.STORE_CREDIT]: (context) => {
    const { attacker, item, trigger, shop } = context;
    if (trigger !== TriggerType.AURA || !attacker || !item || !shop) return;
    // This specific copy's claim was already spent this shop phase — don't re-offer it. Tracked
    // on the item itself (ItemSchema.ts), not a player-level flag, so selling this item and
    // buying/equipping a fresh copy of the skill grants a brand-new claim.
    if (item.storeCreditClaimUsed) return;
    const { cap } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    // Contributes into the shared claims map (Player.storeCreditClaims), keyed by this item
    // instance — see recomputeStoreCreditClaim below for how multiple equipped copies (at
    // possibly different rarities) each grant an independent claim instead of one overwriting
    // another in this tick's equippedItems iteration.
    attacker.storeCreditClaims.set(item, cap);
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
    // No `?? attacker` fallback (see scalingGraph.ts) — this reads AND writes income, so a
    // missing snapshot here means reading its own live output and compounding every tick,
    // exactly the old bug's shape.
    if (!attackerSnapshot) {
      console.error('COMPOUND_INTEREST fired AURA without an attackerSnapshot — skipping.');
      return;
    }
    const { ratio } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    item.skillAffectedStats.income = Math.round(Math.max(0, attackerSnapshot.income) * ratio);
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

  // Reworked (Season 26): from a percentage of the shield owner's own defense (further reduced by
  // the attacker's defense, so a tanky attacker barely felt it) into a straight reflect — a
  // percentage of the damage just taken, dealt back as-is. Self-escalating with use: the defense
  // burn below means less defense -> bigger hits taken -> bigger reflects, so the downside pays
  // for itself instead of just decaying the skill.
  [ItemSkillType.RIPOSTE]: (context) => {
    const { attacker, defender, item, client, commandDispatcher, trigger, damage } = context;
    if (!item) return;
    if (trigger === TriggerType.FIGHT_END) {
      item.skillAffectedStats.defense = 0;
      return;
    }
    if (trigger !== TriggerType.ON_ATTACKED || !attacker || !defender) return;
    const { ratio, defenseCost } = skillValues(ITEM_SKILLS[item.skillId], item.rarity);
    const counterDamage = (damage ?? 0) * ratio;
    if (counterDamage <= 0) return;
    commandDispatcher?.dispatch(new OnDamageTriggerCommand(), { defender: attacker, damage: counterDamage, attacker: defender });
    attacker.takeDamage(counterDamage, client, 'normal', 'skill');
    const defCost = defenseCost * defender.defense * 0.01;
    const consumed = Math.min(defCost, Math.max(0, defender.defense));
    if (consumed > 0) item.skillAffectedStats.defense -= consumed;
    client?.send('combat_log', {
      text: `${defender.name}'s ${item.name} ripostes ${attacker.name} for ${fmt(counterDamage)} damage${consumed > 0 ? ` — ${fmt(consumed)} defense spent!` : '!'}`,
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
      kind: 'stun', attackerId: attacker.playerId, defenderId: defender.playerId, stunnedPlayerId: attacker.playerId, itemId: item.itemId,
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
/** Derives Store Credit's two synced fields (storeCreditFreeClaim / storeCreditFreeClaimCap) from
 *  this tick's claims map (Player.storeCreditClaims, one entry per equipped copy that hasn't
 *  already spent its own claim this shop phase — see the AURA behavior above). Called once per
 *  draft aura tick (DraftAuraTriggerCommand, after triggerEquippedItems so every copy has
 *  contributed) and again immediately after a purchase (DraftRoom.buyItem), so the shop UI
 *  reflects a spend without waiting up to 1s for the next tick. */
export function recomputeStoreCreditClaim(player: {
  storeCreditClaims: Map<unknown, number>;
  storeCreditFreeClaim: boolean; storeCreditFreeClaimCap: number;
}): void {
  const caps = Array.from(player.storeCreditClaims.values());
  player.storeCreditFreeClaim = caps.length > 0;
  player.storeCreditFreeClaimCap = caps.length ? Math.max(...caps) : 0;
}

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

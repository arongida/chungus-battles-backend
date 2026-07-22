import { TalentType } from '../types/TalentTypes';
import { Item } from '../../items/schema/ItemSchema';
import { OnDamageTriggerCommand } from '../../commands/triggers/OnDamageTriggerCommand';
import { TriggerType, FightResultType } from "../../common/types";
import { PlayerAvatar } from "../../players/types/PlayerTypes";
import { EquipSlot, ItemClass, ItemRarity, ItemType } from "../../items/types/ItemTypes";
import { rollTheDice } from "../../common/utils";
import { TalentBehaviorContext } from "./TalentBehaviorContext";
import { ArraySchema } from "@colyseus/schema";
import { AffectedStats } from "../../common/schema/AffectedStatsSchema";
import { cloneItem, getItemById } from "../../items/db/Item";
import { rollItemStats } from "../../items/stats/itemStatRoller";
import { WEAPON_BASE_RANGES, clampTier } from "../../items/stats/itemStatPool";
import { applyRarityUpgrade, applyLuckyShopUpgrades, grantLuckyFindMythicBonus, shieldDescription } from "../../commands/ShopUpgradeUtils";
import { CombatLogMessage, RewardGainMessage, fmt } from "../../common/MessageTypes";
import { Client } from "colyseus";
import { Talent } from "../schema/TalentSchema";
import { Player } from "../../players/schema/PlayerSchema";
import { MAGIC_RING_DESCRIPTION, rollMagicRingBonus } from "../../items/behavior/uniqueItemBalance";
import { weaponWhispererSnapshots, weaponWhispererFinalRolls } from "./weaponWhispererState";

/** `reward`, when provided alongside a positive gold/xp amount, sends a `reward_gain` message to
 *  the recipient so the client can pop floating +gold/+xp text over their avatar. */
export function track(
    talent: Talent, activations: number, damage = 0, healing = 0, gold = 0, xp = 0,
    reward?: { client: Client; playerId: number },
) {
    talent.statActivations += activations; talent.totalActivations += activations;
    talent.statDamageDealt += damage; talent.totalDamageDealt += damage;
    talent.statHealingDone += healing; talent.totalHealingDone += healing;
    talent.statGoldGained += gold; talent.totalGoldGained += gold;
    talent.statXpGained += xp; talent.totalXpGained += xp;

    if (reward && (gold > 0 || xp > 0)) {
        reward.client.send('reward_gain', {
            playerId: reward.playerId,
            gold: gold > 0 ? gold : undefined,
            xp: xp > 0 ? xp : undefined,
        } as RewardGainMessage);
    }
}

export const TalentBehaviors = {
    [TalentType.RAGE]: (context: TalentBehaviorContext) => {
        const { talent, defender, client } = context;

        talent.affectedStats.strength += talent.activationRate;
        client.send('combat_log', { text: `${defender.name} rages, increased attack by 1!`, kind: 'talent', talentId: talent.talentId, attackerId: defender.playerId } as CombatLogMessage);
        client.send('trigger_talent', {
            playerId: defender.playerId,
            talentId: TalentType.RAGE,
        });

    },

    [TalentType.STAB]: (context: TalentBehaviorContext) => {
        const { talent, attacker, defender, client, commandDispatcher } = context;
        const stabDamage = 1 + (defender.maxHp - defender.hp) * talent.activationRate;
        const calculatedStabDamage = defender.getDamageAfterDefense(stabDamage);
        commandDispatcher.dispatch(new OnDamageTriggerCommand(), {
            defender: defender,
            damage: calculatedStabDamage,
            attacker: attacker,
        });
        defender.takeDamage(calculatedStabDamage, client);
        track(talent, 1, calculatedStabDamage);
        client.send('combat_log', { text: `${attacker.name} stabs ${defender.name} for ${fmt(calculatedStabDamage)} damage!`, kind: 'talent', talentId: talent.talentId, attackerId: attacker.playerId, defenderId: defender.playerId, damage: calculatedStabDamage } as CombatLogMessage);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.STAB,
        });
    },

    [TalentType.BEAR]: (context: TalentBehaviorContext) => {
        const { talent, attacker, defender, client, commandDispatcher } = context;
        const bearDamage = attacker.maxHp * talent.activationRate;
        const calculatedBearDamage = defender.getDamageAfterDefense(bearDamage);
        commandDispatcher.dispatch(new OnDamageTriggerCommand(), {
            defender: defender,
            damage: calculatedBearDamage,
            attacker: attacker,
        });
        defender.takeDamage(calculatedBearDamage, client);
        track(talent, 1, calculatedBearDamage);
        client.send('combat_log', { text: `${attacker.name} mauls ${defender.name} for ${fmt(calculatedBearDamage)} damage!`, kind: 'talent', talentId: talent.talentId, attackerId: attacker.playerId, defenderId: defender.playerId, damage: calculatedBearDamage } as CombatLogMessage);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.BEAR,
        });
    },

    [TalentType.ASSASSIN_AMUSEMENT]: (context: TalentBehaviorContext) => {
        const { attacker, client, talent, trigger } = context;
        if (trigger === TriggerType.ON_ATTACK) {
            talent.affectedStats.attackSpeed += talent.activationRate;
            client.send('combat_log', { text: `${attacker.name} gains ${talent.activationRate * 100}% attack speed!`, kind: 'talent', talentId: talent.talentId, attackerId: attacker.playerId } as CombatLogMessage);
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.ASSASSIN_AMUSEMENT,
            });
        } else if (trigger === TriggerType.FIGHT_END) {
            talent.affectedStats.attackSpeed = 1;
        }
    },

    [TalentType.WITS_END]: (context: TalentBehaviorContext) => {
        const { attacker, defender, client, talent, fightResult } = context;
        if (fightResult !== FightResultType.WIN) return;

        let goldGained = 0;
        let xpGained = 0;

        switch (defender.avatarUrl) {
            case PlayerAvatar.MERCHANT:
                talent.affectedStats.income += 2;
                client.send('combat_log', { text: `${attacker.name}'s wit brings in +2 income!`, kind: 'reward', talentId: talent.talentId, attackerId: attacker.playerId } as CombatLogMessage);
                break;
            case PlayerAvatar.WARRIOR:
                goldGained = 8;
                attacker.gold += goldGained;
                client.send('combat_log', { text: `${attacker.name} earns ${goldGained} gold for outwitting the warrior!`, kind: 'reward', talentId: talent.talentId, attackerId: attacker.playerId, goldDelta: goldGained } as CombatLogMessage);
                break;
            case PlayerAvatar.THIEF:
                xpGained = attacker.getXpAmount(12);
                attacker.xp += xpGained;
                client.send('combat_log', { text: `${attacker.name} gains ${xpGained} xp for outwitting the rogue!`, kind: 'xp', talentId: talent.talentId, attackerId: attacker.playerId, xpDelta: xpGained } as CombatLogMessage);
                break;
            default:
                return;
        }

        track(talent, 1, 0, 0, goldGained, xpGained, { client, playerId: attacker.playerId });
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.WITS_END,
        });
    },

    [TalentType.INVIGORATE]: (context: TalentBehaviorContext) => {
        const { attacker, defender, damage, client } = context;
        const leechAmount = damage * 0.15 + 1;
        const healed = attacker.heal(leechAmount, defender);
        track(context.talent, 1, 0, healed);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.INVIGORATE,
        });
        if (healed > 0) {
            client.send('combat_log', { text: `${attacker.name} leeches ${fmt(healed)} health!`, kind: 'leech', talentId: context.talent.talentId, attackerId: attacker.playerId, healing: healed } as CombatLogMessage);
            client.send('healing', {
                playerId: attacker.playerId,
                healing: healed,
            });
        }
    },

    [TalentType.SNITCH]: (context: TalentBehaviorContext) => {
        const { attacker, defender, client, trigger, talent } = context;
        if (trigger === TriggerType.ACTIVE) {
            if (defender.strength > 1 && defender.strength > defender.accuracy) {
                talent.affectedEnemyStats.strength -= 1;

            }
            talent.affectedStats.strength += 1;
            client.send('combat_log', { text: `${attacker.name} snitches 1 strength from ${defender.name}!`, kind: 'talent', talentId: talent.talentId, attackerId: attacker.playerId, defenderId: defender.playerId } as CombatLogMessage);
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.SNITCH,
            });
        } else if (trigger === TriggerType.FIGHT_END) {
            talent.affectedEnemyStats.strength = 0;
        }
    },

    [TalentType.STEAL]: (context: TalentBehaviorContext) => {
        const { attacker, defender, client } = context;
        const stolenItemIndex = Math.floor(Math.random() * defender.inventory.length);
        const stolenItem = defender.inventory[stolenItemIndex];
        if (stolenItem) {
            defender.inventory.splice(stolenItemIndex, 1);
            client.send('combat_log', { text: `${attacker.name} steals ${stolenItem.name} from ${defender.name}!`, kind: 'talent', talentId: context.talent.talentId, attackerId: attacker.playerId, defenderId: defender.playerId, itemId: stolenItem.itemId } as CombatLogMessage);
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.STEAL,
            });
            attacker.inventory.push(stolenItem);

        }
    },

    [TalentType.PICKPOCKET]: (context: TalentBehaviorContext) => {
        const { attacker, defender, client } = context;
        attacker.gold += 1;
        if (defender.gold > 0) defender.gold -= 1;
        track(context.talent, 1, 0, 0, 1, 0, { client, playerId: attacker.playerId });
        client.send('combat_log', { text: `${attacker.name} stole 1 gold from ${defender.name}!`, kind: 'talent', talentId: context.talent.talentId, attackerId: attacker.playerId, defenderId: defender.playerId, goldDelta: 1 } as CombatLogMessage);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.PICKPOCKET,
        });
    },

    [TalentType.SCAM]: (context: TalentBehaviorContext) => {
        const { attacker, defender, client, commandDispatcher } = context;
        const amount = attacker.level;
        const reducedAmount = defender.getDamageAfterDefense(amount);
        commandDispatcher.dispatch(new OnDamageTriggerCommand(), {
            defender: defender,
            damage: reducedAmount,
            attacker: attacker,
        });
        defender.takeDamage(reducedAmount, client);
        const scamHealed = attacker.heal(reducedAmount, defender);
        track(context.talent, 1, reducedAmount, scamHealed);
        client.send('combat_log', { text: `${attacker.name} scams ${fmt(scamHealed)} health from ${defender.name}!`, kind: 'leech', talentId: context.talent.talentId, attackerId: attacker.playerId, defenderId: defender.playerId, damage: reducedAmount, healing: scamHealed } as CombatLogMessage);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.SCAM,
        });
        if (scamHealed > 0) {
            client.send('healing', {
                playerId: attacker.playerId,
                healing: scamHealed,
            });
        }
    },

    [TalentType.BURNING_BLOOD]: (context: TalentBehaviorContext) => {
        const { attacker, defender, client, clock, talent } = context;
        const stacks = Math.max(1, Math.floor(1 + attacker.hpRegen));
        defender.addBurnStacks(clock, client, stacks);
        track(talent, 1);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.BURNING_BLOOD,
        });
    },

    [TalentType.THROW_MONEY]: (context: TalentBehaviorContext) => {
        const { attacker, defender, client, commandDispatcher } = context;
        const initialDamage = attacker.income;
        const damage = defender.getDamageAfterDefense(initialDamage);

        commandDispatcher.dispatch(new OnDamageTriggerCommand(), {
            defender: defender,
            damage: damage,
            attacker: attacker,
        });

        defender.takeDamage(damage, client);
        track(context.talent, 1, damage);
        client.send('combat_log', { text: `${attacker.name} throws money for ${fmt(damage)} damage!`, kind: 'talent', talentId: context.talent.talentId, attackerId: attacker.playerId, defenderId: defender.playerId, damage } as CombatLogMessage);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.THROW_MONEY,
        });
    },

    [TalentType.DISARM]: (context: TalentBehaviorContext) => {
        const { attacker, defender, client } = context;
        const weapons: Item[] = defender.inventory.filter((item) => item.tags.includes(ItemType.WEAPON));
        if (weapons.length > 0) {
            const mostExpensiveWeapon: Item = weapons.reduce((maxWeapon: Item, currentWeapon: Item) => {
                return currentWeapon.price > maxWeapon.price ? currentWeapon : maxWeapon;
            }, weapons[0]);

            client.send('combat_log', { text: `${defender.name} is disarmed! ${mostExpensiveWeapon.name} is disabled for the fight!`, kind: 'talent', talentId: context.talent.talentId, attackerId: attacker.playerId, defenderId: defender.playerId, itemId: mostExpensiveWeapon.itemId } as CombatLogMessage);
        } else {
            client.send('combat_log', { text: `${defender.name} has no weapons to disarm!`, kind: 'talent', talentId: context.talent.talentId, attackerId: attacker.playerId, defenderId: defender.playerId } as CombatLogMessage);
        }
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.DISARM,
        });
    },

    [TalentType.WEAPON_WHISPERER]: async (context: TalentBehaviorContext) => {
        const { attacker, client, talent, defender } = context;
        const weapon = attacker.equippedItems.get(EquipSlot.MAIN_HAND);
        // Quest weapons (e.g. Magic Ring) have their own rarity progression
        // (level-up rolls) and must not be insta-mythic'd out of it.
        if (!weapon || weapon.rarity >= ItemRarity.MYTHIC || weapon.tags?.includes('quest')) return;

        // Snapshot the weapon's pre-upgrade state exactly once (before this talent ever touches
        // it), so PlayerSchema.setItemUnequipped can revert it when it leaves MAIN_HAND — closes
        // the exploit of cycling weapons through main-hand to permanently bank multiple Mythics.
        if (!weaponWhispererSnapshots.has(weapon)) {
            weaponWhispererSnapshots.set(weapon, cloneItem(weapon));
        }

        // If this exact weapon was rolled Mythic before (and later reverted on unequip), reapply
        // that same result instead of rolling fresh random affixes on every re-equip.
        const cachedResult = weaponWhispererFinalRolls.get(weapon);
        if (cachedResult) {
            weapon.rarity = cachedResult.rarity;
            weapon.affectedStats = cachedResult.affectedStats;
            weapon.baseMinDamage = cachedResult.baseMinDamage;
            weapon.baseMaxDamage = cachedResult.baseMaxDamage;
            weapon.baseAttackSpeed = cachedResult.baseAttackSpeed;
            weapon.description = cachedResult.description;
            client.send('combat_log', { text: `${attacker.name}'s ${weapon.name} becomes Mythic!`, kind: 'talent', talentId: talent.talentId, attackerId: attacker.playerId, itemId: weapon.itemId } as CombatLogMessage);
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.WEAPON_WHISPERER,
            });
            return;
        }

        // Lock rarity immediately so subsequent aura ticks skip this while the DB fetch is in flight
        const originalRarity = weapon.rarity;
        weapon.rarity = ItemRarity.MYTHIC;

        const baseItem = await getItemById(weapon.itemId);
        if (!baseItem) return;

        // Restore so applyRarityUpgrade can increment step by step.
        // Each step merges a freshly rolled copy — like buying shop duplicates —
        // so the mythic ends up with varied affixes, not one stat multiplied.
        weapon.rarity = originalRarity;
        let reachedMythic = false;
        while (weapon.rarity < ItemRarity.MYTHIC) {
            const rolledSource = cloneItem(baseItem);
            rollItemStats(rolledSource);
            reachedMythic = applyRarityUpgrade(weapon, rolledSource, attacker, false) || reachedMythic;
        }
        weaponWhispererFinalRolls.set(weapon, cloneItem(weapon));

        client.send('combat_log', { text: `${attacker.name}'s ${weapon.name} becomes Mythic!`, kind: 'talent', talentId: talent.talentId, attackerId: attacker.playerId, itemId: weapon.itemId } as CombatLogMessage);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.WEAPON_WHISPERER,
        });

        // This aura talent ticks in both DraftRoom and FightRoom — `defender` is only ever
        // set in a fight context (see the Magic Ring AURA handler's identical idiom), so it's
        // the established way to pick the room-appropriate log channel here.
        if (reachedMythic) {
            grantLuckyFindMythicBonus(attacker);
            if (defender) {
                client.send('combat_log', { text: `Permanent +1% Lucky Find chance from ${weapon.name} going Mythic!`, kind: 'reward', attackerId: attacker.playerId, itemId: weapon.itemId } as CombatLogMessage);
            } else {
                client.send('draft_log', `Permanent +1% Lucky Find chance from ${weapon.name} going Mythic!`);
            }
            client.send('reward_gain', { playerId: attacker.playerId, luckyFind: true } as RewardGainMessage);
        }
    },

    // Gold Genie — AURA trigger (ticks every ~1s in both draft and fight rooms). Raises every
    // merchant-class shop item to a guaranteed LEGENDARY floor, then gives it exactly one
    // chance-based lucky-find roll (off the pristine pre-upgrade template) on top — applied
    // *after* the floor so the roll isn't wasted climbing through commons. `goldGenieLuckyRolled`
    // latches that one-time roll per shop slot so it doesn't re-roll (and inevitably hit MYTHIC)
    // on every subsequent tick. Also grants a free claim on the first merchant item bought each
    // shop (goldGenieClaimUsed/-FreeClaim latch, mirrors Comrade; consumed in DraftRoom.buyItem,
    // reset in DraftRoom.updateShop). `!shop` makes it harmless mid-fight.
    [TalentType.GOLD_GENIE]: (context: TalentBehaviorContext) => {
        const { attacker, client, shop } = context;
        if (!shop) return;
        attacker.goldGenieFreeClaim = !attacker.goldGenieClaimUsed;

        let upgraded = false;
        shop.forEach((item, slot) => {
            if (item.class !== ItemClass.MERCHANT || (item.rarity >= ItemRarity.LEGENDARY && item.goldGenieLuckyRolled)) return;
            const pristine = cloneItem(item);
            const basePrice = item.price;
            let steps = 0;
            while (item.rarity < ItemRarity.LEGENDARY) {
                const rolled = cloneItem(pristine);
                rollItemStats(rolled);
                applyRarityUpgrade(item, rolled, attacker, false);
                steps++;
            }
            let luckySteps = 0;
            if (!item.goldGenieLuckyRolled) {
                item.goldGenieLuckyRolled = true;
                luckySteps = applyLuckyShopUpgrades(item, pristine, attacker);
                steps += luckySteps;
            }
            if (steps > 0) {
                item.price = Math.round(basePrice * (1 + 0.5 * steps));
                item.sellPrice = Math.floor(item.price * 0.7);
                upgraded = true;
            }
            // Same floating-text + fireworks celebration as a normal shop lucky find
            // (DraftRoom.announceLuckyUpgrade) — only for the chance-based lucky steps, not the
            // guaranteed climb to Legendary.
            if (luckySteps > 0) {
                client.send('shop_floating', { slot, text: 'Lucky find! Rarity up!', rarity: item.rarity });
            }
        });
        if (upgraded) {
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.GOLD_GENIE,
            });
        }
    },

    [TalentType.STRONG]: (context: TalentBehaviorContext) => {
        const { attacker, talent, client, attackerSnapshot } = context;
        const base = attackerSnapshot ?? attacker;
        const hpBonus = base.maxHp * talent.activationRate;
        const attackBonus = 10;

        talent.affectedStats.maxHp = hpBonus;
        talent.affectedStats.strength = attackBonus;

        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.STRONG,
        });
    },

    [TalentType.INTIMIDATING_WEALTH]: (context: TalentBehaviorContext) => {
        const { attacker, defender, client, talent } = context;

        if (!defender) return;
        const attackSpeedBonus = attacker.income * talent.activationRate;

        talent.affectedStats.attackSpeed = 1 + attackSpeedBonus;
        talent.affectedEnemyStats.attackSpeed = Math.max(1 - attackSpeedBonus, 0.5);

        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.INTIMIDATING_WEALTH,
        });

    },

    [TalentType.CORRODING_COLLECTION]: (context: TalentBehaviorContext) => {
        const { attacker, defender, client, clock } = context;
        const poisonStackToApply = defender.inventory.length * 2;
        defender.addPoisonStacks(clock, client, poisonStackToApply);

        client.send('combat_log', { text: `${attacker.name} corrodes ${defender.name}'s collection!`, kind: 'talent', talentId: context.talent.talentId, attackerId: attacker.playerId, defenderId: defender.playerId } as CombatLogMessage);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.CORRODING_COLLECTION,
        });
    },

    [TalentType.ZEALOT]: (context: TalentBehaviorContext) => {
        const { attacker, client, talent } = context;
        talent.affectedStats.attackSpeed = 1 + (attacker.defense * 0.6 * 0.01);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.ZEALOT,
        });
    },

    // Hidden Vials — ON_DODGE trigger. `defender` is the dodger (talent owner); the enemy who
    // missed is `attacker`. Applies the DoT stacks to the enemy.
    [TalentType.HIDDEN_VIALS]: (context: TalentBehaviorContext) => {
        const { attacker, defender, client, clock, talent } = context;
        attacker.addBurnStacks(clock, client, talent.activationRate);
        attacker.addPoisonStacks(clock, client, talent.activationRate);
        track(talent, 1);
        client.send('trigger_talent', {
            playerId: defender.playerId,
            talentId: TalentType.HIDDEN_VIALS,
        });
    },

    [TalentType.THORNY_FENCE]: (context: TalentBehaviorContext) => {
        const { attacker, defender, client, talent, commandDispatcher } = context;
        const reflectDamage = attacker.getDamageAfterDefense(talent.activationRate * defender.defense);

        commandDispatcher.dispatch(new OnDamageTriggerCommand(), {
            defender: attacker,
            damage: reflectDamage,
            attacker: defender,
            isReflectedDamage: true,
        });
        attacker.takeDamage(reflectDamage, client);
        track(talent, 1, reflectDamage);
        client.send('combat_log', { text: `${defender.name} reflects ${fmt(reflectDamage)} damage to ${attacker.name}!`, kind: 'talent', talentId: talent.talentId, attackerId: defender.playerId, defenderId: attacker.playerId, damage: reflectDamage } as CombatLogMessage);
        client.send('trigger_talent', {
            playerId: defender.playerId,
            talentId: TalentType.THORNY_FENCE,
        });
    },

    [TalentType.EYE_FOR_AN_EYE]: (context: TalentBehaviorContext) => {
        const { attacker, defender, client, talent, damage, commandDispatcher } = context;
        // Only direct enemy damage is reflected — DoT ticks and incoming reflects would
        // otherwise re-trigger this talent in a loop.
        if (context.isReflectedDamage) return;
        if (context.damageType === 'burn' || context.damageType === 'poison') return;
        const random = Math.random();
        if (random < talent.activationRate) {
            commandDispatcher.dispatch(new OnDamageTriggerCommand(), {
                defender: attacker,
                damage: damage,
                attacker: defender,
                isReflectedDamage: true,
            });
            attacker.takeDamage(damage, client);
            track(talent, 1, damage);
            client.send('combat_log', { text: `${defender.name} reflects ${fmt(damage)} damage to ${attacker.name}!`, kind: 'talent', talentId: talent.talentId, attackerId: defender.playerId, defenderId: attacker.playerId, damage } as CombatLogMessage);
            client.send('trigger_talent', {
                playerId: defender.playerId,
                talentId: TalentType.EYE_FOR_AN_EYE,
            });
        }
    },

    [TalentType.TRICKSTER]: (context: TalentBehaviorContext) => {
        const { client, attacker, defender } = context;
        const enemyAttack = defender.strength;
        const playerAttack = attacker.strength;
        attacker.strength = enemyAttack;
        defender.strength = playerAttack;
        client.send('combat_log', { text: `${attacker.name} tricks ${defender.name}!`, kind: 'talent', talentId: context.talent.talentId, attackerId: attacker.playerId, defenderId: defender.playerId } as CombatLogMessage);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.TRICKSTER,
        });
    },

    [TalentType.EVASION]: (context: TalentBehaviorContext) => {
        const { attacker, client, talent } = context;
        attacker.dodgeRate += talent.activationRate;
        client.send('combat_log', { text: `${attacker.name} gains ${talent.activationRate * 100}% dodge chance!`, kind: 'talent', talentId: talent.talentId, attackerId: attacker.playerId } as CombatLogMessage);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.EVASION,
        });
    },

    [TalentType.FUTURE_NOW]: (context: TalentBehaviorContext) => {
        const { attacker, client, talent } = context;

        const extraXp = attacker.getXpAmount(attacker.round * 2);
        attacker.xp += extraXp;
        track(talent, 1, 0, 0, 0, extraXp, { client, playerId: attacker.playerId });

        talent.affectedStats.income += 1;

        client.send('combat_log', { text: `FUTURE NOW! +${extraXp} XP, income grows an extra +1!`, kind: 'xp', talentId: talent.talentId, attackerId: attacker.playerId, xpDelta: extraXp } as CombatLogMessage);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: talent.talentId,
        });
    },

    [TalentType.SMART_INVESTMENT]: (context: TalentBehaviorContext) => {
        const { attacker, client, talent, weapon } = context;
        if (!weapon?.tags?.includes("merchant")) return;

        if (Math.random() < talent.activationRate) {
            talent.affectedStats.income += 1;
            track(talent, 1);
            client.send('combat_log', { text: `${attacker.name}'s merchant weapon brings in +1 income!`, kind: 'reward', talentId: talent.talentId, attackerId: attacker.playerId } as CombatLogMessage);
        } else {
            const xpGained = attacker.getXpAmount(1);
            attacker.xp += xpGained;
            track(talent, 1, 0, 0, 0, xpGained, { client, playerId: attacker.playerId });
            client.send('combat_log', { text: `${attacker.name} gains +${xpGained} XP from the merchant's experience!`, kind: 'xp', talentId: talent.talentId, attackerId: attacker.playerId, xpDelta: xpGained } as CombatLogMessage);
        }
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.SMART_INVESTMENT,
        });
    },

    [TalentType.GUARDIAN_ANGEL]: (context: TalentBehaviorContext) => {
        const { attacker, client, defender, clock, talent, damage } = context;
        if (defender.hp - damage <= 0 && !defender.talentsOnCooldown.includes(TalentType.GUARDIAN_ANGEL)) {
            defender.hp = 1;
            defender.setInvincible(clock, talent.activationRate, client);
            defender.talentsOnCooldown.push(TalentType.GUARDIAN_ANGEL);

            client.send('combat_log', { text: `You are invincible for ${talent.activationRate / 1000} seconds!`, kind: 'talent', talentId: talent.talentId, attackerId: attacker.playerId } as CombatLogMessage);
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.GUARDIAN_ANGEL,
            });
        }
    },

    [TalentType.PENNY_STOCKS]: (context: TalentBehaviorContext) => {
        const { client, attacker, talent } = context;
        attacker.gold += talent.activationRate;

        talent.triggerTypes.clear();

        track(talent, 1, 0, 0, talent.activationRate, 0, { client, playerId: attacker.playerId })

        client.send('draft_log', `Gained ${talent.activationRate} gold!`);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: 7,
        });

    },

    [TalentType.ROBBERY]: (context: TalentBehaviorContext) => {
        const { attacker, client, shop, talent } = context;
        const randomItem = shop[Math.floor(Math.random() * shop.length)];
        if (randomItem) {
            attacker.gold += randomItem.price;
            attacker.getItem(randomItem);
            track(talent, 0, 0, 0);
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.ROBBERY,
            });
            client.send('draft_log', `Robbery talent activated! Gained ${randomItem.name}!`);
        }
    },

    // Martial Artist — two triggers on the same talent:
    // AURA: conjures a ghost fist into each hand slot (stripping any real item, like before the
    // rework) and scales them like a rolled rogue-archetype weapon of tier === player.level
    // (levels 1-5 map onto tiers/rarities 1-5 exactly) — using the midpoint of that tier's
    // damage/attack-speed ranges so the fists grow deterministically each level-up instead of
    // re-rolling every aura tick. Also neutralizes talent.affectedStats every tick in case an
    // older save still carries stats learned under the pre-rework version.
    // ON_ATTACK: fires whenever a fist lands a hit. Picks a random weapon stashed in the
    // inventory and unleashes a full extra attack with it via performWeaponAttack — that attack
    // re-enters the normal trigger dispatch, so the weapon's own on-hit effects (poison,
    // invulnerability, burn, lifesteal, ...) apply exactly as if it had been equipped. Guarded on
    // context.weapon being a fist so the extra attack (made with a real weapon) can't recurse.
    [TalentType.MARTIAL_ARTIST]:
        (context: TalentBehaviorContext) => {
            const { attacker, client, talent, trigger, defender, weapon, performWeaponAttack } = context;

            if (trigger === TriggerType.AURA) {
                if (!attacker) return;
                ensureMartialFists(attacker, client, talent);

                const tier = clampTier(attacker.level);
                const range = WEAPON_BASE_RANGES[ItemClass.ROGUE][tier];
                const baseMinDamage = Math.round((range.minDamage.min + range.minDamage.max) / 2);
                const baseMaxDamage = baseMinDamage + Math.round((range.maxDamageSpread.min + range.maxDamageSpread.max) / 2);
                const baseAttackSpeed = Math.round(((range.attackSpeed.min + range.attackSpeed.max) / 2) * 100) / 100;

                for (const slot of [EquipSlot.MAIN_HAND, EquipSlot.OFF_HAND]) {
                    const fist = attacker.equippedItems.get(slot);
                    if (!fist?.tags?.includes(MARTIAL_FIST_TAG)) continue;
                    // Left fist (main hand) hits twice as fast; right fist (off hand) hits twice
                    // as hard — same total output, different rhythm.
                    const isRightFist = slot === EquipSlot.OFF_HAND;
                    // Mutate in place — fight attack timers hold this Item by reference and
                    // re-read its damage every punch, so the instance must never be swapped
                    // mid-fight.
                    fist.tier = tier;
                    fist.rarity = tier;
                    fist.baseMinDamage = isRightFist ? baseMinDamage * 2 : baseMinDamage;
                    fist.baseMaxDamage = isRightFist ? baseMaxDamage * 2 : baseMaxDamage;
                    fist.baseAttackSpeed = isRightFist ? baseAttackSpeed * 0.5 : baseAttackSpeed;
                    fist.description = 'A martial artist\'s fist. Each hit unleashes an extra strike with a random weapon from your inventory.';
                    attacker.equippedItems.set(slot, fist);
                }

                // Rebuilt from scratch every tick — clears any stats learned under the
                // pre-rework version of this talent.
                talent.affectedStats.strength = 0;
                talent.affectedStats.accuracy = 0;
                talent.affectedStats.maxHp = 0;
                talent.affectedStats.defense = 0;
                talent.affectedStats.income = 0;
                talent.affectedStats.hpRegen = 0;
                talent.affectedStats.dodgeRate = 0;
                talent.affectedStats.attackSpeed = 1;
                return;
            }

            if (trigger === TriggerType.ON_ATTACK) {
                if (!attacker || !defender || !performWeaponAttack) return;
                if (!weapon?.tags?.includes(MARTIAL_FIST_TAG)) return;

                const eligible = attacker.inventory.filter((item) =>
                    item.type === ItemType.WEAPON &&
                    !item.tags?.includes(MARTIAL_FIST_TAG) &&
                    !item.tags?.includes('dual_wield_copy')
                );
                if (eligible.length === 0) return;

                const extraWeapon = eligible[Math.floor(Math.random() * eligible.length)];
                let fistSlot = 'martial';
                attacker.equippedItems.forEach((equipped, slot) => {
                    if (equipped === weapon) fistSlot = slot;
                });
                performWeaponAttack(attacker, defender, extraWeapon, fistSlot);
            }
        },

    // Comrade — AURA trigger (ticks every ~1s in the draft room) so the bonus applies right after
    // picking the talent, not only after the next shop refresh. Each tick adds the player's income
    // on top of the (freshly re-seeded, see DraftAuraTriggerCommand) base reroll cost, and exposes
    // one free-item claim per shop; `comradeClaimUsed` (latched in DraftRoom.buyItem, reset in
    // DraftRoom.updateShop) stops the aura from re-granting a fresh claim every second once one has
    // been spent on the current shop. The actual free purchase is applied in DraftRoom.buyItem so
    // the player picks which item.
    [TalentType.COMRADE]:
        (context: TalentBehaviorContext) => {
            const { attacker, shop } = context;
            if (!shop) return;
            attacker.refreshShopCost += Math.floor(attacker.income);
            attacker.comradeFreeClaim = !attacker.comradeClaimUsed;
        },

    [TalentType.GAMBLER]:
        (context: TalentBehaviorContext) => {
            const { attacker, client, questItems, talent } = context;

            if (
                !attacker.inventory.find((item) => item.itemId === 703) &&
                !(attacker.equippedItems.get(EquipSlot.OFF_HAND)?.itemId === 703) &&
                !(attacker.equippedItems.get(EquipSlot.MAIN_HAND)?.itemId === 703)
            ) {
                const diceItem = questItems?.find((item) => item.itemId === 703);
                if (diceItem) {
                    // Grant it already caught up to the player's current level (e.g.
                    // Thief starts at level 2), same pattern as Magic Ring: rarity = level.
                    diceItem.rarity = Math.min(attacker.level, ItemRarity.MYTHIC);
                    diceItem.description = `Max damage equals ${Math.round((diceItem.rarity / 2) * 100)}% of income.`;
                    diceItem.baseAttackSpeed = diceItem.rarity === 2 ? 0.9 : 0.6;
                    attacker.getItem(diceItem);
                    client.send('draft_log', `${attacker.name} found a gambler's dice!`);
                    client.send('trigger_talent', {
                        playerId: attacker.playerId,
                        talentId: TalentType.GAMBLER,
                    });
                    // Only reachable at max level (5), where the dice is granted already Mythic.
                    if (diceItem.rarity === ItemRarity.MYTHIC) {
                        grantLuckyFindMythicBonus(attacker);
                        client.send('draft_log', `Permanent +1% Lucky Find chance from the gambler's dice being Mythic!`);
                        client.send('reward_gain', { playerId: attacker.playerId, luckyFind: true } as RewardGainMessage);
                    }
                }
            }

            // Baseline income scales with level; re-seeded every aura tick like MERCHANT_5.
            talent.affectedStats.income = attacker.level;
        },

    [TalentType.MAGIC_RING_WEAPON]:
        (context: TalentBehaviorContext) => {
            const { attacker, client, questItems } = context;

            if (
                !attacker.inventory.find((item) => item.itemId === 702) &&
                !(attacker.equippedItems.get(EquipSlot.MAIN_HAND)?.itemId === 702) &&
                !(attacker.equippedItems.get(EquipSlot.OFF_HAND)?.itemId === 702)
            ) {
                const ringWeapon = questItems.find((item) => item.itemId === 702);
                if (ringWeapon) {
                    ringWeapon.rarity = ItemRarity.COMMON;
                    rollMagicRingBonus(ringWeapon);
                    // Catch up to the player's current level (e.g. thief starts at level 2)
                    // so the ring isn't stuck behind level-ups that already happened.
                    while (ringWeapon.rarity < attacker.level && ringWeapon.rarity < ItemRarity.MYTHIC) {
                        ringWeapon.rarity++;
                        rollMagicRingBonus(ringWeapon);
                    }
                    ringWeapon.description = MAGIC_RING_DESCRIPTION;
                    attacker.getItem(ringWeapon);
                    client.send('draft_log', `${attacker.name} found a ring weapon!`);
                    client.send('trigger_talent', {
                        playerId: attacker.playerId,
                        talentId: TalentType.MAGIC_RING_WEAPON,
                    });
                    // Only reachable at max level (5), where the catch-up loop reaches Mythic.
                    if (ringWeapon.rarity === ItemRarity.MYTHIC) {
                        grantLuckyFindMythicBonus(attacker);
                        client.send('draft_log', `Permanent +1% Lucky Find chance from the ring weapon being Mythic!`);
                        client.send('reward_gain', { playerId: attacker.playerId, luckyFind: true } as RewardGainMessage);
                    }
                }
            }
        },


    [TalentType.JOKER]:
        (context: TalentBehaviorContext) => {
            const { attacker, client, talent } = context;

            let stat = "";
            let amount = 0;

            const randomBonus = rollTheDice(1, 8);
            if (randomBonus === 1) {
                amount = 10 * attacker.level;
                talent.affectedStats.maxHp += amount;
                stat = "hp";
            } else if (randomBonus === 2) {
                amount = attacker.level;
                talent.affectedStats.accuracy += amount;
                stat = "accuracy";
            } else if (randomBonus === 3) {
                amount = 1 + attacker.level;
                talent.affectedStats.strength += amount;
                stat = "strength";
            } else if (randomBonus === 4) {
                amount = 9 * attacker.level;
                talent.affectedStats.defense += amount;
                stat = "defense";
            } else if (randomBonus === 5) {
                amount = 10 * attacker.level;
                talent.affectedStats.dodgeRate += amount;
                stat = "dodge rate";
            } else if (randomBonus === 6) {
                amount = attacker.level * 0.05;
                talent.affectedStats.attackSpeed += amount;
                stat = "attack speed";
            } else if (randomBonus === 7) {
                amount = attacker.level;
                talent.affectedStats.income += amount;
                stat = "income";
            } else if (randomBonus === 8) {
                amount = attacker.level * 0.15;
                talent.affectedStats.hpRegen += amount;
                stat = "hp regeneration";
            }

            client.send('combat_log', { text: `${attacker.name} gets ${amount} bonus ${stat} from Joker talent.`, kind: 'talent', talentId: talent.talentId, attackerId: attacker.playerId } as CombatLogMessage);
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.JOKER,
            });
        },

    // Shady Shields — AURA trigger (ticks every ~1s in the draft room). The shield-as-weapon
    // upgrade re-applies every tick (idempotent). The free starter shield is one-shot, latched
    // via `talent.tags` (same pattern as Grand Robbery) so it's only granted once, right after
    // the talent is picked.
    [TalentType.SHADY_SHIELDS]:
        async (context: TalentBehaviorContext) => {
            const { attacker, shop, talent, client } = context;

            const upgradeShield = (item: Item) => {
                if (item.type !== ItemType.SHIELD) return;
                item.baseAttackSpeed = 0.6 * item.rarity;
                item.baseMinDamage = item.tier * item.rarity - 1;
                item.baseMaxDamage = item.tier * item.rarity + 1;
                const equipOpts = item.equipOptions as any;
                if (equipOpts && !equipOpts.includes(EquipSlot.MAIN_HAND)) {
                    equipOpts.push(EquipSlot.MAIN_HAND);
                }
            };

            attacker.inventory.forEach(upgradeShield);
            attacker.equippedItems.forEach(upgradeShield);
            shop?.forEach(upgradeShield);

            if (!talent.tags?.includes('shady-shields-granted')) {
                talent.tags?.push('shady-shields-granted');
                const baseShield = await getItemById(76); // Buckler shield
                if (baseShield) {
                    const shield = cloneItem(baseShield);
                    upgradeShield(shield);
                    shield.description = shieldDescription(shield.tier); // normally set by rollItemStats when a shield rolls into the shop
                    attacker.gold += shield.price; // refund so getItem nets to free
                    attacker.getItem(shield);
                    client?.send('draft_log', `${attacker.name} got a free shield from Shady Shields!`);
                    client?.send('trigger_talent', {
                        playerId: attacker.playerId,
                        talentId: TalentType.SHADY_SHIELDS,
                    });
                }
            }
        },

    [TalentType.DUAL_WIELD]:
        (context: TalentBehaviorContext) => {
            const { attacker } = context;

            // Remove ghost copies that leaked into inventory (e.g. from a prior setItemUnequipped)
            for (let i = attacker.inventory.length - 1; i >= 0; i--) {
                if (attacker.inventory[i].tags?.includes('dual_wield_copy')) {
                    attacker.inventory.splice(i, 1);
                }
            }

            const mainHand = attacker.equippedItems.get(EquipSlot.MAIN_HAND);
            const offHand = attacker.equippedItems.get(EquipSlot.OFF_HAND);
            const offHandIsGhost = offHand?.tags?.includes('dual_wield_copy');
            const mainHandIsWeapon = mainHand && mainHand.baseAttackSpeed > 0;


            // Only real weapons get mirrored — non-weapon hand items (e.g. Ring of
            // Immortality, which occupies a hand slot but isn't a weapon) should never
            // be copied into the off hand or treated as dual-wielded.
            if (!mainHandIsWeapon) {
                if (offHandIsGhost) attacker.setItemUnequipped(offHand, EquipSlot.OFF_HAND);
                return;
            }

            // Respect a real item the player placed in off hand
            if (offHand && !offHandIsGhost) {
                return;
            }

            // Ghost already matches — no need to re-equip, just refresh speed bonus
            if (offHandIsGhost && offHand.itemId === mainHand.itemId && offHand.rarity === mainHand.rarity) {
                return;
            }

            attacker.setItemEquipped(clonedAsGhost(mainHand), EquipSlot.OFF_HAND);
        },

    [TalentType.SHARPENING_STONE]:
        (context: TalentBehaviorContext) => {
            const { attacker, talent } = context;

            talent.affectedStats.strength = 0;
            talent.affectedStats.accuracy = 0;
            talent.affectedStats.maxHp = 0;
            talent.affectedStats.defense = 0;
            talent.affectedStats.dodgeRate = 0;
            talent.affectedStats.income = 0;
            talent.affectedStats.hpRegen = 0;
            talent.affectedStats.attackSpeed = 1;

            attacker.equippedItems.forEach((item) => {
                if (item.class === ItemClass.WARRIOR) {
                    talent.affectedStats.strength += item.affectedStats.strength * talent.activationRate;
                    talent.affectedStats.accuracy += item.affectedStats.accuracy * talent.activationRate;
                    talent.affectedStats.maxHp += item.affectedStats.maxHp * talent.activationRate;
                    talent.affectedStats.defense += item.affectedStats.defense * talent.activationRate;
                    talent.affectedStats.dodgeRate += item.affectedStats.dodgeRate * talent.activationRate;
                    talent.affectedStats.income += item.affectedStats.income * talent.activationRate;
                    talent.affectedStats.hpRegen += item.affectedStats.hpRegen * talent.activationRate;
                    // attackSpeed is a base-1 multiplier, not additive-from-0 like the other stats
                    // above — only amplify the item's actual bonus (its value above 1).
                    if (item.affectedStats.attackSpeed > 1) {
                        talent.affectedStats.attackSpeed += (item.affectedStats.attackSpeed - 1) * talent.activationRate;
                    }
                }
            });

            talent.affectedStats.strength += talent.base;
        },

    [TalentType.MERCHANT_1]:
        (context: TalentBehaviorContext) => {
            const { attacker, client, talent, shop } = context;
            const discount = talent.base * attacker.level;
            shop?.forEach((item) => {
                item.price = Math.max(0, item.price - discount);
                item.sellPrice = Math.max(0, item.sellPrice - discount);
            });
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.MERCHANT_1,
            });
        },

    [TalentType.ROGUE_1]:
        (context: TalentBehaviorContext) => {
            const { defender, client } = context;
            defender.gold += 1;
            track(context.talent, 1, 0, 0, 1, 0, { client, playerId: defender.playerId });
            client.send('combat_log', { text: `${defender.name} found 1 gold during dodge roll!`, kind: 'reward', talentId: context.talent.talentId, attackerId: defender.playerId, goldDelta: 1 } as CombatLogMessage);
            client.send('trigger_talent', {
                playerId: defender.playerId,
                talentId: TalentType.ROGUE_1,
            });
        },

    [TalentType.MERCENARY]:
        (context: TalentBehaviorContext) => {
            const { defender, attacker, client, damage, talent } = context;
            const chance = damage / talent.base;
            if (Math.random() < chance) {
                attacker.gold += 1;
                track(talent, 1, 0, 0, 1, 0, { client, playerId: attacker.playerId });
                client.send('combat_log', { text: `${defender.name} bled a gold coin!`, kind: 'reward', talentId: talent.talentId, attackerId: attacker.playerId, defenderId: defender.playerId, goldDelta: 1 } as CombatLogMessage);
                client.send('trigger_talent', {
                    playerId: attacker.playerId,
                    talentId: TalentType.MERCENARY,
                });
            }
        },

    [TalentType.WARRIOR_2]:
        (context: TalentBehaviorContext) => {
            const { attacker, defender, client, commandDispatcher } = context;
            const initialDamage = attacker.strength;
            const damageAfterReduction = defender.getDamageAfterDefense(initialDamage);
            commandDispatcher.dispatch(new OnDamageTriggerCommand(), {
                defender: defender,
                damage: damageAfterReduction,
                attacker: attacker,
            });
            defender.takeDamage(damageAfterReduction, client);
            track(context.talent, 1, damageAfterReduction);
            client.send('combat_log', { text: `${attacker.name} throws weapons for ${fmt(damageAfterReduction)} damage!`, kind: 'talent', talentId: context.talent.talentId, attackerId: attacker.playerId, defenderId: defender.playerId, damage: damageAfterReduction } as CombatLogMessage);
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.WARRIOR_2,
            });
        },

    [TalentType.ROGUE_2]:
        (context: TalentBehaviorContext) => {
            const { attacker, client, talent } = context;

            talent.affectedStats.attackSpeed += talent.base;
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.ROGUE_2,
            });
        },

    // Bargain Hunter — AURA trigger; reduces the (freshly re-seeded, see DraftAuraTriggerCommand)
    // base reroll cost by 1 rather than pinning it to a fixed value, so it composes additively
    // with other reroll-cost talents (e.g. Comrade's +income) instead of overwriting them.
    [TalentType.BARGAIN_HUNTER]:
        (context: TalentBehaviorContext) => {
            const { attacker, client, talent } = context;
            attacker.refreshShopCost -= 1;
            if (talent.totalActivations === 0) {
                attacker.gold += talent.activationRate;
                track(talent, 1, 0, 0, talent.activationRate, 0, { client, playerId: attacker.playerId });
                client.send('trigger_talent', {
                    playerId: attacker.playerId,
                    talentId: TalentType.BARGAIN_HUNTER,
                });
            }
        },

    [TalentType.POISON_2]:
        (context: TalentBehaviorContext) => {
            const { attacker, defender, client, clock, talent } = context;
            defender.addPoisonStacks(clock, client, talent.activationRate);
            track(talent, 1, 0, 0, 0);
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.POISON_2,
            });
        },

    // Unstoppable Force — ACTIVE trigger (activationRate 0.5 => every 2s). Flags the owner's next
    // weapon attack to be un-dodgeable and deal double damage; consumed in FightRoom.tryWeaponAttack.
    [TalentType.WARRIOR_3]:
        (context: TalentBehaviorContext) => {
            const { attacker, client } = context;
            attacker.empoweredNextAttack = true;
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.WARRIOR_3,
            });
        },

    [TalentType.LEARN_BY_DOING]:
        (context: TalentBehaviorContext) => {
            const { attacker, client, talent } = context;
            const xpGained = attacker.getXpAmount(talent.base);
            attacker.xp += xpGained;
            track(talent, 1, 0, 0, 0, xpGained, { client, playerId: attacker.playerId });
            client.send('combat_log', { text: `${attacker.name} gains + ${xpGained}XP!`, kind: 'xp', talentId: talent.talentId, attackerId: attacker.playerId, xpDelta: xpGained } as CombatLogMessage);
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.LEARN_BY_DOING,
            });
        },

    // Berserk — AURA trigger. Re-checked every ~1s; below 50% HP grants +100% strength (of base+item
    // strength, via attackerSnapshot so it doesn't feed on its own bonus) and +100% attack speed.
    // Writes `=` each tick (not `+=`), so UpdateStatsCommand's from-scratch resum removes the buff
    // automatically once healed back above 50% — no FIGHT_END reset needed.
    [TalentType.WARRIOR_4]:
        (context: TalentBehaviorContext) => {
            const { attacker, client, talent, attackerSnapshot } = context;
            const base = attackerSnapshot ?? attacker;
            const below = attacker.hp < attacker.maxHp * talent.activationRate;
            talent.affectedStats.strength = below ? base.strength * talent.scaling : 0;
            talent.affectedStats.attackSpeed = below ? 1 + talent.scaling : 1;
            if (below) {
                client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.WARRIOR_4,
            });
            }
        },

    [TalentType.ROGUE_4]:
        (context: TalentBehaviorContext) => {
            const { attacker, client } = context;
            attacker.gold += 1;
            track(context.talent, 1, 0, 0, 1, 0, { client, playerId: attacker.playerId });
            client.send('combat_log', { text: `${attacker.name} gets 1 gold!`, kind: 'reward', talentId: context.talent.talentId, attackerId: attacker.playerId, goldDelta: 1 } as CombatLogMessage);
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.ROGUE_4,
            });
        },

    [TalentType.MERCHANT_5]:
        (context: TalentBehaviorContext) => {
            const { attacker, client, talent, attackerSnapshot } = context;
            talent.affectedStats.income = talent.base;
            const base = attackerSnapshot ?? attacker;
            const bonusCoefficent = (base.income * talent.scaling) / 100;
            talent.affectedStats.strength = Math.ceil(base.strength * bonusCoefficent);
            talent.affectedStats.accuracy = Math.ceil(base.accuracy * bonusCoefficent);
            talent.affectedStats.attackSpeed = 1 + bonusCoefficent;
            talent.affectedStats.defense = Math.ceil(base.defense * bonusCoefficent);
            talent.affectedStats.maxHp = Math.ceil(base.maxHp * bonusCoefficent);
            talent.affectedStats.dodgeRate = Math.ceil(base.dodgeRate * bonusCoefficent);
            talent.affectedStats.hpRegen = Math.ceil(base.hpRegen * bonusCoefficent);
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.MERCHANT_5,
            });
        },

    [TalentType.WARRIOR_5]:
        (context: TalentBehaviorContext) => {
            const { talent } = context;
            talent.affectedStats.strength = 100;
        },

    [TalentType.GRAND_ROBBERY]:
        (context: TalentBehaviorContext) => {
            const { attacker, client, shop, talent } = context;
            if (!shop) return; // undefined outside draft
            if (talent.tags?.includes('grand-robbery-used')) return; // one-shot latch

            let stolen = 0;
            [...shop].forEach((item) => { // copy: getItem mutates sold/shop state as it goes
                if (item.sold) return;
                attacker.gold += item.price; // refund so getItem nets to free
                attacker.getItem(item);
                stolen++;
            });

            talent.tags?.push('grand-robbery-used');
            talent.description = `Grand Robbery! Stole ${stolen} item(s) from the shop!`
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.GRAND_ROBBERY,
            });
            if (stolen > 0) {
                client.send('draft_log', `Grand Robbery! Stole ${stolen} item(s) from the shop!`);
            }
        },

    [TalentType.JUST_A_SCRATCH]:
        (context: TalentBehaviorContext) => {
            const { defender, client, talent } = context;
            if (Math.random() < talent.activationRate) {
                defender.gold += 1;
                track(talent, 1, 0, 0, 1, 0, { client, playerId: defender.playerId });
                client.send('combat_log', { text: `${defender.name} profits from pain, gaining 1 gold!`, kind: 'reward', talentId: talent.talentId, attackerId: defender.playerId, goldDelta: 1 } as CombatLogMessage);
                client.send('trigger_talent', {
                    playerId: defender.playerId,
                    talentId: TalentType.JUST_A_SCRATCH,
                });
            }
        },

    // Black Market Contact — AURA talent (runs every draft tick via DraftAuraTriggerCommand):
    // doubles the hidden lucky-find chance stat, and exposes one free lucky-find claim per shop
    // (`luckyFindClaimUsed` latched in DraftRoom.buyItem, reset in DraftRoom.updateShop — same
    // pattern as Comrade above). The actual free purchase is applied in DraftRoom.buyItem so the
    // player picks which lucky-find item. Guarded on `trigger === AURA` so legacy player copies
    // still carrying the old `after-refresh` trigger simply no-op instead of throwing.
    [TalentType.BLACK_MARKET_CONTRACT]: (context: TalentBehaviorContext) => {
        const { attacker, shop, trigger } = context;
        if (trigger !== TriggerType.AURA || !attacker || !shop) return;

        attacker.luckyFindChance *= 2;
        attacker.luckyFindFreeClaim = !attacker.luckyFindClaimUsed;
    },
}
    ;

export const MARTIAL_FIST_TAG = 'martial_fist';

function createMartialFist(slot: EquipSlot): Item {
    const fist = new Item();
    fist.itemId = 0;
    fist.name = slot === EquipSlot.MAIN_HAND ? 'Left Fist' : 'Right Fist';
    fist.description = 'A martial artist\'s fist. Each hit unleashes an extra strike with a random weapon from your inventory.';
    fist.type = ItemType.WEAPON;
    fist.baseAttackSpeed = 0.8;
    fist.strengthScaling = 1;
    fist.price = 0;
    fist.sellPrice = 0;
    fist.rarity = ItemRarity.COMMON;
    fist.tier = 1;
    fist.image = 'assets/talents/Icon_Warrior_basic_01.png';
    fist.affectedStats = new AffectedStats();
    fist.affectedEnemyStats = new AffectedStats();
    (fist as any).itemCollections = new ArraySchema<number>();
    (fist as any).equipOptions = new ArraySchema<string>(slot);
    fist.triggerTypes = new ArraySchema<string>();
    fist.tags = new ArraySchema<string>(MARTIAL_FIST_TAG);
    return fist;
}

/** Keeps a Martial Artist's hands in their canonical state: any real item is stripped back to
 *  inventory, both hand slots hold a tagged ghost fist, and fists that leaked into the inventory
 *  (e.g. via a manual unequip) are removed. Idempotent — safe to run every aura tick, and also
 *  called from FightRoom.startWeaponAttackTimers so opponent snapshots saved before the fists
 *  existed still punch with both hands. */
export function ensureMartialFists(player: Player, client?: Client, talent?: Talent) {
    for (let i = player.inventory.length - 1; i >= 0; i--) {
        if (player.inventory[i].tags?.includes(MARTIAL_FIST_TAG)) {
            player.inventory.splice(i, 1);
        }
    }

    for (const slot of [EquipSlot.MAIN_HAND, EquipSlot.OFF_HAND]) {
        const equipped = player.equippedItems.get(slot);
        if (equipped && !equipped.tags?.includes(MARTIAL_FIST_TAG)) {
            if (client && talent) {
                client.send('combat_log', { text: `${player.name} is a martial artist and doesn't need a weapon!`, kind: 'talent', talentId: talent.talentId, attackerId: player.playerId } as CombatLogMessage);
            }
            player.setItemUnequipped(equipped, slot);
        }
        if (!player.equippedItems.get(slot)) {
            player.setItemEquipped(createMartialFist(slot), slot);
        }
    }
}

function clonedAsGhost(source: Item): Item {
    const raw = source.toJSON() as any;
    const { affectedStats, affectedEnemyStats, tags, equipOptions, itemCollections, triggerTypes, ...primitives } = raw;

    const ghost = new Item().assign(primitives);
    ghost.affectedStats = new AffectedStats().assign(affectedStats || {});
    ghost.affectedEnemyStats = new AffectedStats().assign(affectedEnemyStats || {});

    const equipOptionsArr = new ArraySchema<string>();
    if (equipOptions?.length) (equipOptions as string[]).forEach((e: string) => equipOptionsArr.push(e));
    (ghost as any).equipOptions = equipOptionsArr;

    const itemCollectionsArr = new ArraySchema<number>();
    if (itemCollections?.length) (itemCollections as number[]).forEach((c: number) => itemCollectionsArr.push(c));
    (ghost as any).itemCollections = itemCollectionsArr;

    const triggerTypesArr = new ArraySchema<string>();
    if (triggerTypes?.length) (triggerTypes as string[]).forEach((t: string) => triggerTypesArr.push(t));
    ghost.triggerTypes = triggerTypesArr;

    ghost.price = 0;
    ghost.sellPrice = 0;
    ghost.sold = false;
    ghost.equipped = false;
    ghost.tags = new ArraySchema<string>('dual_wield_copy');

    return ghost;
}

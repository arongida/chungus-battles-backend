import { TalentType } from '../types/TalentTypes';
import { Item } from '../../items/schema/ItemSchema';
import { OnDamageTriggerCommand } from '../../commands/triggers/OnDamageTriggerCommand';
import { TriggerType } from "../../common/types";
import { EquipSlot, ItemClass, ItemRarity, ItemType } from "../../items/types/ItemTypes";
import { rollTheDice } from "../../common/utils";
import { TalentBehaviorContext } from "./TalentBehaviorContext";
import { ArraySchema } from "@colyseus/schema";
import { AffectedStats } from "../../common/schema/AffectedStatsSchema";
import { getItemById } from "../../items/db/Item";
import { applyRarityUpgrade } from "../../commands/ShopUpgradeUtils";
import { CombatLogMessage, fmt } from "../../common/MessageTypes";
import { Talent } from "../schema/TalentSchema";

export function track(talent: Talent, activations: number, damage = 0, healing = 0, gold = 0, xp = 0) {
    talent.statActivations  += activations;  talent.totalActivations  += activations;
    talent.statDamageDealt  += damage;       talent.totalDamageDealt  += damage;
    talent.statHealingDone  += healing;      talent.totalHealingDone  += healing;
    talent.statGoldGained   += gold;         talent.totalGoldGained   += gold;
    talent.statXpGained     += xp;           talent.totalXpGained     += xp;
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

    [TalentType.POISON]: (context: TalentBehaviorContext) => {
        const { attacker, defender, client, clock, talent } = context;
        defender.addPoisonStacks(clock, client);
        track(talent, 1, 0, 0);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.POISON,
        });
    },

    [TalentType.INVIGORATE]: (context: TalentBehaviorContext) => {
        const { attacker, damage, client } = context;
        const leechAmount = damage * 0.15 + 1;
        attacker.hp += leechAmount;
        track(context.talent, 1, 0, leechAmount);
        client.send('combat_log', { text: `${attacker.name} leeches ${fmt(leechAmount)} health!`, kind: 'leech', talentId: context.talent.talentId, attackerId: attacker.playerId, healing: leechAmount } as CombatLogMessage);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.INVIGORATE,
        });
        client.send('healing', {
            playerId: attacker.playerId,
            healing: leechAmount,
        });
    },

    [TalentType.SNITCH]: (context: TalentBehaviorContext) => {
        const { attacker, defender, client, trigger, talent } = context;
        if (trigger === TriggerType.ACTIVE) {
            if (defender.strength > 1 && defender.strength > defender.accuracy) {
                talent.affectedEnemyStats.strength -= 1;
                talent.affectedStats.strength += 1;
                client.send('combat_log', { text: `${attacker.name} snitches 1 strength from ${defender.name}!`, kind: 'talent', talentId: talent.talentId, attackerId: attacker.playerId, defenderId: defender.playerId } as CombatLogMessage);
                client.send('trigger_talent', {
                    playerId: attacker.playerId,
                    talentId: TalentType.SNITCH,
                });
            }
        } else if (trigger === TriggerType.FIGHT_END) {
            talent.affectedEnemyStats.strength = 0;
            talent.affectedStats.strength = 0;
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
        track(context.talent, 1, 0, 0, 1);
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
        attacker.hp += reducedAmount;
        track(context.talent, 1, reducedAmount, reducedAmount);
        client.send('combat_log', { text: `${attacker.name} scams ${fmt(reducedAmount)} health from ${defender.name}!`, kind: 'leech', talentId: context.talent.talentId, attackerId: attacker.playerId, defenderId: defender.playerId, damage: reducedAmount, healing: reducedAmount } as CombatLogMessage);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.SCAM,
        });
        client.send('healing', {
            playerId: attacker.playerId,
            healing: amount,
        });
    },

    [TalentType.BANDAGE]: (context: TalentBehaviorContext) => {
        const { attacker, client } = context;
        const healing = 2 + attacker.level;
        attacker.hp += healing;
        track(context.talent, 1, 0, healing);
        client.send('combat_log', { text: `${attacker.name} restores ${fmt(healing)} health!`, kind: 'heal', talentId: context.talent.talentId, attackerId: attacker.playerId, healing } as CombatLogMessage);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.BANDAGE,
        });
        client.send('healing', {
            playerId: attacker.playerId,
            healing: healing,
        });
    },

    [TalentType.THROW_MONEY]: (context: TalentBehaviorContext) => {
        const { attacker, defender, client, commandDispatcher } = context;
        const initialDamage = 1 + attacker.gold * 0.5;
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
        const { attacker, client, talent } = context;
        const weapon = attacker.equippedItems.get(EquipSlot.MAIN_HAND);
        if (!weapon || weapon.rarity >= ItemRarity.LEGENDARY) return;

        // Lock rarity immediately so subsequent aura ticks skip this while the DB fetch is in flight
        const originalRarity = weapon.rarity;
        weapon.rarity = ItemRarity.LEGENDARY;

        const baseItem = await getItemById(weapon.itemId);
        if (!baseItem) return;

        // Restore so applyRarityUpgrade can increment step by step
        weapon.rarity = originalRarity;
        while (weapon.rarity < ItemRarity.LEGENDARY) {
            applyRarityUpgrade(weapon, baseItem, attacker, false);
        }

        client.send('combat_log', { text: `${attacker.name}'s ${weapon.name} becomes Legendary!`, kind: 'talent', talentId: talent.talentId, attackerId: attacker.playerId, itemId: weapon.itemId } as CombatLogMessage);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.WEAPON_WHISPERER,
        });
    },

    [TalentType.GOLD_GENIE]: (context: TalentBehaviorContext) => {
        const { attacker, client, talent } = context;
        talent.affectedStats.defense = attacker.gold * talent.activationRate;
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.GOLD_GENIE,
        });
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
        talent.affectedStats.attackSpeed = 1 + (attacker.defense * talent.activationRate * 0.01) + (attacker.dodgeRate * talent.activationRate * 0.01);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.ZEALOT,
        });
    },

    [TalentType.RESILIENCE]: (context: TalentBehaviorContext) => {
        const { defender, client, talent } = context;
        const healingAmount = talent.activationRate * defender.maxHp;
        defender.hp += healingAmount;
        track(talent, 1, 0, healingAmount);
        client.send('combat_log', { text: `${defender.name} recovers ${fmt(healingAmount)} health!`, kind: 'heal', talentId: talent.talentId, attackerId: defender.playerId, healing: healingAmount } as CombatLogMessage);
        client.send('trigger_talent', {
            playerId: defender.playerId,
            talentId: TalentType.RESILIENCE,
        });
        client.send('healing', {
            playerId: defender.playerId,
            healing: healingAmount,
        });
    },

    [TalentType.THORNY_FENCE]: (context: TalentBehaviorContext) => {
        const { attacker, defender, client, talent, commandDispatcher } = context;
        const reflectDamage = attacker.getDamageAfterDefense(talent.activationRate * defender.defense);

        commandDispatcher.dispatch(new OnDamageTriggerCommand(), {
            defender: attacker,
            damage: reflectDamage,
            attacker: defender,
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
        const random = Math.random();
        if (random < talent.activationRate) {
            commandDispatcher.dispatch(new OnDamageTriggerCommand(), {
                defender: attacker,
                damage: damage,
                attacker: defender,
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

        const extraXp = attacker.round * 2;
        attacker.xp += extraXp;
        track(talent, 1, 0, 0, 0, extraXp);

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
            attacker.xp += 1;
            track(talent, 1, 0, 0, 0, 1);
            client.send('combat_log', { text: `${attacker.name} gains +1 XP from the merchant's experience!`, kind: 'xp', talentId: talent.talentId, attackerId: attacker.playerId, xpDelta: 1 } as CombatLogMessage);
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
            defender.setInvincible(clock, talent.activationRate);
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

        track(talent, 1, 0, 0, talent.activationRate)

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

    [TalentType.MARTIAL_ARTIST]:
        (context: TalentBehaviorContext) => {
            const { attacker, client, talent } = context;

            const mainHandItem = attacker.equippedItems.get(EquipSlot.MAIN_HAND);
            const offHandItem = attacker.equippedItems.get(EquipSlot.OFF_HAND);
            if (mainHandItem || offHandItem) {
                client.send('combat_log', { text: `${attacker.name} is a martial artist and doesn't need a weapon!`, kind: 'talent', talentId: talent.talentId, attackerId: attacker.playerId } as CombatLogMessage);
                if (mainHandItem) attacker.setItemUnequipped(mainHandItem, EquipSlot.MAIN_HAND);
                if (offHandItem) attacker.setItemUnequipped(offHandItem, EquipSlot.OFF_HAND);
            }


            talent.affectedStats.accuracy = attacker.level * 2;
            talent.affectedStats.strength = attacker.level * 4;
            talent.affectedStats.dodgeRate = attacker.level * 20;
            talent.affectedStats.attackSpeed = 1 + attacker.level;


            // client.send(
            // 	'combat_log',
            // 	`${attacker.name} trained hard and gets: ${attacker.accuracy} accuracy, ${attacker.strength} strength and ${attacker.attackSpeed} attack speed!`
            // );
        },

    [TalentType.COMRADE]:
        (context: TalentBehaviorContext) => {
            const { attacker, client, shop } = context;
            attacker.gold = 0;
            attacker.xp += attacker.level * 2;
            const rewardCount = attacker.level + 1;

            for (let i = 0; i < rewardCount; i++) {
                if (shop[i]) {
                    shop[i].price = 0;
                    shop[i].sellPrice = 0;
                }
            }

            attacker.inventory.forEach(item => {
                item.price = 0;
                item.sellPrice = 0;
            });

            attacker.equippedItems.forEach(item => {
                item.price = 0;
                item.sellPrice = 0;
            });

            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.COMRADE,
            });
            client.send(
                'draft_log',
                `Comrade ${attacker.name} achieved the requirements of the five-year plan and gets a reward: The first ${rewardCount} items are free in the shop!`
            );
        },

    [TalentType.GAMBLER]:
        (context: TalentBehaviorContext) => {
            const { attacker, client, questItems } = context;

            if (
                !attacker.inventory.find((item) => item.itemId === 703) &&
                !(attacker.equippedItems.get(EquipSlot.OFF_HAND)?.itemId === 703)
            ) {
                const diceItem = questItems?.find((item) => item.itemId === 703);
                if (diceItem) {
                    diceItem.rarity = 2;
                    diceItem.description = 'Max damage equals your current income.';
                    attacker.getItem(diceItem);
                    client.send('draft_log', `${attacker.name} found a gambler's dice!`);
                    client.send('trigger_talent', {
                        playerId: attacker.playerId,
                        talentId: TalentType.GAMBLER,
                    });
                }
            }
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
                    ringWeapon.rarity = 2;
                    ringWeapon.description = 'Gains +0.1 x level strength per attack.';
                    attacker.getItem(ringWeapon);
                    client.send('draft_log', `${attacker.name} found a ring weapon!`);
                    client.send('trigger_talent', {
                        playerId: attacker.playerId,
                        talentId: TalentType.MAGIC_RING_WEAPON,
                    });
                }
            }
        },


    [TalentType.JOKER]:
        (context: TalentBehaviorContext) => {
            const { attacker, client, talent } = context;

            let stat = "";
            let amount = 0;

            const randomBonus = rollTheDice(1, 9);
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
                amount = attacker.level * 0.15;
                talent.affectedStats.flatDmgReduction += amount;
                stat = "flat damage reduction";
            } else if (randomBonus === 6) {
                amount = 10 * attacker.level;
                talent.affectedStats.dodgeRate += amount;
                stat = "dodge rate";
            } else if (randomBonus === 7) {
                amount = attacker.level * 0.05;
                talent.affectedStats.attackSpeed += amount;
                stat = "attack speed";
            } else if (randomBonus === 8) {
                amount = attacker.level;
                talent.affectedStats.income += amount;
                stat = "income";
            } else if (randomBonus === 9) {
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

    [TalentType.SHADY_SHIELDS]:
        (context: TalentBehaviorContext) => {
            const { attacker, shop } = context;

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
        },

    [TalentType.DUAL_WIELD]:
        (context: TalentBehaviorContext) => {
            const { attacker, talent } = context;

            // Remove ghost copies that leaked into inventory (e.g. from a prior setItemUnequipped)
            for (let i = attacker.inventory.length - 1; i >= 0; i--) {
                if (attacker.inventory[i].tags?.includes('dual_wield_copy')) {
                    attacker.inventory.splice(i, 1);
                }
            }

            const mainHand = attacker.equippedItems.get(EquipSlot.MAIN_HAND);
            const offHand = attacker.equippedItems.get(EquipSlot.OFF_HAND);
            const offHandIsGhost = offHand?.tags?.includes('dual_wield_copy');

            talent.affectedStats.attackSpeed = 1;

            if (!mainHand) {
                if (offHandIsGhost) attacker.setItemUnequipped(offHand, EquipSlot.OFF_HAND);
                return;
            }

            // Respect a real item the player placed in off hand
            if (offHand && !offHandIsGhost) {
                return;
            }

            // Ghost already matches — no need to re-equip, just refresh speed bonus
            if (offHandIsGhost && offHand.itemId === mainHand.itemId && offHand.rarity === mainHand.rarity) {
                talent.affectedStats.attackSpeed = 1 + mainHand.tier * talent.scaling;
                return;
            }

            attacker.setItemEquipped(clonedAsGhost(mainHand), EquipSlot.OFF_HAND);
            talent.affectedStats.attackSpeed = 1 + mainHand.tier * talent.scaling;
        },

    [TalentType.SHARPENING_STONE]:
        (context: TalentBehaviorContext) => {
            const { attacker, talent } = context;

            talent.affectedStats.strength = 0;
            talent.affectedStats.accuracy = 0;
            talent.affectedStats.maxHp = 0;
            talent.affectedStats.defense = 0;
            talent.affectedStats.dodgeRate = 0;
            talent.affectedStats.flatDmgReduction = 0;
            talent.affectedStats.income = 0;
            talent.affectedStats.hpRegen = 0;

            attacker.equippedItems.forEach((item) => {
                if (item.class === ItemClass.WARRIOR) {
                    talent.affectedStats.strength         += item.affectedStats.strength         * talent.activationRate;
                    talent.affectedStats.accuracy         += item.affectedStats.accuracy         * talent.activationRate;
                    talent.affectedStats.maxHp            += item.affectedStats.maxHp            * talent.activationRate;
                    talent.affectedStats.defense          += item.affectedStats.defense          * talent.activationRate;
                    talent.affectedStats.dodgeRate        += item.affectedStats.dodgeRate        * talent.activationRate;
                    talent.affectedStats.flatDmgReduction += item.affectedStats.flatDmgReduction * talent.activationRate;
                    talent.affectedStats.income           += item.affectedStats.income           * talent.activationRate;
                    talent.affectedStats.hpRegen          += item.affectedStats.hpRegen          * talent.activationRate;
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
            track(context.talent, 1, 0, 0, 1);
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
                track(talent, 1, 0, 0, 1);
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

    [TalentType.BARGAIN_HUNTER]:
        (context: TalentBehaviorContext) => {
            const { attacker, client, talent } = context;
            if (attacker.refreshShopCost !== 1) {
                attacker.refreshShopCost = 1;
            }
            if (talent.totalActivations === 0) {
                attacker.gold += talent.activationRate;
                track(talent, 1, 0, 0, 20);
                client.send('trigger_talent', {
                    playerId: attacker.playerId,
                    talentId: TalentType.BARGAIN_HUNTER,
                });
            }
        },

    [TalentType.ROGUE_3]:
        (context: TalentBehaviorContext) => {
            const { attacker, defender, client, clock, talent } = context;
            defender.addPoisonStacks(clock, client);
            track(talent, 1, 0, 0, 0);
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.ROGUE_3,
            });
        },

    [TalentType.WARRIOR_3]:
        (context: TalentBehaviorContext) => {
            const { attacker, defender, client, talent } = context;
            if (defender) {
                talent.affectedStats.defense = defender.defense * talent.scaling;
                talent.affectedStats.dodgeRate = defender.dodgeRate * talent.scaling;
                client.send('trigger_talent', {
                    playerId: attacker.playerId,
                    talentId: TalentType.WARRIOR_3,
                });
            }
        },

    [TalentType.MERCHANT_4]:
        (context: TalentBehaviorContext) => {
            const { attacker, client, talent } = context;
            attacker.xp += 2;
            track(talent, 1, 0, 0, 0, 2);
            client.send('combat_log', { text: `${attacker.name} gains +2 XP!`, kind: 'xp', talentId: talent.talentId, attackerId: attacker.playerId, xpDelta: 2 } as CombatLogMessage);
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.MERCHANT_4,
            });
        },

    [TalentType.WARRIOR_4]:
        (context: TalentBehaviorContext) => {
            const { attacker, client, talent } = context;
            const missingHPPercentage = (attacker.maxHp - attacker.hp) / attacker.maxHp;
            talent.affectedStats.strength = attacker.strength * missingHPPercentage + 10;
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.WARRIOR_4,
            });
        },

    [TalentType.ROGUE_4]:
        (context: TalentBehaviorContext) => {
            const { attacker, client } = context;
            attacker.gold += 1;
            track(context.talent, 1, 0, 0, 1);
            client.send('combat_log', { text: `${attacker.name} gets 1 gold!`, kind: 'reward', talentId: context.talent.talentId, attackerId: attacker.playerId, goldDelta: 1 } as CombatLogMessage);
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.ROGUE_4,
            });
        },

    [TalentType.MERCHANT_3]:
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
            talent.affectedStats.flatDmgReduction = Math.ceil(base.flatDmgReduction * bonusCoefficent);
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.MERCHANT_3,
            });
        },

    [TalentType.WARRIOR_5]:
        (context: TalentBehaviorContext) => {
            const { talent } = context;
            talent.affectedStats.strength = 100;
        },

    [TalentType.ROGUE_5]:
        (context: TalentBehaviorContext) => {
            const { attacker, client, talent } = context;
            talent.affectedStats.dodgeRate += 1;
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.ROGUE_5,
            });
        },

    [TalentType.JUST_A_SCRATCH]:
        (context: TalentBehaviorContext) => {
            const { defender, client, talent } = context;
            if (Math.random() < talent.activationRate) {
                defender.gold += 1;
                track(talent, 1, 0, 0, 1);
                client.send('combat_log', { text: `${defender.name} profits from pain, gaining 1 gold!`, kind: 'reward', talentId: talent.talentId, attackerId: defender.playerId, goldDelta: 1 } as CombatLogMessage);
                client.send('trigger_talent', {
                    playerId: defender.playerId,
                    talentId: TalentType.JUST_A_SCRATCH,
                });
            }
        },

    [TalentType.MERCHANT_5B]:
        (context: TalentBehaviorContext) => {
            const { attacker, client, shop } = context;
            const upgradable = shop?.filter(item => item.rarity < ItemRarity.LEGENDARY);
            if (!upgradable?.length) return;

            const item = upgradable[Math.floor(Math.random() * upgradable.length)];
            const originalPrice = item.price;
            const snapshot = new Item();
            snapshot.affectedStats = new AffectedStats().assign(item.affectedStats.toJSON());
            snapshot.sellPrice = item.sellPrice;
            snapshot.baseAttackSpeed = item.baseAttackSpeed;
            snapshot.baseMinDamage = item.baseMinDamage;
            snapshot.baseMaxDamage = item.baseMaxDamage;
            while (item.rarity < ItemRarity.MYTHIC) {
                applyRarityUpgrade(item, snapshot, attacker, false);
            }
            item.price = originalPrice;

            client.send('draft_log', `Black market contact: ${item.name} is now Legendary!`);
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.MERCHANT_5B,
            });
        },
}
    ;

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

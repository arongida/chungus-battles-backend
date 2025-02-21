import {TalentType} from '../types/TalentTypes';
import {TalentBehaviorContext} from './TalentBehaviorContext';
import {Item} from '../../items/schema/ItemSchema';
import {Talent} from '../schema/TalentSchema';
import {OnDamageTriggerCommand} from '../../commands/triggers/OnDamageTriggerCommand';
import {TriggerType} from "../../common/types";
import {EquipSlot} from "../../items/types/ItemTypes";
import {rollTheDice} from "../../common/utils";

export const TalentBehaviors = {
    [TalentType.RAGE]: (context: TalentBehaviorContext) => {
        const {talent, defender, client, trigger} = context;
        if (trigger === TriggerType.ON_DAMAGE) {
            talent.affectedStats.strength += talent.activationRate;
            client.send('combat_log', `${defender.name} rages, increased attack by 1!`);
            client.send('trigger_talent', {
                playerId: defender.playerId,
                talentId: TalentType.RAGE,
            });
        } else if (trigger === TriggerType.FIGHT_END) {
            talent.affectedStats.strength = 0;
        }
    },

    [TalentType.STAB]: (context: TalentBehaviorContext) => {
        const {talent, attacker, defender, client, commandDispatcher} = context;
        const stabDamage = talent.activationRate * 100 + (defender.maxHp - defender.hp) * talent.activationRate;
        const calculatedStabDamage = defender.getDamageAfterDefense(stabDamage);
        commandDispatcher.dispatch(new OnDamageTriggerCommand(), {
            defender: defender,
            damage: calculatedStabDamage,
            attacker: attacker,
        });
        defender.takeDamage(calculatedStabDamage, client);
        client.send('combat_log', `${attacker.name} stabs ${defender.name} for ${calculatedStabDamage} damage!`);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.STAB,
        });
    },

    [TalentType.BEAR]: (context: TalentBehaviorContext) => {
        const {talent, attacker, defender, client, commandDispatcher} = context;
        const bearDamage = talent.activationRate * 100 + attacker.maxHp * talent.activationRate;
        const calculatedBearDamage = defender.getDamageAfterDefense(bearDamage);
        commandDispatcher.dispatch(new OnDamageTriggerCommand(), {
            defender: defender,
            damage: calculatedBearDamage,
            attacker: attacker,
        });
        defender.takeDamage(calculatedBearDamage, client);
        client.send('combat_log', `${attacker.name} mauls ${defender.name} for ${calculatedBearDamage} damage!`);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.BEAR,
        });
    },

    [TalentType.ASSASSIN_AMUSEMENT]: (context: TalentBehaviorContext) => {
        const {attacker, client, talent, trigger} = context;
        if (trigger === TriggerType.ON_ATTACK) {
            talent.affectedStats.attackSpeed += talent.activationRate;
            client.send('combat_log', `${attacker.name} gains ${talent.activationRate * 100 - 100}% attack speed!`);
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.ASSASSIN_AMUSEMENT,
            });
        } else if (trigger === TriggerType.FIGHT_END) {
            talent.affectedStats.attackSpeed = 1;
        }
    },

    [TalentType.POISON]: (context: TalentBehaviorContext) => {
        const {attacker, defender, client, clock} = context;
        defender.addPoisonStacks(clock, client);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.POISON,
        });
    },

    [TalentType.INVIGORATE]: (context: TalentBehaviorContext) => {
        const {attacker, damage, client} = context;
        const leechAmount = damage * 0.15 + 2;
        attacker.hp += leechAmount;
        client.send('combat_log', `${attacker.name} leeches ${leechAmount} health!`);
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
        const {attacker, defender, client, trigger, talent} = context;
        if (trigger === TriggerType.ACTIVE) {
            if (defender.strength > 1) {
                talent.affectedEnemyStats.strength -= 1;
                talent.affectedStats.strength += 1;
                client.send('combat_log', `${attacker.name} snitches 1 strength from ${defender.name}!`);
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
        const {attacker, defender, client} = context;
        const stolenItemIndex = Math.floor(Math.random() * defender.inventory.length);
        const stolenItem = defender.inventory[stolenItemIndex];
        if (stolenItem) {
            defender.inventory.splice(stolenItemIndex, 1);
            client.send('combat_log', `${attacker.name} steals ${stolenItem.name} from ${defender.name}!`);
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.STEAL,
            });
            attacker.inventory.push(stolenItem);

        }
    },

    [TalentType.PICKPOCKET]: (context: TalentBehaviorContext) => {
        const {attacker, defender, client} = context;
        attacker.gold += 1;
        if (defender.gold > 0) defender.gold -= 1;
        client.send('combat_log', `${attacker.name} stole 1 gold from ${defender.name}!`);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.PICKPOCKET,
        });
    },

    [TalentType.SCAM]: (context: TalentBehaviorContext) => {
        const {attacker, defender, client, commandDispatcher} = context;
        const amount = attacker.level;
        commandDispatcher.dispatch(new OnDamageTriggerCommand(), {
            defender: defender,
            damage: amount,
            attacker: attacker,
        });
        defender.takeDamage(amount, client);
        attacker.hp += amount;
        client.send('combat_log', `${attacker.name} scams ${amount} health from ${defender.name}!`);
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
        const {attacker, client} = context;
        const healing = 2 + attacker.level;
        attacker.hp += healing;
        client.send('combat_log', `${attacker.name} restores ${healing} health!`);
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
        const {attacker, defender, client, commandDispatcher} = context;
        const initialDamage = 5 + attacker.gold * 0.5;
        const damage = defender.getDamageAfterDefense(initialDamage);

        commandDispatcher.dispatch(new OnDamageTriggerCommand(), {
            defender: defender,
            damage: damage,
            attacker: attacker,
        });

        defender.takeDamage(damage, client);
        client.send('combat_log', `${attacker.name} throws money for ${damage} damage!`);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.THROW_MONEY,
        });
    },

    [TalentType.DISARM]: (context: TalentBehaviorContext) => {
        const {attacker, defender, client} = context;
        const weapons: Item[] = defender.inventory.filter((item) => item.tags.includes('weapon'));
        if (weapons.length > 0) {
            const mostExpensiveWeapon: Item = weapons.reduce((maxWeapon: Item, currentWeapon: Item) => {
                return currentWeapon.price > maxWeapon.price ? currentWeapon : maxWeapon;
            }, weapons[0]);

            client.send('combat_log', `${defender.name} is disarmed! ${mostExpensiveWeapon.name} is disabled for the fight!`);
        } else {
            client.send('combat_log', `${defender.name} has no weapons to disarm!`);
        }
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.DISARM,
        });
    },

    [TalentType.WEAPON_WHISPERER]: (context: TalentBehaviorContext) => {
        const {attacker, client, talent} = context;

        //get equipped weapon
        const weapon = attacker.equippedItems.get(EquipSlot.MAIN_HAND);
        if (weapon) {
            attacker.equippedItems.delete(EquipSlot.MAIN_HAND)

            talent.affectedStats.strength += weapon.affectedStats.strength;
            talent.affectedStats.accuracy += weapon.affectedStats.accuracy;
            talent.affectedStats.maxHp += weapon.affectedStats.maxHp;
            talent.affectedStats.income += weapon.affectedStats.income;
            talent.affectedStats.attackSpeed += weapon.affectedStats.attackSpeed !== 1 ? (weapon.affectedStats.attackSpeed - 1) : 1;
            talent.affectedStats.hpRegen += weapon.affectedStats.hpRegen;
            talent.affectedStats.defense += weapon.affectedStats.defense;
            talent.affectedStats.dodgeRate += weapon.affectedStats.dodgeRate;
            talent.affectedStats.flatDmgReduction += weapon.affectedStats.flatDmgReduction;

            client.send('combat_log', `${attacker.name} consumed ${weapon.name}!`);
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.WEAPON_WHISPERER,
            });
        }
    },

    [TalentType.GOLD_GENIE]: (context: TalentBehaviorContext) => {
        const {attacker, client, talent} = context;
        talent.affectedStats.defense = attacker.gold * 2;
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.GOLD_GENIE,
        });
    },

    [TalentType.STRONG]: (context: TalentBehaviorContext) => {
        const {attacker, talent, client} = context;
        const hpBonus = attacker.maxHp * talent.activationRate;
        const attackBonus = attacker.strength * talent.activationRate;

        talent.affectedStats.maxHp = hpBonus;
        talent.affectedStats.strength = attackBonus;

        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.STRONG,
        });
    },

    [TalentType.INTIMIDATING_WEALTH]: (context: TalentBehaviorContext) => {
        const {attacker, defender, client, talent, trigger} = context;
        if (trigger === TriggerType.AURA) {
            if (!defender) return;
            const attackSpeedBonus = Math.min(0.01 + (attacker.income * 0.01)) * defender.attackSpeed;

            if (defender.attackSpeed <= 0.1) return;

            talent.affectedStats.attackSpeed += attackSpeedBonus;
            talent.affectedEnemyStats.attackSpeed -= attackSpeedBonus;

            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.INTIMIDATING_WEALTH,
            });
        } else if (trigger === TriggerType.FIGHT_END) {
            talent.affectedStats.attackSpeed = 1;
            talent.affectedEnemyStats.attackSpeed = 1;
        }
    },

    [TalentType.CORRODING_COLLECTION]: (context: TalentBehaviorContext) => {
        const {attacker, defender, client, clock} = context;
        const poisonStackToApply = defender.inventory.length * 2;
        defender.addPoisonStacks(clock, client, poisonStackToApply);

        client.send('combat_log', `${attacker.name} corrodes ${defender.name}'s collection!`);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.CORRODING_COLLECTION,
        });
    },

    [TalentType.ZEALOT]: (context: TalentBehaviorContext) => {
        const {attacker, client, talent} = context;
        talent.affectedStats.attackSpeed = 1 + (attacker.defense * talent.activationRate * 0.01);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.ZEALOT,
        });
    },

    [TalentType.RESILIENCE]: (context: TalentBehaviorContext) => {
        const {defender, client, talent} = context;
        const healingAmount = 1 + talent.activationRate * defender.maxHp;
        defender.hp += healingAmount;
        client.send('combat_log', `${defender.name} recovers ${healingAmount} health!`);
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
        const {attacker, defender, client, talent, commandDispatcher} = context;
        const reflectDamage = talent.activationRate * 100 + talent.activationRate * defender.defense;
        commandDispatcher.dispatch(new OnDamageTriggerCommand(), {
            defender: attacker,
            damage: reflectDamage,
            attacker: defender,
        });
        attacker.takeDamage(reflectDamage, client);
        client.send('combat_log', `${defender.name} reflects ${reflectDamage} damage to ${attacker.name}!`);
        client.send('trigger_talent', {
            playerId: defender.playerId,
            talentId: TalentType.THORNY_FENCE,
        });
    },

    [TalentType.EYE_FOR_AN_EYE]: (context: TalentBehaviorContext) => {
        const {attacker, defender, client, talent, damage, clock, commandDispatcher} = context;
        if (defender.talentsOnCooldown.includes(TalentType.EYE_FOR_AN_EYE)) {
            console.log('Eye for an eye is on cooldown');
            return;
        }
        const random = Math.random();
        if (random < talent.activationRate) {
            commandDispatcher.dispatch(new OnDamageTriggerCommand(), {
                defender: attacker,
                damage: damage,
                attacker: defender,
            });

            attacker.takeDamage(damage, client);

            client.send('combat_log', `${defender.name} reflects ${damage} damage to ${attacker.name}!`);
            client.send('trigger_talent', {
                playerId: defender.playerId,
                talentId: TalentType.EYE_FOR_AN_EYE,
            });

            defender.talentsOnCooldown.push(TalentType.EYE_FOR_AN_EYE);
            clock.setTimeout(() => {
                defender.talentsOnCooldown = defender.talentsOnCooldown.filter(
                    (talent) => talent !== TalentType.EYE_FOR_AN_EYE
                );
            }, 1000);
        }
    },

    [TalentType.TRICKSTER]: (context: TalentBehaviorContext) => {
        const {client, attacker, defender} = context;
        const enemyAttack = defender.strength;
        const playerAttack = attacker.strength;
        attacker.strength = enemyAttack;
        defender.strength = playerAttack;
        client.send('combat_log', `${attacker.name} tricks ${defender.name}!`);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.TRICKSTER,
        });
    },

    [TalentType.EVASION]: (context: TalentBehaviorContext) => {
        const {attacker, client, talent} = context;
        attacker.dodgeRate += talent.activationRate;
        client.send('combat_log', `${attacker.name} gains ${talent.activationRate * 100}% dodge chance!`);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.EVASION,
        });
    },

    [TalentType.FUTURE_NOW]: (context: TalentBehaviorContext) => {
        const {attacker, client, talent} = context;
        client.send('combat_log', 'You are in the future now! You gain extra gold and xp!');
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: talent.talentId,
        });
        attacker.rewardRound += talent.activationRate;
    },

    [TalentType.SMART_INVESTMENT]: (context: TalentBehaviorContext) => {
        const {attacker, client, talent} = context;
        const goldBonus = Math.max(Math.round(attacker.gold * talent.activationRate), 5);
        attacker.gold += goldBonus;
        client.send('combat_log', `You gained ${goldBonus} gold from selling loot!`);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.SMART_INVESTMENT,
        });
    },

    [TalentType.GUARDIAN_ANGEL]: (context: TalentBehaviorContext) => {
        const {attacker, client, defender, clock, talent, damage} = context;
        if (defender.hp - damage <= 0 && !defender.talentsOnCooldown.includes(TalentType.GUARDIAN_ANGEL)) {
            defender.hp = 1;
            defender.setInvincible(clock, talent.activationRate);
            defender.talentsOnCooldown.push(TalentType.GUARDIAN_ANGEL);

            client.send('combat_log', `You are invincible for ${talent.activationRate / 1000} seconds!`);
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.GUARDIAN_ANGEL,
            });
        }
    },

    [TalentType.PENNY_STOCKS]: (context: TalentBehaviorContext) => {
        const {client, attacker, clock, talent} = context;
        attacker.gold += talent.activationRate;
        client.send('draft_log', `Gained ${talent.activationRate} gold!`);

        attacker.talents = attacker.talents.filter((talent) => talent.talentId !== TalentType.PENNY_STOCKS);
        attacker.talents.push(
            new Talent({
                talentId: 7,
                name: 'Broken Penny Stocks',
                description: 'Already used',
                tier: 1,
                activationRate: 0,
                tags: ['talent', 'merchant', 'used'],
            })
        );
        clock.setTimeout(() => {
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: 7,
            });
        }, 100);
    },

    [TalentType.ROBBERY]: (context: TalentBehaviorContext) => {
        const {attacker, client, shop} = context;
        const randomItem = shop[Math.floor(Math.random() * shop.length)];
        if (randomItem) {
            attacker.gold += randomItem.price;
            attacker.getItem(randomItem);
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.ROBBERY,
            });
            client.send('draft_log', `Robbery talent activated! Gained ${randomItem.name}!`);
        }
    },

    [TalentType.MARTIAL_ARTIST]: (context: TalentBehaviorContext) => {
        const {attacker, client, talent} = context;

        const weapon = attacker.equippedItems.get(EquipSlot.MAIN_HAND);
        if (weapon) {
            client.send('combat_log', `${attacker.name} is a martial artist and doesn't need a weapon!`);
            attacker.setItemUnequipped(weapon, EquipSlot.MAIN_HAND);
        }


        talent.affectedStats.accuracy = attacker.level;
        talent.affectedStats.strength = attacker.level;
        talent.affectedStats.attackSpeed = 1 + attacker.level * 0.5;


        // client.send(
        // 	'combat_log',
        // 	`${attacker.name} trained hard and gets: ${attacker.accuracy} accuracy, ${attacker.strength} strength and ${attacker.attackSpeed} attack speed!`
        // );
    },

    [TalentType.COMRADE]: (context: TalentBehaviorContext) => {
        const {attacker, client, shop} = context;
        attacker.gold = 0;
        attacker.xp += attacker.level * 2;
        const rewardCount = attacker.level + 1;

        for (let i = 0; i < rewardCount; i++) {
            shop[i].price = 0;
        }

        attacker.inventory.forEach(item => {
            item.price = 0;
        });

        attacker.equippedItems.forEach(item => {
            item.price = 0;
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

    [TalentType.GAMBLER]: (context: TalentBehaviorContext) => {
        const {attacker, defender, client, commandDispatcher} = context;
        const weapon = attacker.equippedItems.get(EquipSlot.MAIN_HAND);

        if (weapon) {
            attacker.setItemUnequipped(weapon, EquipSlot.MAIN_HAND);
        }

        const initialDamage = rollTheDice(1, 6) + attacker.income;
        const damage = defender.getDamageAfterDefense(initialDamage);

        commandDispatcher.dispatch(new OnDamageTriggerCommand(), {
            defender: defender,
            damage: damage,
            attacker: attacker,
        });

        defender.takeDamage(damage, client);

        client.send('combat_log', `${attacker.name} rolls the dice and deals ${damage} damage!`);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.GAMBLER,
        });
    },

    [TalentType.MAGIC_RING_WEAPON]: (context: TalentBehaviorContext) => {
        const {attacker, defender, client, questItems, commandDispatcher} = context;

        if (
            !attacker.inventory.find((item) => item.itemId === 702) &&
            !(attacker.equippedItems.get(EquipSlot.MAIN_HAND)?.itemId === 702)
        ) {
            const ringWeapon = questItems.find((item) => item.itemId === 702);
            if (ringWeapon) {
                attacker.getItem(ringWeapon);
                client.send('combat_log', `${attacker.name} found a ring weapon!`);
                client.send('trigger_talent', {
                    playerId: attacker.playerId,
                    talentId: TalentType.MAGIC_RING_WEAPON,
                });
            }
        }

        if (defender && attacker.equippedItems.get(EquipSlot.MAIN_HAND)?.itemId === 702) {
            const ringWeapon = attacker.equippedItems.get(EquipSlot.MAIN_HAND);
            const damage = rollTheDice(attacker.accuracy, attacker.strength);
            const getDamageAfterDefense = defender.getDamageAfterDefense(damage);

            ringWeapon.affectedStats.strength += 0.1;

            commandDispatcher.dispatch(new OnDamageTriggerCommand(), {
                defender: defender,
                damage: getDamageAfterDefense,
                attacker: attacker,
            });
            commandDispatcher.dispatch(new OnDamageTriggerCommand(), {
                defender: defender,
                damage: getDamageAfterDefense,
                attacker: attacker,
            });

            defender.takeDamage(getDamageAfterDefense, client);
            client.send('combat_log', `${attacker.name} deals ${getDamageAfterDefense} damage with the magic ring!`);
            client.send('trigger_talent', {playerId: attacker.playerId, talentId: TalentType.MAGIC_RING_WEAPON});
        }
    },


    [TalentType.JOKER]: (context: TalentBehaviorContext) => {
        const {attacker, client, talent} = context;

        let stat = "";
        let amount = 0;

        const randomBonus = rollTheDice(1, 9);
        if (randomBonus === 1) {
            amount = 5 + attacker.level;
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
            amount = 9 + attacker.level;
            talent.affectedStats.defense += amount;
            stat = "defense";
        } else if (randomBonus === 5) {
            amount = attacker.level * 0.1;
            talent.affectedStats.flatDmgReduction += amount;
            stat = "flat damage reduction";
        } else if (randomBonus === 6) {
            amount = 10 + attacker.level;
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
            amount = attacker.level * 0.1;
            talent.affectedStats.hpRegen += amount;
            stat = "hp regeneration";
        }

        client.send('combat_log', `${attacker.name} gets ${amount} bonus ${stat} from Joker talent.`);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.JOKER,
        });
    },
};



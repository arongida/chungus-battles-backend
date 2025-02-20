import {TalentType} from '../types/TalentTypes';
import {TalentBehaviorContext} from './TalentBehaviorContext';
import {Item} from '../../items/schema/ItemSchema';
import {Talent} from '../schema/TalentSchema';
import {OnDamageTriggerCommand} from '../../commands/triggers/OnDamageTriggerCommand';
import {EquipSlot} from "../../items/types/ItemTypes";

export const TalentBehaviors = {
    [TalentType.RAGE]: (context: TalentBehaviorContext) => {
        const {talent, defender, client} = context;
        defender.strength += talent.activationRate;
        client.send('combat_log', `${defender.name} rages, increased attack by 1!`);

        client.send('trigger_talent', {
            playerId: defender.playerId,
            talentId: TalentType.RAGE,
        });
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
        const {attacker, client, talent} = context;
        // attacker.attackSpeed += talent.activationRate * attacker.baseAttackSpeed - attacker.baseAttackSpeed;
        client.send('combat_log', `${attacker.name} gains ${talent.activationRate * 100 - 100}% attack speed!`);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.ASSASSIN_AMUSEMENT,
        });
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
        const {attacker, defender, client} = context;
        if (defender.strength > 1) {
            defender.strength -= 1;
            attacker.strength += 1;
            client.send('combat_log', `${attacker.name} snitches 1 strength from ${defender.name}!`);
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.SNITCH,
            });
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
        const {attacker, client} = context;

        //get equipped weapon
        const weapon = attacker.equippedItems.get(EquipSlot.MAIN_HAND);
        if (weapon) {
            attacker.equippedItems.set(EquipSlot.MAIN_HAND, null);
            //TODO: increase base stats
            client.send('combat_log', `${attacker.name} consumed ${weapon.name}!`);
            client.send('trigger_talent', {
                playerId: attacker.playerId,
                talentId: TalentType.WEAPON_WHISPERER,
            });
        }
    },

    [TalentType.GOLD_GENIE]: (context: TalentBehaviorContext) => {
        const {attacker, client} = context;
        const defenseBonus = attacker.gold * 2;
        attacker.defense += defenseBonus;
        client.send('combat_log', `${attacker.name} gains ${defenseBonus} defense from Gold Genie!`);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.GOLD_GENIE,
        });
    },

    [TalentType.STRONG]: (context: TalentBehaviorContext) => {
        const {attacker, talent, client} = context;
        const hpBonus = attacker.hp * talent.activationRate;
        const attackBonus = attacker.strength * talent.activationRate;
        attacker.maxHp += hpBonus;
        attacker.baseStats.maxHp += hpBonus;
        attacker.hp += hpBonus;
        attacker.strength += attackBonus;
        attacker.baseStats.strength += attackBonus;
        client.send('combat_log', `${attacker.name} is strong hence gets an increase to stats!`);
        client.send('combat_log', `${attacker.name} gains ${hpBonus} hp!`);
        client.send('combat_log', `${attacker.name} gains ${attackBonus} strength!`);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.STRONG,
        });
    },

    [TalentType.INTIMIDATING_WEALTH]: (context: TalentBehaviorContext) => {
        const {attacker, defender, client} = context;
        if (!defender) return;
        const attackSpeedBonus = Math.min(0.01 + (attacker.income * 0.01)) * defender.attackSpeed;

        if (defender.attackSpeed <= 0.1) return;

        attacker.attackSpeed += attackSpeedBonus;
        defender.attackSpeed -= attackSpeedBonus;

        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.INTIMIDATING_WEALTH,
        });
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
        const {defender, client, talent} = context;
        const attackSpeedBuff = 0.02 + defender.defense * talent.activationRate * 0.01 + 1;
        // defender.attackSpeed += defender.baseAttackSpeed * attackSpeedBuff - defender.baseAttackSpeed;
        client.send('combat_log', `${defender.name} gains ${attackSpeedBuff * 100 - 100}% attack speed!`);
        client.send('trigger_talent', {
            playerId: defender.playerId,
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

    [TalentType.ARMOR_ADDICT]: (context: TalentBehaviorContext) => {
        // const {defender, client, talent} = context;
        // // const armorAddictReduction = talent.activationRate * defender.getNumberOfItemsForTags(['armor']);
        // //defender.damageToTake = damage - armorAddictReduction;
        // client.send('trigger_talent', {
        //     playerId: defender.playerId,
        //     talentId: TalentType.ARMOR_ADDICT,
        // });
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
        talent.affectedStats.attackSpeed = attacker.level * 0.5;


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

        function rollTheDice(min: number, max: number) {
            return Math.floor(Math.random() * (max - min + 1)) + min;
        }

        defender.takeDamage(damage, client);

        client.send('combat_log', `${attacker.name} rolls the dice and deals ${damage} damage!`);
        client.send('trigger_talent', {
            playerId: attacker.playerId,
            talentId: TalentType.GAMBLER,
        });
    },

    [TalentType.MAGIC_RING_WEAPON]: (context: TalentBehaviorContext) => {
        const {attacker, defender, client, talent, commandDispatcher, questItems} = context;

        if (
            !attacker.inventory.find((item) => item.itemId === 702) &&
            !attacker.equippedItems.get(EquipSlot.MAIN_HAND)
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

        if (attacker.equippedItems.get(EquipSlot.MAIN_HAND) && defender) {
            // const previousDamage = talent.savedValues?.damage ?? 0;
            // const newDamage = previousDamage + 1;
            // talent.savedValues = {damage: newDamage};
            // const getDamageAfterDefense = defender.getDamageAfterDefense(newDamage);
            //
            // commandDispatcher.dispatch(new OnDamageTriggerCommand(), {
            //     defender: defender,
            //     damage: getDamageAfterDefense,
            //     attacker: attacker,
            // });
            //
            // defender.takeDamage(getDamageAfterDefense, client);
            // client.send('combat_log', `${attacker.name} deals ${getDamageAfterDefense} damage with the magic ring!`);
            // client.send('trigger_talent', {playerId: attacker.playerId, talentId: TalentType.MAGIC_RING_WEAPON});
        }
    },
};

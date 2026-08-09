import { ItemBehaviorContext } from './ItemBehaviorContext';
import { TriggerType } from '../../common/types';
import { EquipSlot, ItemRarity } from '../types/ItemTypes';
import { CombatLogMessage, RewardGainMessage, fmt } from '../../common/MessageTypes';
import { grantLuckyFindMythicBonus, LUCKY_FIND_MYTHIC_BONUS_PERCENT } from '../../commands/ShopUpgradeUtils';
import {
    chungiHpDamageFraction,
    floweringStaffCooldownReduction,
    floweringStaffRegenSteal,
    FLOWERING_STAFF_MAX_STEAL,
    magicRingCooldownReduction,
    magicWandCooldownReduction,
    rerollMagicRingStats,
    rollMagicRingBonus,
    secondWindHealFraction,
    secondWindInvulnMs,
    SECOND_WIND_THRESHOLD,
    stackMagicRingBonuses,
    TWO_HANDED_PAIRED_SLOT,
    wandOfFireBurnStacks,
} from './uniqueItemBalance';
import { rollRandomLegendaryItemAtLevel } from './ringOfImmortality';
import type { Item } from '../schema/ItemSchema';

// Band of Vigor (27): whether this ring instance has already procced Second Wind in the
// current fight. Keyed by item instance and cleared on FIGHT_START, same pattern as the
// Flowering Staff's proc-cooldown map above.
const secondWindUsed = new WeakMap<Item, boolean>();

export const ItemBehaviors: Record<number | string, (context: ItemBehaviorContext) => void | Promise<void>> = {
    // Shields no longer have a type-keyed behavior here — the old flat fight-start
    // invulnerability was replaced by the shield-skill pool (ItemSkillType.AEGIS et al., see
    // ItemSkillBehaviors.ts and itemSkillBalance.ts's SHIELD_SKILLS), granted per-shield via
    // ensureShieldSkill instead of a blanket type behavior.
    // Flowering Staff (8) — 2-handed caster staff, no attack of its own (wielder fights with
    // Fists — see FightRoom.startWeaponAttackTimers, which skips baseAttackSpeed <= 0 weapons).
    // AURA: takes both hands (as before) and stamps its rarity-scaled cooldownReduction.
    // ACTIVE: steals hpRegen from the enemy every activation (shortened by cooldownReduction like
    // any other active skill) — wielder gains it, enemy loses it (can go negative and bleed, see
    // FightRoom.startRegenTimer). Uses the runtime-only skill stat channels (ItemSchema.ts) so the
    // steal total resets cleanly every fight with no separate per-fight state to track.
    8: ({ attacker, defender, trigger, item, client }) => {
        if (!attacker || !item) return;
        if (trigger === TriggerType.AURA) {
            let staffSlot: EquipSlot | null = null;
            attacker.equippedItems.forEach((equippedItem, slot) => {
                if (equippedItem.itemId === 8) staffSlot = slot as EquipSlot;
            });
            if (!staffSlot) return;
            // Takes both slots of its pair — mainHand/offHand as always, or armor/helmet for a
            // Martial Artist who equipped it there instead (TalentBehaviors.ts).
            const otherSlot = TWO_HANDED_PAIRED_SLOT[staffSlot];
            const otherItem = attacker.equippedItems.get(otherSlot);
            if (otherItem) attacker.setItemUnequipped(otherItem, otherSlot);
            item.affectedStats.cooldownReduction = floweringStaffCooldownReduction(item.rarity);
            // Re-set after mutating affectedStats — see CLAUDE.md's MapSchema change-detection
            // gotcha, same idiom as Magic Ring/Gambler's Dice below.
            attacker.equippedItems.forEach((equipped, slot) => {
                if (equipped === item) attacker.equippedItems.set(slot, equipped);
            });
        } else if (trigger === TriggerType.ACTIVE) {
            if (!defender) return;
            const alreadyStolen = item.skillAffectedStats.hpRegen;
            const steal = Math.min(floweringStaffRegenSteal(item.rarity), FLOWERING_STAFF_MAX_STEAL - alreadyStolen);
            if (steal <= 0) return;
            item.skillAffectedStats.hpRegen += steal;
            item.skillAffectedEnemyStats.hpRegen -= steal;
            client?.send('combat_log', {
                text: `${attacker.name}'s ${item.name} drains ${steal.toFixed(2)} hp regen from ${defender.name}!`,
                kind: 'item',
                attackerId: attacker.playerId,
                defenderId: defender.playerId,
                itemId: item.itemId,
            } as CombatLogMessage);
        }
    },

    // Chungi (7) — AURA: max damage scales with the wielder's max HP.
    7: ({ attacker, trigger, item }) => {
        if (trigger !== TriggerType.ON_ATTACK || !attacker || !item) return;
        item.baseMaxDamage = Math.round(attacker.maxHp * chungiHpDamageFraction(item.rarity));
    },

    // Wand of Fire (14) — no attack of its own (baseAttackSpeed 0; can be paired with a real
    // weapon in the other hand, unlike the 2-handed Flowering Staff). AURA: stamps its
    // rarity-scaled cooldownReduction. ACTIVE: applies burn stacks (flat DoT, expires fast).
    14: ({ attacker, defender, trigger, client, clock, item }) => {
        if (!attacker || !item) return;
        if (trigger === TriggerType.AURA) {
            item.affectedStats.cooldownReduction = magicWandCooldownReduction(item.rarity);
            // Re-set after mutating affectedStats — see CLAUDE.md's MapSchema change-detection
            // gotcha, same idiom as Magic Ring/Gambler's Dice below.
            attacker.equippedItems.forEach((equipped, slot) => {
                if (equipped === item) attacker.equippedItems.set(slot, equipped);
            });
        } else if (trigger === TriggerType.ACTIVE) {
            if (!defender || !client || !clock) return;
            defender.addBurnStacks(clock, client, wandOfFireBurnStacks(item.rarity));
            client?.send('combat_log', {
                text: `${attacker.name}'s ${item.name} ignites ${defender.name}!`,
                kind: 'item',
                attackerId: attacker.playerId,
                defenderId: defender.playerId,
                itemId: item.itemId,
            } as CombatLogMessage);
        }
    },

    // Haste of Dagger (19) — ON_DODGE: instantly counter-attack with this dagger.
    19: ({ attacker, defender, item, client, performWeaponAttack, isCounterAttack }) => {
        // defender is the dodger holding the dagger; never counter a counter.
        if (isCounterAttack || !attacker || !defender || !item || !performWeaponAttack) return;
        let daggerSlot: string | null = null;
        defender.equippedItems.forEach((equipped, slot) => {
            if (equipped === item) daggerSlot = slot;
        });
        if (!daggerSlot) return;
        client?.send('combat_log', {
            text: `${defender.name}'s ${item.name} flashes — counter-attack!`,
            kind: 'counter',
            attackerId: defender.playerId,
            defenderId: attacker.playerId,
            itemId: item.itemId,
        } as CombatLogMessage);
        performWeaponAttack(defender, attacker, item, daggerSlot);
    },

    // Zwei-Hander (4) — AURA: unequips any item in the other hand slot while equipped.
    4: ({ attacker, trigger }) => {
        if (trigger !== TriggerType.AURA || !attacker) return;
        let zweiSlot: EquipSlot | null = null;
        attacker.equippedItems.forEach((equippedItem, slot) => {
            if (equippedItem.itemId === 4) zweiSlot = slot as EquipSlot;
        });
        if (!zweiSlot) return;
        // Takes both slots of its pair — mainHand/offHand as always, or armor/helmet for a
        // Martial Artist who equipped it there instead (TalentBehaviors.ts).
        const otherSlot = TWO_HANDED_PAIRED_SLOT[zweiSlot];
        const otherItem = attacker.equippedItems.get(otherSlot);
        if (otherItem) attacker.setItemUnequipped(otherItem, otherSlot);
    },
    // Dagger of Poison (18) — rarity 2+: applies (rarity-1) poison stacks on hit.
    18: ({ defender, client, clock, item }) => {
        if (!defender || !client || !clock || !item) return;
        defender.addPoisonStacks(clock, client, item.rarity);
    },

    // Soulstealer's Scythe (59) — rarity 2+: heals for (rarity*5+5)% of damage dealt + 1 on hit.
    59: ({ attacker, defender, damage, client, item }) => {
        if (!attacker || !damage || !item) return;
        const heal = Math.floor(damage * (item.rarity * 5 + 5) / 100) + 1;
        const scytheHealed = attacker.heal(heal);
        if (scytheHealed > 0) {
            client?.send('healing', { playerId: attacker.playerId, healing: scytheHealed });
            client?.send('combat_log', { text: `${attacker.name}'s ${item.name} leeches ${fmt(scytheHealed)} health!`, kind: 'leech', attackerId: attacker.playerId, itemId: item.itemId, healing: scytheHealed } as CombatLogMessage)
        }
    },

    // Magic Ring (702) — not a weapon, doesn't attack. Starts Common with one
    // rolled stat. LEVEL_UP bumps its rarity and rolls another stat into the mix, until all 6
    // (including cooldownReduction) are relevant at Mythic (level 5). Rolled stats live directly
    // in affectedStats (no separate tracking needed) — see uniqueItemBalance.ts. AURA stamps a
    // flat cooldownReduction (kept OUT of the stacking pool — see MAGIC_RING_STAT_POOL comment —
    // so it can't compound with itself). ACTIVE stacks one rolled stat permanently, once per
    // activation (shortened by cooldownReduction like any other active skill, including the CDR
    // this same ring grants — a real snowball, but bounded by the hyperbolic CDR formula).
    // SHOP_START — while it sits unequipped in inventory, rerolls a fresh set
    // of stats for its current rarity, losing all stacking bonuses.
    702: ({ attacker, item, trigger, client }) => {
        if (!attacker || !item) return;

        if (trigger === TriggerType.SHOP_START) {
            let equipped = false;
            attacker.equippedItems.forEach((equippedItem) => {
                if (equippedItem === item) equipped = true;
            });
            if (!equipped) rerollMagicRingStats(item);
            return;
        }

        if (trigger === TriggerType.LEVEL_UP) {
            if (item.rarity >= ItemRarity.MYTHIC) return;
            item.rarity++;
            rollMagicRingBonus(item);
            // LEVEL_UP only ever resolves in DraftRoom (LevelUpTriggerCommand extends
            // Command<DraftRoom>), so draft_log is always the right channel here.
            if (item.rarity === ItemRarity.MYTHIC) {
                grantLuckyFindMythicBonus(attacker);
                client?.send('draft_log', `Permanent +${LUCKY_FIND_MYTHIC_BONUS_PERCENT}% Lucky Find chance from ${item.name} being Mythic!`);
                client?.send('reward_gain', { playerId: attacker.playerId, luckyFind: true } as RewardGainMessage);
            }
        } else if (trigger === TriggerType.AURA) {
            item.affectedStats.cooldownReduction = magicRingCooldownReduction(item.rarity);
        } else if (trigger === TriggerType.ACTIVE) {
            stackMagicRingBonuses(item);
        } else {
            return;
        }

        attacker.equippedItems.forEach((equipped, slot) => {
            if (equipped === item) attacker.equippedItems.set(slot, equipped);
        });
    },

    // Gambler's Dice (703) — evolves with player level (talent grants it at
    // rarity = level, capped Mythic, same as Magic Ring). LEVEL_UP bumps rarity
    // further; base attack speed scales +50% per tier and max damage = income *
    // (rarity/2), recomputed each fight/attack from current income.
    703: ({ attacker, item, trigger, client }) => {
        if (!attacker || !item) return;
        if (trigger === TriggerType.LEVEL_UP) {
            if (item.rarity < ItemRarity.MYTHIC) {
                item.rarity++;
                item.description = `Max damage equals ${Math.round((item.rarity / 2) * 100)}% of income.`;
                // LEVEL_UP only ever resolves in DraftRoom (LevelUpTriggerCommand extends
                // Command<DraftRoom>), so draft_log is always the right channel here.
                if (item.rarity === ItemRarity.MYTHIC) {
                    grantLuckyFindMythicBonus(attacker);
                    client?.send('draft_log', `Permanent +${LUCKY_FIND_MYTHIC_BONUS_PERCENT}% Lucky Find chance from ${item.name} being Mythic!`);
                    client?.send('reward_gain', { playerId: attacker.playerId, luckyFind: true } as RewardGainMessage);
                }
            }
        }
        item.baseAttackSpeed = 0.54 * (1 + 0.5 * (item.rarity - 1));
        item.baseMaxDamage = attacker.income * (item.rarity / 2);
        attacker.equippedItems.forEach((equipped, slot) => {
            if (equipped === item) attacker.equippedItems.set(slot, equipped);
        });
    },

    // Ring of Immortality (47) — grants no stats. SHOP_START: if it's still equipped
    // when the next draft phase begins (i.e. it was worn through a fight), it
    // transforms into a random item of the player's own tier, rolled up to Legendary.
    47: async ({ attacker, item, trigger, client }) => {
        if (trigger !== TriggerType.SHOP_START || !attacker || !item) return;

        let ringSlot: EquipSlot | null = null;
        attacker.equippedItems.forEach((equipped, slot) => {
            if (equipped === item) ringSlot = slot as EquipSlot;
        });
        if (!ringSlot) return;

        const newItem = await rollRandomLegendaryItemAtLevel(attacker);
        if (!newItem) return;

        // The rolled item can be any type (weapon/armor/helmet/shield) — never auto-equip
        // it into the ring's hand slot, since a helmet/armor/shield doesn't belong there.
        // Free the hand slot and drop the reward into inventory for the player to equip.
        attacker.equippedItems.delete(ringSlot);
        attacker.inventory.push(newItem);

        client?.send('draft_log', `Your Ring of Immortality transforms into ${newItem.name} (Legendary)!`);
    },

    // Band of Vigor (27) — a ring, not a weapon. FIGHT_START: resets its once-per-fight proc.
    // ON_DAMAGE (fires on the wearer as `defender`, covers weapon hits and poison/burn DoT): the
    // first time HP drops below SECOND_WIND_THRESHOLD, heal a chunk of max HP and grant a brief
    // window of invulnerability.
    27: ({ defender, item, trigger, clock, client }) => {
        if (!item) return;

        if (trigger === TriggerType.FIGHT_START) {
            secondWindUsed.delete(item);
            return;
        }

        if (trigger !== TriggerType.ON_DAMAGE) return;
        if (!defender || !clock) return;
        if (secondWindUsed.get(item)) return;
        if (defender.hp <= 0 || defender.hp / defender.maxHp >= SECOND_WIND_THRESHOLD) return;

        secondWindUsed.set(item, true);
        const healed = defender.heal(Math.round(defender.maxHp * secondWindHealFraction(item.rarity)));
        const durationMs = secondWindInvulnMs(item.rarity);
        defender.setInvincible(clock, durationMs, client);

        if (healed > 0) {
            client?.send('healing', { playerId: defender.playerId, healing: healed });
        }
        client?.send('combat_log', {
            text: `${defender.name}'s ${item.name} triggers Second Wind: ${fmt(healed)} hp and ${(durationMs / 1000).toFixed(1)}s invulnerability!`,
            kind: 'item',
            defenderId: defender.playerId,
            itemId: item.itemId,
            healing: healed,
        } as CombatLogMessage);
    },

};

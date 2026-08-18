// One-time-per-load migrations for the cooldown-reduction / active-skill rework (Season 24).
// Talents and items are embedded SNAPSHOTS inside the player document (see Player Copy
// Mechanism in CLAUDE.md) — a DB balance edit never reaches an already-owned copy on its own.
// These run on every load (players/db/Player.ts, items/db/Item.ts), same "reconcile on load"
// idiom as items/skills/itemSkillRoller.ts's reconcileItemSkill, so an old embedded Stab/
// Wand-of-Fire/Flowering-Staff/Magic-Ring copy converts to the new behavior instead of being
// stuck on its pre-rework trigger forever. Idempotent — safe to run on an already-migrated copy.
import { TalentType } from '../talents/types/TalentTypes';
import { Talent } from '../talents/schema/TalentSchema';
import { Item } from '../items/schema/ItemSchema';
import { TriggerType } from './types';
import {
    floweringStaffCooldownReduction,
    GAMBLERS_DICE_ITEM_ID,
    magicRingCooldownReduction,
    magicWandCooldownReduction,
} from '../items/behavior/uniqueItemBalance';

/** cooldownReduction granted by an active talent, by tier — see the Season 24 balance notes. */
const ACTIVE_TALENT_CDR_BY_TIER: Record<number, number> = { 2: 20, 3: 30, 4: 40, 5: 50 };

export function migrateLegacyTalent(talent: Talent): void {
    // Stab (29): pre-rework copies fired on-attack with the missing-HP coefficient stashed in
    // activationRate. Convert to the ACTIVE trigger + base/scaling shape used by the current
    // behavior (TalentBehaviors.ts).
    if (talent.talentId === TalentType.STAB && talent.triggerTypes.includes(TriggerType.ON_ATTACK)) {
        talent.triggerTypes.clear();
        talent.triggerTypes.push(TriggerType.ACTIVE);
        talent.activationRate = 0.25;
        talent.base = 1;
        talent.scaling = 0.06;
    }

    // Any active talent picked before this rework has no cooldownReduction on its embedded
    // affectedStats yet — backfill it from tier so it's not silently weaker than a freshly
    // picked copy of the same talent.
    if (talent.triggerTypes.includes(TriggerType.ACTIVE) && !talent.affectedStats.cooldownReduction) {
        const cdr = ACTIVE_TALENT_CDR_BY_TIER[talent.tier];
        if (cdr) talent.affectedStats.cooldownReduction = cdr;
    }

    // Pickpocket (ROGUE_1, 102): reworked Season 23 to grant its own dodge rating, so it can
    // actually trigger itself instead of sitting dead on a non-Thief build.
    if (talent.talentId === TalentType.ROGUE_1 && !talent.affectedStats.dodgeRate) {
        talent.affectedStats.dodgeRate = 15;
    }

    // Fire with Fire (31): reworked Season 24 from The Bear (an ON_ATTACK burn applicator, and
    // before that a flat max-HP-scaled hit) into an ACTIVE burn-consumer + heal at tier 4. Every
    // pre-rework copy — either shape — is still sitting on ON_ATTACK, so that's the one check
    // needed to catch both and convert to the current shape.
    if (talent.talentId === TalentType.FIRE_WITH_FIRE && talent.triggerTypes.includes(TriggerType.ON_ATTACK)) {
        talent.triggerTypes.clear();
        talent.triggerTypes.push(TriggerType.ACTIVE);
        talent.activationRate = 0.25;
        talent.base = 1;
        talent.tier = 4;
        talent.affectedStats.cooldownReduction = 40;
    }

    // Scam (5): reworked Season 24 from the dodge-fuelled HP steal into a pure economy active.
    // Written as an unconditional normalize rather than a guarded branch so it converts the S23
    // shape (ACTIVE + ON_DODGE + FIGHT_END, base 0.25, 10 dodge rating) and the older bare-ACTIVE
    // shape alike, and is a harmless no-op on an already-migrated copy.
    if (talent.talentId === TalentType.SCAM) {
        const onDodge = talent.triggerTypes.indexOf(TriggerType.ON_DODGE);
        if (onDodge !== -1) talent.triggerTypes.splice(onDodge, 1);
        if (!talent.triggerTypes.includes(TriggerType.FIGHT_END)) talent.triggerTypes.push(TriggerType.FIGHT_END);
        talent.base = 1;
        talent.scaling = 1;
        talent.affectedStats.dodgeRate = 0;      // S23 migration handed out 10 — strip it
        talent.affectedEnemyStats.strength = 0;  // clear residue from a fight that never hit FIGHT_END
    }

    // Bully (WARRIOR_2, 201): reworked Season 24 from "Warrior vol II." (a flat Strength-damage
    // active) into a conditional stun — see TalentBehaviors.ts. Pre-rework copies still carry
    // base: 0 (scaling: 2 was the old damage multiplier, now unused), which the new behavior would
    // read as a 0ms stun — a silent no-op that looks broken rather than a rework. Written as an
    // unconditional normalize, same idiom as the Scam/VIP Pass branches below, so it's a harmless
    // no-op once migrated and self-corrects any future retune of base/activationRate.
    if (talent.talentId === TalentType.WARRIOR_2) {
        talent.name = 'Bully';
        talent.description = 'Every 4s: if your Strength is higher than the enemy\'s right now, stun them for 1s — they cannot attack, regenerate, use skills or dodge. If you\'re not stronger, nothing happens. +20 ⏳';
        talent.activationRate = 0.25;
        talent.base = 1;
        talent.scaling = 0;
    }

    // VIP Pass (202): reworked Season 24 from Second Thoughts (a rogue BEFORE_REFRESH item-carry)
    // into a merchant AURA talent (guaranteed owned-item shop slot + flat lucky-find bonus). The
    // embedded copy is a full snapshot — triggerTypes, name, description, image and class tag all
    // need fixing, or a pre-rework copy would keep showing the old rogue icon/text and never fire
    // (BEFORE_REFRESH no longer exists as a dispatched trigger). affectedStats.luckyFindChance is
    // the ONLY source the behavior reads for its bonus (TalentBehaviors.ts) — a pre-rework copy
    // has it at the schema default of 0, so without this backfill a migrated VIP Pass would keep
    // its new aura trigger but silently grant no lucky-find bonus at all. Written as an
    // unconditional normalize, same idiom as the Scam branch above, so it's a harmless no-op once
    // migrated (a stale 0.10 from a future rebalance would still get corrected here on next load).
    if (talent.talentId === TalentType.VIP_PASS) {
        talent.triggerTypes.clear();
        talent.triggerTypes.push(TriggerType.AURA);
        talent.name = 'VIP Pass';
        talent.description = 'Every shop is guaranteed to stock an item you already own. +10% lucky find. Membership isn\'t free — rerolls cost 1 more gold.';
        talent.image = 'assets/talents/Icon_Merchant_basic_01.png';
        talent.affectedStats.luckyFindChance = 0.10;
        const rogueTag = talent.tags.indexOf('rogue');
        if (rogueTag !== -1) talent.tags.splice(rogueTag, 1);
        if (!talent.tags.includes('merchant')) talent.tags.push('merchant');
    }

    // Flash Sale (MERCHANT_1, 103): reworked from a per-refresh shop-wide price discount into a
    // potion-themed talent — grants a free Health Flask the moment it's picked and every round
    // after (SHOP_START), and raises active-potion capacity by 1 while owned (AURA) — see
    // TalentBehaviors.ts's grantFlashSaleFlask. A pre-rework copy is still sitting on
    // `after-refresh`, which the new behavior no longer reads at all (it branches on AURA/
    // SHOP_START only), so without this it would silently do nothing forever. Written as an
    // unconditional normalize, same idiom as the VIP Pass branch above, so it's a harmless no-op
    // once migrated.
    if (talent.talentId === TalentType.MERCHANT_1) {
        talent.triggerTypes.clear();
        talent.triggerTypes.push(TriggerType.SHOP_START, TriggerType.AURA);
        talent.description = 'Get a free Health Flask the moment you pick this, and another every round after. +1 active potion capacity.';
        talent.base = 0;
        talent.scaling = 0;
    }

    // Martial Artist (37): reworked Season 24 to also grant one free weapon the moment the
    // talent is picked, not just on level-up (TalentBehaviors.ts). The on-pick grant itself is
    // latched on talent.tags at runtime, so a pre-rework copy retroactively earns its one-time
    // bonus weapon on its very next AURA tick with no migration needed for that part — this only
    // refreshes the cosmetic description so an old copy doesn't keep showing stale card text.
    if (talent.talentId === TalentType.MARTIAL_ARTIST) {
        talent.description = 'Weapons can now be equipped in any slot. You find a free weapon the moment you take this, and again every time you level up.';
    }

    // Joker (41): reworked Season 24 from an unconditional single-stat drip into a two-card
    // pick-every-fight / suspend-until-picked mechanic (see jokerState.ts). The new behavior
    // needs the AURA trigger to run at all — DraftAuraTriggerCommand/FightAuraTriggerCommand only
    // invoke a talent's behavior for triggers listed in its own triggerTypes, and that's what
    // rebuilds affectedStats from the persisted running total and suspends it while a card is
    // pending. Without this, a pre-rework copy would keep auto-applying a single stat on
    // FIGHT_END but never suspend or restore anything, since nothing would ever call its AURA
    // branch. Push-if-missing rather than a full overwrite so it's a no-op once migrated.
    if (talent.talentId === TalentType.JOKER && !talent.triggerTypes.includes(TriggerType.AURA)) {
        talent.triggerTypes.push(TriggerType.AURA);
    }
}

const FLOWERING_STAFF_ITEM_ID = 8;
const WAND_OF_FIRE_ITEM_ID = 14;
const MAGIC_RING_ITEM_ID = 702;

export function migrateLegacyItem(item: Item): void {
    if (item.itemId === FLOWERING_STAFF_ITEM_ID || item.itemId === WAND_OF_FIRE_ITEM_ID) {
        if (!item.triggerTypes.includes(TriggerType.ACTIVE)) item.triggerTypes.push(TriggerType.ACTIVE);
        // baseAttackSpeed/baseMinDamage/baseMaxDamage are intentionally NOT touched here — both
        // items attack (very slowly; see their DB-authored baseAttackSpeed) rather than having no
        // attack at all. Forcing them to 0 on every load was a bug: it clobbered the DB-authored
        // values right back to 0 on the very next player load.
        if (!item.activationRate) item.activationRate = 0.5;
        if (!item.affectedStats.cooldownReduction) {
            item.affectedStats.cooldownReduction = item.itemId === FLOWERING_STAFF_ITEM_ID
                ? floweringStaffCooldownReduction(item.rarity)
                : magicWandCooldownReduction(item.rarity);
        }
    } else if (item.itemId === MAGIC_RING_ITEM_ID) {
        if (!item.triggerTypes.includes(TriggerType.ACTIVE)) item.triggerTypes.push(TriggerType.ACTIVE);
        if (!item.activationRate) item.activationRate = 1;
        if (!item.affectedStats.cooldownReduction) {
            item.affectedStats.cooldownReduction = magicRingCooldownReduction(item.rarity);
        }
    } else if (item.itemId === GAMBLERS_DICE_ITEM_ID) {
        // Gambler's Dice (703): reworked Season 24 to pay out on FIGHT_END (ItemBehaviors.ts) —
        // main hand gains permanent income on a win, off hand refunds gold on a loss. A
        // pre-rework copy's triggerTypes never included fight-end, so without this push it would
        // keep evolving on level-up but never pay out.
        if (!item.triggerTypes.includes(TriggerType.FIGHT_END)) item.triggerTypes.push(TriggerType.FIGHT_END);
    }
}

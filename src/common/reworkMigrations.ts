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
}

const FLOWERING_STAFF_ITEM_ID = 8;
const WAND_OF_FIRE_ITEM_ID = 14;
const MAGIC_RING_ITEM_ID = 702;

export function migrateLegacyItem(item: Item): void {
    if (item.itemId === FLOWERING_STAFF_ITEM_ID || item.itemId === WAND_OF_FIRE_ITEM_ID) {
        if (!item.triggerTypes.includes(TriggerType.ACTIVE)) item.triggerTypes.push(TriggerType.ACTIVE);
        // Pre-rework copies may carry a nonzero base damage/speed baked in directly (from
        // upgrades merged before the rework) — the item no longer attacks, so always zero these
        // regardless of how they got here. Idempotent for already-migrated copies.
        item.baseAttackSpeed = 0;
        item.baseMinDamage = 0;
        item.baseMaxDamage = 0;
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
    }
}

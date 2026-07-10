import { Player } from './schema/PlayerSchema';
import { ItemClass } from '../items/types/ItemTypes';

// Gaps reserved for future reveal talents ("increasingly reveal more info about your next
// opponent") — e.g. a future STATS = 50 tier between IDENTITY and FULL.
export enum EnemyRevealLevel {
    IDENTITY = 0,
    FULL = 100,
}

const CLASS_NAMES: string[] = Object.values(ItemClass); // rogue | warrior | merchant

/** Builds the server-side-redacted next-enemy preview synced on DraftState. Redaction happens
 *  here, before anything reaches the wire — the client never receives hidden data (anti-cheat). */
export function buildEnemyPreview(enemy: Player, level: EnemyRevealLevel): Player {
    const preview = new Player();
    if (!enemy) return preview;
    if (level >= EnemyRevealLevel.FULL) {
        preview.copyFrom(enemy);
        preview.sessionId = '';
        return preview;
    }
    if (level >= EnemyRevealLevel.IDENTITY) {
        preview.name = enemy.name;
        preview.avatarUrl = enemy.avatarUrl;
        preview.round = enemy.round;
        preview.level = enemy.level;
        // Deliberately NOT copied at this level: playerId (would enable /playerBuild
        // scouting), stats, talents, items. Talent/item CLASSES are revealed separately
        // via DraftState.nextEnemyTalentClasses/nextEnemyItemClasses (see the extractors
        // below) — classes only, never the concrete talents/items.
    }
    return preview;
}

/** Class tags (rogue/warrior/merchant) of the enemy's picked talents, duplicates kept so the
 *  client can show ×N counts. Talent tags look like ["talent","warrior","paladin"] — only the
 *  class-name entries are extracted. */
export function extractTalentClasses(enemy: Player): string[] {
    if (!enemy) return [];
    const classes: string[] = [];
    enemy.talents.forEach((talent) => {
        talent.tags?.forEach((tag) => {
            if (CLASS_NAMES.includes(tag)) classes.push(tag);
        });
    });
    return classes;
}

/** Classes (rogue/warrior/merchant) of the enemy's equipped items, duplicates kept so the
 *  client can show ×N counts. Classless items are skipped. */
export function extractItemClasses(enemy: Player): string[] {
    if (!enemy) return [];
    const classes: string[] = [];
    enemy.equippedItems.forEach((item) => {
        if (item.class && CLASS_NAMES.includes(item.class)) classes.push(item.class);
    });
    return classes;
}

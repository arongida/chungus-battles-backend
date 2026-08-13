import { Item } from '../src/items/schema/ItemSchema';
import { AffectedStats } from '../src/common/schema/AffectedStatsSchema';
import { cloneItem } from '../src/items/db/Item';
import { Player } from '../src/players/schema/PlayerSchema';
import { Talent } from '../src/talents/schema/TalentSchema';
import { TalentBehaviors } from '../src/talents/behavior/TalentBehaviors';
import { TalentType } from '../src/talents/types/TalentTypes';
import { EquipSlot } from '../src/items/types/ItemTypes';

// Regression guard for a bug class that has now shipped to prod twice: cloneItem's callers
// (including the Dual Wield ghost-copy behavior in TalentBehaviors.ts) round-trip a live Item
// through toJSON() and rebuild it with .assign(). Any @type(Schema-subclass) field on Item that
// isn't specifically excluded from that rebuild survives as a plain object, and Colyseus's typed
// setter throws EncodeSchemaError the moment it's assigned — silently, since both call sites
// (DraftAuraTriggerCommand, FightAuraTriggerCommand) swallow the exception in a try/catch. This
// happened once when skillAffectedStats/skillAffectedEnemyStats were added (fixed in fc44650),
// and again when skillAffectedStats2/skillAffectedEnemyStats2 were added (fixed alongside this
// test) — both times via a hand-maintained denylist (clonedAsGhost's own destructure) drifting
// out of sync with the schema instead of reusing the one place that already gets this right.

function buildFullyPopulatedItem(): Item {
    const item = new Item();
    item.itemId = 1;
    item.name = 'Test Sword';
    item.type = 'weapon';
    item.rarity = 4;
    item.baseAttackSpeed = 1.2;
    item.baseMinDamage = 3;
    item.baseMaxDamage = 8;

    item.affectedStats = new AffectedStats().assign({ strength: 3, accuracy: 4 });
    item.affectedEnemyStats = new AffectedStats().assign({ dodgeRate: -5 });

    // Both class-item skill slots populated, including their live/dynamic aura output — this is
    // exactly the state a real equipped item can be in when Dual Wield clones it mid-fight.
    item.skillId = 203;
    item.skillName = 'Titan\'s Might';
    item.skillDescription = 'Gain 1 strength per 12 max HP.';
    item.skillStatus = '+5 strength';
    item.skillAffectedStats = new AffectedStats().assign({ strength: 5 });
    item.skillAffectedEnemyStats = new AffectedStats().assign({ defense: -2 });

    item.skillId2 = 999;
    item.skillName2 = 'Second Skill';
    item.skillDescription2 = 'Weapon Whisperer bonus skill.';
    item.skillStatus2 = '+3 defense';
    item.skillAffectedStats2 = new AffectedStats().assign({ defense: 3 });
    item.skillAffectedEnemyStats2 = new AffectedStats().assign({ accuracy: -1 });

    return item;
}

/** Every field the Item schema declares as a Schema subtype (AffectedStats today, but this
 *  intentionally doesn't hardcode that name) must survive a clone as a real instance of that
 *  type, never a plain object left over from a toJSON() round trip. */
function assertNoRawSchemaFields(clone: Item) {
    const metadata: any = (Item as any)[Symbol.metadata];
    for (const key in metadata) {
        const field = metadata[key];
        const fieldType = field.type;
        if (typeof fieldType !== 'function') continue; // primitives ('number','string',...) and collections
        const value = (clone as any)[field.name];
        if (value === undefined || value === null) continue;
        expect(value).toBeInstanceOf(fieldType);
    }
}

describe('cloneItem', () => {
    it('does not throw when cloning an item with every skill/stat field populated', () => {
        const source = buildFullyPopulatedItem();
        expect(() => cloneItem(source)).not.toThrow();
    });

    it('rebuilds every Schema-typed field as a real instance, not a plain object', () => {
        const source = buildFullyPopulatedItem();
        const clone = cloneItem(source);
        assertNoRawSchemaFields(clone);
    });

    it('survives a clone-of-a-clone (the ghost path re-clones live, already-cloned items)', () => {
        const source = buildFullyPopulatedItem();
        const once = cloneItem(source);
        expect(() => cloneItem(once)).not.toThrow();
        const twice = cloneItem(once);
        assertNoRawSchemaFields(twice);
    });
});

// The bug actually shipped in TalentBehaviors.ts's own clonedAsGhost, a hand-rolled second copy
// of cloneItem's field-filtering logic that fell out of sync with the Item schema. cloneItem
// alone being correct (above) does NOT guard against that — clonedAsGhost is unexported, so this
// drives it the only way available: through the real DUAL_WIELD talent behavior, exactly as
// DraftAuraTriggerCommand/FightAuraTriggerCommand do every aura tick.
describe('DUAL_WIELD talent behavior', () => {
    function buildAttackerWithMainHandWeapon(): Player {
        const attacker = new Player();
        const mainHand = buildFullyPopulatedItem();
        attacker.setItemEquipped(mainHand, EquipSlot.MAIN_HAND);

        const talent = new Talent();
        talent.talentId = TalentType.DUAL_WIELD;
        attacker.talents.push(talent);

        return attacker;
    }

    it('does not throw when the main hand weapon has every skill field populated', () => {
        const attacker = buildAttackerWithMainHandWeapon();
        expect(() => TalentBehaviors[TalentType.DUAL_WIELD]({ attacker } as any)).not.toThrow();
    });

    it('copies the main hand weapon into an empty off hand', () => {
        const attacker = buildAttackerWithMainHandWeapon();
        TalentBehaviors[TalentType.DUAL_WIELD]({ attacker } as any);

        const offHand = attacker.equippedItems.get(EquipSlot.OFF_HAND);
        expect(offHand).toBeDefined();
        expect(offHand!.itemId).toBe(attacker.equippedItems.get(EquipSlot.MAIN_HAND)!.itemId);
        expect(offHand!.tags?.includes('dual_wield_copy')).toBe(true);
    });
});

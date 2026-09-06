import { ArraySchema } from '@colyseus/schema';
import { Player } from '../src/players/schema/PlayerSchema';
import { Item } from '../src/items/schema/ItemSchema';
import { Talent } from '../src/talents/schema/TalentSchema';
import { AffectedStats } from '../src/common/schema/AffectedStatsSchema';
import { FightRoom } from '../src/rooms/FightRoom';
import { DraftRoom } from '../src/rooms/DraftRoom';
import { OnDamageTriggerCommand } from '../src/commands/triggers/OnDamageTriggerCommand';
import { OnDodgeTriggerCommand } from '../src/commands/triggers/OnDodgeTriggerCommand';
import { TriggerType } from '../src/common/types';
import { TalentType } from '../src/talents/types/TalentTypes';
import { ItemSkillType } from '../src/items/types/ItemSkillTypes';
import { ItemRarity, EquipSlot } from '../src/items/types/ItemTypes';
import { ItemSkillBehaviors } from '../src/items/behavior/ItemSkillBehaviors';
import { parseJokerPendingCards, getJokerTotal } from '../src/talents/behavior/jokerState';

function player() { const p = new Player(); p.maxHp = 1000; p.hp = 1000; return p; }
function talent(id: TalentType) {
    const t = new Talent(); t.talentId = id;
    t.affectedStats = new AffectedStats(); t.affectedEnemyStats = new AffectedStats();
    t.triggerTypes = new ArraySchema(TriggerType.ON_DAMAGE); t.activationRate = 0.5;
    return t;
}
const client = { send: jest.fn() } as any;
beforeEach(() => client.send.mockClear());

test.each([1, 2])('Weapon Whisperer slot %i supports both empowered auto skills', slot => {
    for (const skill of [ItemSkillType.CRUSHING_BLOW, ItemSkillType.OPENING_ACT]) {
        const a = player(), d = player(), w = new Item();
        w.rarity = ItemRarity.MYTHIC; w.baseMinDamage = 10; w.baseMaxDamage = 10; w.strengthScaling = 1;
        w[slot === 1 ? 'skillId' : 'skillId2'] = skill;
        const room = { state: { playerClient: client }, dispatcher: { dispatch: jest.fn() }, logCombat: jest.fn() };
        for (let i = 0; i < 4; i++) FightRoom.prototype.tryWeaponAttack.call(room as any, a, d, w, EquipSlot.MAIN_HAND);
        expect(a.fightStats.empoweredAttacks).toBe(skill === ItemSkillType.CRUSHING_BLOW ? 2 : 4);
        expect(d.hp).toBeLessThan(960);
    }
});

test.each([{ hp: 1000, invincible: true, expected: 0 }, { hp: 1000, invincible: false, expected: 100 }, { hp: 20, invincible: false, expected: 20 }])('damage rewards count actual loss: %j', ({ hp, invincible, expected }) => {
    const a = player(), d = player(); d.hp = hp; d.invincible = invincible;
    const rage = talent(TalentType.RAGE), scratch = talent(TalentType.JUST_A_SCRATCH);
    d.talents.push(rage, scratch);
    OnDamageTriggerCommand.prototype.execute.call({ state: { playerClient: client }, room: { dispatcher: {} }, clock: {} } as any, { attacker: a, defender: d, damage: 100 });
    d.takeDamage(100, client);
    expect(scratch.statDamageDealt).toBe(expected);
    expect(rage.affectedStats.strength).toBe(expected ? 0.5 : 0);
});

test('regen continues during stun while attacks remain paused', () => {
    const p = player(); p.hp = 500; p.hpRegen = 10;
    const timer = () => ({ pause: jest.fn(), resume: jest.fn(), clear: jest.fn() });
    const attack = timer(), regen = timer(); p.attackTimers.set(EquipSlot.MAIN_HAND, attack as any);
    let regenTick: () => void, endStun: () => void;
    const clock = {
        setInterval: (fn: () => void) => { regenTick = fn; return regen; },
        setTimeout: (fn: () => void) => { endStun = fn; return timer(); },
    };
    FightRoom.prototype.startRegenTimer.call({ clock, state: { playerClient: client }, logCombat: jest.fn() } as any, p);
    p.setStunned(clock as any, 1000, client);
    regenTick!();
    expect(p.hp).toBe(510); expect(attack.pause).toHaveBeenCalledTimes(1);
    expect(regen.pause).not.toHaveBeenCalled();
    endStun!(); expect(attack.resume).toHaveBeenCalledTimes(1); expect(regen.resume).not.toHaveBeenCalled();
});

test.each([ItemRarity.LEGENDARY, ItemRarity.MYTHIC])('Fluid Motion rarity %i stacks on its owner and resets after combat', rarity => {
    const a = player(), d = player(); a.playerId = 1; d.playerId = 2;
    const item = new Item(); item.rarity = rarity; item.skillId = ItemSkillType.FLUID_MOTION;
    item.triggerTypes = new ArraySchema(TriggerType.ON_DODGE, TriggerType.FIGHT_END);
    item.skillAffectedStats = new AffectedStats(); d.equippedItems.set(EquipSlot.ARMOR, item);
    const command = { state: { playerClient: client }, room: {}, clock: {} };
    for (let i = 0; i < 3; i++) OnDodgeTriggerCommand.prototype.execute.call(command as any, { attacker: a, defender: d });
    expect(item.skillAffectedStats.attackSpeed).toBeCloseTo(1 + 3 * (rarity === ItemRarity.MYTHIC ? 0.1 : 0.05));
    expect(client.send).toHaveBeenCalledWith('trigger_item', expect.objectContaining({ playerId: 2 }));
    ItemSkillBehaviors[ItemSkillType.FLUID_MOTION]({ item, client, attacker: d, trigger: TriggerType.FIGHT_END });
    expect(item.skillAffectedStats.attackSpeed).toBe(1);
});

test('Joker offers an immediate choice, accepts it once, and cannot be selected twice', async () => {
    const p = player(); p.level = 3; const joker = talent(TalentType.JOKER);
    const room = { state: { player: p, remainingTalentPoints: 1, availableTalents: new ArraySchema(joker) }, updateTalentSelection: jest.fn() };
    await (DraftRoom.prototype as any).selectTalent.call(room, TalentType.JOKER, client);
    const cards = parseJokerPendingCards(joker.tags); expect(cards).toHaveLength(2);
    await (DraftRoom.prototype as any).selectTalent.call(room, TalentType.JOKER, client);
    expect(p.talents).toHaveLength(1); expect(parseJokerPendingCards(joker.tags)).toHaveLength(2);
    (DraftRoom.prototype as any).handleJokerPick.call(room, client, cards[0].stat);
    expect(parseJokerPendingCards(joker.tags)).toHaveLength(0);
    expect(getJokerTotal(joker.tags, cards[0].stat)).toBe(cards[0].amount);
    (DraftRoom.prototype as any).handleJokerPick.call(room, client, cards[0].stat);
    expect(getJokerTotal(joker.tags, cards[0].stat)).toBe(cards[0].amount);
});

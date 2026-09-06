import { Player } from '../src/players/schema/PlayerSchema';
import { Item } from '../src/items/schema/ItemSchema';
import { ItemRarity, EquipSlot, ItemType } from '../src/items/types/ItemTypes';
import { ItemSkillType } from '../src/items/types/ItemSkillTypes';
import { ITEM_SKILLS } from '../src/items/behavior/itemSkillBalance';
import { grantItemSkill } from '../src/items/skills/itemSkillRoller';
import { OnAttackedTriggerCommand } from '../src/commands/triggers/OnAttackedTriggerCommand';
import { ReplayRecorder } from '../src/replay/ReplayRecorder';

test.each([1, 2])('Riposte activates the reflecting shield once for fighter %i and records that target', ownerId => {
    const defender = new Player(), attacker = new Player();
    defender.playerId = ownerId; attacker.playerId = 3 - ownerId;
    for (const p of [defender, attacker]) { p.maxHp = 1000; p.hp = 1000; }
    defender.defense = 100;
    const shield = new Item(); shield.itemId = 99999; shield.type = ItemType.SHIELD;
    shield.rarity = ItemRarity.LEGENDARY;
    grantItemSkill(shield, ITEM_SKILLS[ItemSkillType.RIPOSTE]);
    defender.equippedItems.set(EquipSlot.OFF_HAND, shield);
    const recorder = new ReplayRecorder(() => 100);
    recorder.start({ player: {}, enemy: {}, round: 1, gameVersion: 27 });
    const client = { send: jest.fn((type, payload) => recorder.record('send', type, payload)) };
    OnAttackedTriggerCommand.prototype.execute.call({
        state: { playerClient: client }, clock: {}, room: { dispatcher: { dispatch: jest.fn() } },
    } as any, { attacker, defender, damage: 100 });
    expect(attacker.hp).toBe(970);
    expect(shield.skillAffectedStats.defense).toBe(-3);
    const activations = client.send.mock.calls.filter(([type]) => type === 'trigger_item');
    expect(activations).toEqual([['trigger_item', { playerId: ownerId, itemId: shield.itemId, slot: EquipSlot.OFF_HAND }]]);
    expect(recorder.events.filter(e => e.type === 'trigger_item').map(e => e.payload)).toEqual([activations[0][1]]);
});

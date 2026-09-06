import { ArraySchema } from '@colyseus/schema';
import { FightRoom } from '../src/rooms/FightRoom';
import { Client } from '@colyseus/core';
import { Player } from '../src/players/schema/PlayerSchema';
import { Item } from '../src/items/schema/ItemSchema';
import { EquipSlot, ItemRarity } from '../src/items/types/ItemTypes';
import { ItemSkillType } from '../src/items/types/ItemSkillTypes';
import { retributionCharge } from '../src/items/behavior/itemSkillState';
import { TalentBehaviors } from '../src/talents/behavior/TalentBehaviors';
import { Talent } from '../src/talents/schema/TalentSchema';
import { TalentType } from '../src/talents/types/TalentTypes';
import { FightStartTriggerCommand } from '../src/commands/triggers/FightStartTriggerCommand';
import { TriggerType } from '../src/common/types';
import { getSkillSlot2View } from '../src/items/skills/itemSkillSlot2View';

function setup(rarity = ItemRarity.LEGENDARY, secondSlot = false) {
    const player = new Player();
    player.maxHp = 1000;
    player.hp = 1000;
    const item = new Item();
    item.rarity = rarity;
    if (secondSlot) item.skillId2 = ItemSkillType.RETRIBUTION;
    else item.skillId = ItemSkillType.RETRIBUTION;
    player.equippedItems.set(EquipSlot.ARMOR, item);
    const client = { send: jest.fn() } as unknown as Client;
    return { player, item: secondSlot ? getSkillSlot2View(item) : item, client };
}

test('cumulative actual HP loss charges across healing and resets after a proc', () => {
    const { player, item, client } = setup();
    player.takeDamage(80, client);
    player.hp += 80;
    player.takeDamage(120, client);
    expect(player.empoweredAttackSource).toBe(item);
    expect(retributionCharge.get(item)).toBe(0);
    expect(client.send).toHaveBeenCalledWith('trigger_item', expect.objectContaining({ slot: EquipSlot.ARMOR }));
    player.takeDamage(300, client);
    expect(retributionCharge.get(item)).toBe(0);
    player.empoweredAttackSource = undefined;
    player.takeDamage(100, client);
    expect(player.empoweredAttackSource).toBeUndefined();
    expect(retributionCharge.get(item)).toBeCloseTo(0.1);
});

test('self-costs, poison and skill damage all charge from HP actually lost', () => {
    const { player, item, client } = setup();
    player.takeDamage(80, client, 'normal', 'self');
    expect(retributionCharge.get(item)).toBeCloseTo(0.08);
    player.takeDamage(60, client, 'poison');
    player.takeDamage(60, client, 'normal', 'skill');
    expect(player.empoweredAttackSource).toBe(item);
});

test('invulnerability prevents self-damage and burn from charging', () => {
    const { player, item, client } = setup();
    player.invincible = true;
    player.takeDamage(200, client, 'normal', 'self');
    player.takeDamage(200, client, 'burn');
    expect(player.hp).toBe(1000);
    expect(retributionCharge.get(item) ?? 0).toBe(0);
});

// Exercise the actual room timers without opening sockets or connecting to MongoDB.
function roomHarness(player: Player, enemy: Player, client: Client) {
    const ticks: (() => void)[] = [];
    const room = {
        state: { player, enemy, playerClient: client },
        clock: {
            setInterval: (fn: () => void) => { ticks.push(fn); return { clear: jest.fn() }; },
            setTimeout: jest.fn(),
        },
        dispatcher: { dispatch: jest.fn() },
        logCombat: jest.fn(),
        broadcast: jest.fn(),
    };
    return { room, ticks };
}

test("enemy-applied burn and the applier’s self-burn charge only their respective wearer", () => {
    const { player, item, client } = setup();
    const { player: enemy, item: enemyItem } = setup();
    const { room, ticks } = roomHarness(player, enemy, client);
    player.igniteEnemy(room.clock as any, client, enemy, 6);
    expect(player.burnStack).toBeGreaterThan(0);
    expect(enemy.burnStack).toBe(6);
    FightRoom.prototype.checkBurn.call(room as any, enemy, player);
    FightRoom.prototype.checkBurn.call(room as any, player, enemy);
    ticks[0]();
    expect(retributionCharge.get(item)).toBeCloseTo((1000 - player.hp) / 1000);
    expect(retributionCharge.get(item)).toBeGreaterThan(0);
    expect(retributionCharge.get(enemyItem) ?? 0).toBe(0);
    ticks[1]();
    expect(retributionCharge.get(enemyItem)).toBeCloseTo((1000 - enemy.hp) / 1000);
    expect(retributionCharge.get(enemyItem)).toBeGreaterThan(0);
});

test('actual escalating arena burn never charges either fighter', () => {
    const { player, item, client } = setup();
    const { player: enemy, item: enemyItem } = setup();
    const { room, ticks } = roomHarness(player, enemy, client);
    FightRoom.prototype.startEndBurnTimer.call(room as any);
    for (let i = 0; i < 4; i++) ticks[0]();
    expect(player.hp).toBeLessThanOrEqual(800);
    expect(enemy.hp).toBeLessThanOrEqual(800);
    expect(retributionCharge.get(item) ?? 0).toBe(0);
    expect(retributionCharge.get(enemyItem) ?? 0).toBe(0);
    expect(player.empoweredAttackSource).toBeFalsy();
    expect(enemy.empoweredAttackSource).toBeFalsy();
});

test('Mythic secondary skill charges at 15% and fight start clears progress', () => {
    const { player, item, client } = setup(ItemRarity.MYTHIC, true);
    player.takeDamage(149, client);
    expect(player.empoweredAttackSource).toBeFalsy();
    player.resetRetributionCharge();
    expect(retributionCharge.get(item)).toBe(0);
    player.takeDamage(150, client);
    expect(player.empoweredAttackSource).toBe(item);
});

test('another stored empowerment pauses charging; lethal damage does not arm an attack', () => {
    const { player, item, client } = setup();
    const other = new Item();
    player.empoweredAttackSource = other;
    player.takeDamage(250, client);
    expect(player.empoweredAttackSource).toBe(other);
    expect(retributionCharge.get(item) ?? 0).toBe(0);
    player.empoweredAttackSource = undefined;
    player.takeDamage(2000, client);
    expect(player.empoweredAttackSource).toBeUndefined();
});


test.each([2, 4])('Fortunes Fool with %i rerolls preserves partial charge or empowers at fight start', rerolls => {
    const { player, item, client } = setup();
    const enemy = new Player();
    const talent = new Talent();
    talent.talentId = TalentType.FORTUNES_FOOL;
    talent.base = 0.05;
    talent.scaling = 0.99;
    talent.triggerTypes = new ArraySchema<string>(TriggerType.FIGHT_START);
    player.talents.push(talent);
    player.rerollsThisRound = rerolls;
    player.invincible = true;
    retributionCharge.set(item, 0.19);
    FightStartTriggerCommand.prototype.applyFightStartEffects.call({
        state: { playerClient: client }, clock: {},
    } as any, player, enemy);
    expect(player.hp).toBe(1000 - rerolls * 50);
    if (rerolls === 4) expect(player.empoweredAttackSource).toBe(item);
    else {
        expect(player.empoweredAttackSource).toBeFalsy();
        expect(retributionCharge.get(item)).toBeCloseTo(0.1);
    }
});

test('actual Stab talent self-cost contributes to Retribution', () => {
    const { player, item, client } = setup();
    const { player: enemy } = setup();
    const talent = new Talent();
    talent.talentId = TalentType.STAB;
    talent.scaling = 0.1;
    TalentBehaviors[TalentType.STAB]({
        attacker: player, defender: enemy, talent, client,
        trigger: TriggerType.ACTIVE, commandDispatcher: { dispatch: jest.fn() } as any,
    });
    expect(player.hp).toBeLessThan(1000);
    expect(retributionCharge.get(item)).toBeCloseTo((1000 - player.hp) / 1000);
});

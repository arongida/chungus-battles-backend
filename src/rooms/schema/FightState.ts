import {ArraySchema, Schema, type} from '@colyseus/schema';
import {Player} from '../../players/schema/PlayerSchema';
import {Client, Delayed} from 'colyseus';
import {FightResultType} from '../../common/types';
import {Item} from '../../items/schema/ItemSchema';

export class FightState extends Schema {
    @type(Player) player: Player = new Player();
    @type(Player) enemy: Player = new Player();
    questItems: ArraySchema<Item> = new ArraySchema<Item>();
    battleStarted = false;
    skillsTimers: Delayed[] = [];
    fightResult: FightResultType;
    endBurnTimer: Delayed;
    endBurnDamage: number = 10;
    playerClient: Client;
}

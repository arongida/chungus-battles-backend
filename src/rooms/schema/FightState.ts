import {ArraySchema, Schema, type} from '@colyseus/schema';
import {Player} from '../../players/schema/PlayerSchema';
import {Client, Delayed} from 'colyseus';
import {FightResultType} from '../../common/types';
import {Talent} from '../../talents/schema/TalentSchema';
import {Item} from '../../items/schema/ItemSchema';
import {ItemCollection} from "../../item-collections/schema/ItemCollectionSchema";

export class FightState extends Schema {
    @type(Player) player: Player = new Player();
    @type(Player) enemy: Player = new Player();
    // availableItemCollections: ArraySchema<ItemCollection> = new ArraySchema<ItemCollection>();
    questItems: ArraySchema<Item> = new ArraySchema<Item>();
    availableTalents: Talent[] = [];
    battleStarted = false;
    skillsTimers: Delayed[] = [];
    fightResult: FightResultType;
    endBurnTimer: Delayed;
    endBurnDamage: number = 10;
    playerClient: Client;
}

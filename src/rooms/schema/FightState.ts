import {ArraySchema, Schema, type} from '@colyseus/schema';
import {Player} from '../../players/schema/PlayerSchema';
import {Client, Delayed} from 'colyseus';
import {END_BURN_START_MS, FightResultType} from '../../common/types';
import {Item} from '../../items/schema/ItemSchema';
import {LossRewardOptions, LossRewardResultMessage} from '../../common/MessageTypes';

export class FightState extends Schema {
    @type(Player) player: Player = new Player();
    @type(Player) enemy: Player = new Player();
    @type('number') timeScale: number = 1;
    @type('number') endBurnCountdownMs: number = END_BURN_START_MS;
    @type('boolean') endBurnActive: boolean = false;
    @type('number') endBurnDamage: number = 10;
    questItems: ArraySchema<Item> = new ArraySchema<Item>();
    battleStarted = false;
    skillsTimers: Delayed[] = [];
    fightResult: FightResultType;
    endBurnTimer: Delayed;
    playerClient: Client;
    gameWinPending: boolean = false;
    lossRewardPending: boolean = false;
    lossRewardOptions: LossRewardOptions | null = null;
    lossRewardOutcome: LossRewardResultMessage | null = null;
    lossRewardApplication: Promise<void> | null = null;
}

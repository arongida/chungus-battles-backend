import {Client} from 'colyseus';
import {Player} from '../players/schema/PlayerSchema';
import { ClockTimer } from '@colyseus/timer';
import {Item} from '../items/schema/ItemSchema';
import {ArraySchema} from '@colyseus/schema';
import {Talent} from '../talents/schema/TalentSchema';
import {Dispatcher} from '@colyseus/command';
import {FightRoom} from '../rooms/FightRoom';
import {DraftRoom} from '../rooms/DraftRoom';
import {TriggerType} from "./types";
import {StatsSnapshot} from './statsUtils';

export {StatsSnapshot};

export interface BehaviorContext {
    client: Client;
    attacker?: Player;
    defender?: Player;
    clock?: ClockTimer;
    damage?: number;
    shop?: ArraySchema<Item>;
    availableTalents?: Talent[];
    questItems?: ArraySchema<Item>;
    commandDispatcher?: Dispatcher<FightRoom | DraftRoom>
    trigger: TriggerType;
    weapon?: Item;
    attackerSnapshot?: StatsSnapshot;
    isReflectedDamage?: boolean;
    /** Executes a full weapon attack (FightRoom.tryWeaponAttack) — set on ON_DODGE for counter-attacks. */
    performWeaponAttack?: (attacker: Player, defender: Player, weapon: Item, slot: string) => void;
    /** True when this trigger chain originates from a counter-attack — prevents counter loops. */
    isCounterAttack?: boolean;
}

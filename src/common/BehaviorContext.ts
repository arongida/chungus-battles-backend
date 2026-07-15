import {Client} from 'colyseus';
import {Player} from '../players/schema/PlayerSchema';
import { ClockTimer } from '@colyseus/timer';
import {Item} from '../items/schema/ItemSchema';
import {ArraySchema} from '@colyseus/schema';
import {Talent} from '../talents/schema/TalentSchema';
import {Dispatcher} from '@colyseus/command';
import {FightRoom} from '../rooms/FightRoom';
import {DraftRoom} from '../rooms/DraftRoom';
import {TriggerType, FightResultType} from "./types";
import {StatsSnapshot} from './statsUtils';
import {DamageType} from './MessageTypes';

export {StatsSnapshot};

export interface BehaviorContext {
    client: Client;
    attacker?: Player;
    defender?: Player;
    clock?: ClockTimer;
    damage?: number;
    /** Source of the damage on ON_DAMAGE triggers — 'burn'/'poison' for DoT ticks, undefined for direct hits. */
    damageType?: DamageType;
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
    /** Outcome of the fight — set on FIGHT_END so talents can condition rewards on winning. */
    fightResult?: FightResultType;
}

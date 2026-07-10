import {Schema, type, ArraySchema} from '@colyseus/schema';
import {Player} from '../../players/schema/PlayerSchema';
import {Item} from '../../items/schema/ItemSchema';
import {Talent} from '../../talents/schema/TalentSchema';
import {Client} from 'colyseus';

export class DraftState extends Schema {
    @type(Player) player: Player = new Player();
    @type([Item]) shop: ArraySchema<Item> = new ArraySchema<Item>();
    @type([Talent]) availableTalents: ArraySchema<Talent> =
        new ArraySchema<Talent>();
    @type('number') shopSize: number = 6;
    @type('number') shopRefreshCost: number = 2;
    @type('number') remainingTalentPoints: number = 0;
    @type('boolean') hasFreeTalentReroll: boolean = false;
    @type('number') talentRerollCost: number = 0;
    @type([Item]) questItems: ArraySchema<Item> = new ArraySchema<Item>();
    // Drives the "Undo sell" button — true while the most recent sale can still be reverted.
    @type('boolean') canUndoSell: boolean = false;
    // Next-Enemy Preview: server-side-redacted preview of the locked-in next opponent
    // (see players/EnemyPreview.ts). New @type fields must stay appended LAST, in the same
    // order as the frontend DraftState mirror (skipHandshake schema compatibility).
    @type(Player) nextEnemy: Player = new Player();
    @type('number') nextEnemyRevealLevel: number = -1; // -1 = not populated → frontend hides badge
    // Talent/item CLASSES (rogue/warrior/merchant) of the next opponent — classes only, never
    // the concrete talents/items. Duplicates kept so the client can show ×N counts.
    @type(['string']) nextEnemyTalentClasses: ArraySchema<string> = new ArraySchema<string>();
    @type(['string']) nextEnemyItemClasses: ArraySchema<string> = new ArraySchema<string>();
    playerClient: Client;
}

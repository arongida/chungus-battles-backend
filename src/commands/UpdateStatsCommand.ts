import {Command} from '@colyseus/command';
import {FightRoom} from '../rooms/FightRoom';
import {DraftRoom} from '../rooms/DraftRoom';
import {DraftState} from "../rooms/schema/DraftState";
import {recalculatePlayerStats} from '../common/statsUtils';

/** Thin per-tick wrapper around statsUtils.recalculatePlayerStats — the actual stat
 *  computation lives there so out-of-room code (e.g. buildJoe's draft preview) can
 *  produce exactly the same final stats a room would. */
export class UpdateStatsCommand extends Command<
    FightRoom | DraftRoom
> {
    async execute() {
        if (!(this.state instanceof DraftState) && this.state.enemy) {
            recalculatePlayerStats(this.state.enemy, this.state.player);
            recalculatePlayerStats(this.state.player, this.state.enemy);
        } else {
            recalculatePlayerStats(this.state.player);
        }
    }
}

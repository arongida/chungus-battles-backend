import {Command} from '@colyseus/command';
import {FightRoom} from '../rooms/FightRoom';
import {DraftRoom} from '../rooms/DraftRoom';
import {DraftState} from "../rooms/schema/DraftState";
import {recalculatePlayerStats} from '../common/statsUtils';
import {refreshItemSkillStatus} from '../items/skills/itemSkillStatus';

/** Thin per-tick wrapper around statsUtils.recalculatePlayerStats — the actual stat
 *  computation lives there so out-of-room code (e.g. buildJoe's draft preview) can
 *  produce exactly the same final stats a room would. Also refreshes each player's live
 *  item-skill status line (itemSkillStatus.ts) right after their stats, so both read the
 *  same tick's skillAffectedStats output. */
export class UpdateStatsCommand extends Command<
    FightRoom | DraftRoom
> {
    async execute() {
        if (!(this.state instanceof DraftState) && this.state.enemy) {
            recalculatePlayerStats(this.state.enemy, this.state.player);
            recalculatePlayerStats(this.state.player, this.state.enemy);
            refreshItemSkillStatus(this.state.enemy, this.state.player, true, this.clock);
            refreshItemSkillStatus(this.state.player, this.state.enemy, true, this.clock);
        } else {
            recalculatePlayerStats(this.state.player);
            refreshItemSkillStatus(this.state.player, undefined, false);
        }
    }
}

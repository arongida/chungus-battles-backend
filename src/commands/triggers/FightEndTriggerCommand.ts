import {Command} from '@colyseus/command';
import {Talent} from '../../talents/schema/TalentSchema';
import {FightResultType, TriggerType} from '../../common/types';
import {FightRoom} from '../../rooms/FightRoom';
import {BehaviorContext} from '../../common/BehaviorContext';
import {triggerEquippedItems} from '../../common/triggerUtils';

/** WIN/LOSE flip to LOSE/WIN, DRAW stays DRAW — the enemy's fight-end trigger context needs the
 *  result from ITS OWN perspective (e.g. Gambler's Dice paying out on a win only pays the side
 *  that actually won), not the player's raw fightResult mirrored verbatim. */
function invertFightResult(result: FightResultType | undefined): FightResultType | undefined {
    if (result === FightResultType.WIN) return FightResultType.LOSE;
    if (result === FightResultType.LOSE) return FightResultType.WIN;
    return result;
}

export class FightEndTriggerCommand extends Command<FightRoom> {
    execute() {
        const fightEndBehaviorContext: BehaviorContext = {
            client: this.state.playerClient,
            attacker: this.state.player,
            defender: this.state.enemy,
            trigger: TriggerType.FIGHT_END,
            fightResult: this.state.fightResult,
        };

        const fightEndTalents: Talent[] = this.state.player.talents.filter((talent) =>
            talent.triggerTypes.includes(TriggerType.FIGHT_END)
        );

        fightEndTalents.forEach((talent) => {
            try {
                talent.executeBehavior(fightEndBehaviorContext);
            } catch (e) {
                console.error(e);
            }
        });

        triggerEquippedItems(this.state.player, fightEndBehaviorContext, TriggerType.FIGHT_END);
        triggerEquippedItems(this.state.enemy, {
            ...fightEndBehaviorContext,
            attacker: this.state.enemy,
            defender: this.state.player,
            fightResult: invertFightResult(this.state.fightResult),
        }, TriggerType.FIGHT_END);
    }
}

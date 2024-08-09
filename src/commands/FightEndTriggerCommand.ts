import { Command } from '@colyseus/command';
import { Talent } from '../talents/schema/TalentSchema';
import { TalentBehaviorContext } from '../talents/behavior/TalentBehaviorContext';
import { TriggerType } from '../common/types';
import { FightRoom } from '../rooms/FightRoom';

export class FightEndTriggerCommand extends Command<FightRoom> {
	execute() {
    const fightEndTalents: Talent[] = this.state.player.talents.filter((talent) =>
      talent.tags.includes(TriggerType.FIGHT_END)
    );
    const fightEndTalentsContext: TalentBehaviorContext = {
      client: this.state.playerClient,
      attacker: this.state.player,
    };
    fightEndTalents.forEach((talent) => {
      talent.executeBehavior(fightEndTalentsContext);
    });
	}
}

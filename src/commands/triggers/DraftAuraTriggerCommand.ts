import {Command} from '@colyseus/command';
import {TriggerType} from '../../common/types';
import {DraftRoom} from '../../rooms/DraftRoom';
import {Talent} from '../../talents/schema/TalentSchema';
import {TalentBehaviorContext} from "../../talents/behavior/TalentBehaviorContext";
import {triggerEquippedItems} from '../../common/triggerUtils';
import {buildBaseAndItemsSnapshot} from '../../common/statsUtils';
import {baseLuckyFindChance} from '../ShopUpgradeUtils';
import {TalentType} from '../../talents/types/TalentTypes';

export class DraftAuraTriggerCommand extends Command<DraftRoom> {
    execute() {
        const player = this.state.player;

        // Re-seed the hidden shop-roll stat from level every tick, before aura talents run,
        // so a talent that scales it (e.g. Black Market Contact) composes in the same pass.
        player.luckyFindChance = baseLuckyFindChance(player.level);

        const auraTalents: Talent[] = player.talents.filter((talent) => talent.triggerTypes?.includes(TriggerType.AURA));

        // Comrade sets the reroll cost to the player's income; it must run after any other
        // aura talent that also writes refreshShopCost (e.g. Bargain Hunter, which pins it to 1)
        // so the income-scaled cost is the value that sticks. V8's Array.sort is stable, so this
        // only moves Comrade to the end and leaves every other talent's relative order intact.
        auraTalents.sort((a, b) =>
            (a.talentId === TalentType.COMRADE ? 1 : 0) - (b.talentId === TalentType.COMRADE ? 1 : 0)
        );

        const attackerSnapshot = buildBaseAndItemsSnapshot(player);

        let behaviorContext: TalentBehaviorContext = {
            client: this.state.playerClient,
            attacker: player,
            shop: this.state.shop,
            questItems: this.state.questItems,
            trigger: TriggerType.AURA,
            attackerSnapshot,
        };

        auraTalents.forEach((talent) => {
            try {
                talent.executeBehavior(behaviorContext);
            } catch (e) {
                console.error(e);
            }
        });

        triggerEquippedItems(this.state.player, behaviorContext, TriggerType.AURA);
    }
}

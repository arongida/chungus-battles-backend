import {Command} from '@colyseus/command';
import {DraftRoom} from '../rooms/DraftRoom';
import {Player} from "../players/schema/PlayerSchema";
import {Item} from "../items/schema/ItemSchema";
import {ItemCollection} from "../item-collections/schema/ItemCollectionSchema";
import {AffectedStats} from "../common/schema/AffectedStatsSchema";

export class UpdateActiveItemSetsCommand extends Command<
    DraftRoom
> {
    async execute() {

        this.updatePlayerItemSets(this.state.player);
    }

    updatePlayerItemSets(player: Player) {



    }

}

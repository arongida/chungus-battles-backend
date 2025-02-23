import {Command} from '@colyseus/command';
import {DraftRoom} from '../rooms/DraftRoom';
import {Player} from "../players/schema/PlayerSchema";
import {ItemRarity} from "../items/types/ItemTypes";

export class UpdateItemRarityCommand extends Command<
    DraftRoom
> {
    async execute() {
        this.updateItemRarity(this.state.player);

    }

    updateItemRarity(player: Player) {

        player.equippedItems.forEach((equippedItem, slot) => {
            if (equippedItem.rarity >= ItemRarity.LEGENDARY) return;
            const mergeWith = player.inventory.find(item => item.itemId === equippedItem.itemId && item.rarity === equippedItem.rarity)
            if (mergeWith) {
                equippedItem.rarity++;
                equippedItem.affectedStats.mergeInto(mergeWith.affectedStats);
                equippedItem.price += mergeWith.price;
                player.inventory = player.inventory.filter(item => item !== mergeWith);
                player.equippedItems.set(slot, equippedItem);
            }
        })

        player.inventory.forEach(item => {
            if (item.rarity >= ItemRarity.LEGENDARY) return;
            const mergeWith = player.inventory.find(findItem => findItem.itemId === item.itemId && findItem.rarity === item.rarity && findItem !== item);
            if (mergeWith) {
                item.rarity++;
                item.affectedStats.mergeInto(mergeWith.affectedStats);
                item.price += mergeWith.price;
                player.inventory = player.inventory.filter(filterItem => filterItem !== mergeWith);
            }
        })


    }


}

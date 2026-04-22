import {Command} from '@colyseus/command';
import {DraftRoom} from '../rooms/DraftRoom';
import {Player} from "../players/schema/PlayerSchema";
import {ItemRarity} from "../items/types/ItemTypes";

export class UpdateItemRarityCommand extends Command<
    DraftRoom
> {
    async execute() {
        try {
            this.updateItemRarity(this.state.player);
        } catch (e) {
            console.error(e);
        }

    }

    updateItemRarity(player: Player) {

        player.equippedItems.forEach((equippedItem, slot) => {
            if (equippedItem.rarity >= ItemRarity.LEGENDARY) return;
            const mergeWith = player.inventory.find(item => item.itemId === equippedItem.itemId && item.rarity === equippedItem.rarity)
            if (mergeWith) {
                equippedItem.rarity++;
                equippedItem.affectedStats.mergeInto(mergeWith.affectedStats);
                equippedItem.setBonusStats.mergeInto(mergeWith.setBonusStats);
                this.mergeWeaponStats(equippedItem, mergeWith);
                equippedItem.price += mergeWith.price;
                const idx1 = player.inventory.indexOf(mergeWith);
                if (idx1 !== -1) player.inventory.splice(idx1, 1);
                player.equippedItems.set(slot, equippedItem);
            }
        })

        player.inventory.forEach(item => {
            if (item.rarity >= ItemRarity.LEGENDARY) return;
            const mergeWith = player.inventory.find(findItem => findItem.itemId === item.itemId && findItem.rarity === item.rarity && findItem !== item);
            if (mergeWith) {
                item.rarity++;
                item.affectedStats.mergeInto(mergeWith.affectedStats);
                item.setBonusStats.mergeInto(mergeWith.setBonusStats);
                this.mergeWeaponStats(item, mergeWith);
                item.price += mergeWith.price;
                const idx2 = player.inventory.indexOf(mergeWith);
                if (idx2 !== -1) player.inventory.splice(idx2, 1);
            }
        })


    }

    private mergeWeaponStats(target: any, source: any) {
        const hasDamage = target.baseMinDamage > 0 || target.baseMaxDamage > 0;
        if (hasDamage) {
            target.baseMinDamage += source.baseMinDamage;
            target.baseMaxDamage += source.baseMaxDamage;
        } else {
            target.baseAttackSpeed += source.baseAttackSpeed;
        }
    }


}

import {Command} from '@colyseus/command';
import {DraftRoom} from '../rooms/DraftRoom';
import {Player} from "../players/schema/PlayerSchema";
import {ItemRarity, ItemSet} from "../items/types/ItemTypes";

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
            const mergeWith = player.inventory.find(item => item.itemId === equippedItem.itemId && item.rarity === equippedItem.rarity);
            if (mergeWith) {
                this.applyMerge(equippedItem, mergeWith);
                const idx = player.inventory.indexOf(mergeWith);
                if (idx !== -1) player.inventory.splice(idx, 1);
                player.equippedItems.set(slot, equippedItem);
            }
        });

        player.inventory.forEach(item => {
            if (item.rarity >= ItemRarity.LEGENDARY) return;
            const mergeWith = player.inventory.find(other => other.itemId === item.itemId && other.rarity === item.rarity && other !== item);
            if (mergeWith) {
                this.applyMerge(item, mergeWith);
                const idx = player.inventory.indexOf(mergeWith);
                if (idx !== -1) player.inventory.splice(idx, 1);
            }
        });
    }

    private applyMerge(target: any, source: any) {
        target.rarity++;
        target.setBonusStats.mergeInto(source.setBonusStats);
        target.price += source.price;

        switch (target.set) {
            case ItemSet.ROGUE:
                target.affectedStats.mergeInto(source.affectedStats);
                target.baseAttackSpeed += source.baseAttackSpeed;
                break;
            case ItemSet.WARRIOR:
                target.affectedStats.mergeInto(source.affectedStats);
                target.baseMinDamage += source.baseMinDamage;
                target.baseMaxDamage += source.baseMaxDamage;
                break;
            case ItemSet.MERCHANT:
                target.affectedStats.mergeInto(source.affectedStats);
                target.affectedStats.mergeInto(source.affectedStats);
                break;
            default:
                target.affectedStats.mergeInto(source.affectedStats);
                target.baseMinDamage += source.baseMinDamage;
                target.baseMaxDamage += source.baseMaxDamage;
                target.baseAttackSpeed += source.baseAttackSpeed;
        }
    }


}

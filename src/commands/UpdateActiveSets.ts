import {Command} from '@colyseus/command';
import {DraftRoom} from '../rooms/DraftRoom';
import {Player} from "../players/schema/PlayerSchema";
import {EquipSlot} from "../items/types/ItemTypes";

export class UpdateActiveSets extends Command<DraftRoom> {

    async execute() {
        this.updateActiveSets(this.state.player);

    }

    updateActiveSets(player: Player) {

        player.equippedItems.forEach((equippedItem, equippedSlot) => {
            try {
                if (equippedItem.set) {
                    equippedItem.setActive = false;

                    const equipSlotsOptions = Object.values(EquipSlot) as EquipSlot[];

                    for (const slotOption of equipSlotsOptions) {
                        if (slotOption === equippedSlot) continue;
                        const itemToCheck = player.equippedItems.get(slotOption);
                        if (!itemToCheck) continue;

                        if (equippedItem.set === itemToCheck.set) {
                            equippedItem.setActive = true;
                            break;
                        }
                    }
                    player.equippedItems.set(equippedSlot, equippedItem);
                }
            } catch (e) {
                console.error(e);
            }
        })
    }
}

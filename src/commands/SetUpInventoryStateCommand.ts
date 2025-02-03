import { Command } from '@colyseus/command';
import { FightRoom } from '../rooms/FightRoom';
import { DraftRoom } from '../rooms/DraftRoom';
import { FightState } from '../rooms/schema/FightState';
import { Player } from '../players/schema/PlayerSchema';
import { AffectedStats, Item } from '../items/schema/ItemSchema';
import { getItemsById } from '../items/db/Item';
import { DraftState } from '../rooms/schema/DraftState';

export class SetUpInventoryStateCommand extends Command<
	FightRoom | DraftRoom,
	{
		playerObjectFromDb: Player;
		isEnemy: boolean;
	}
> {
	async execute({ playerObjectFromDb, isEnemy } = this.payload) {
		if (isEnemy) {
			if (this.state instanceof FightState) {
				const playerToSetUp = this.state.enemy;
				await this.setUpInventory(playerToSetUp, playerObjectFromDb);
			} else {
				throw new Error('Enemy state is not available in DraftRoom');
			}
		} else {
			const playerToSetUp = this.state.player;
			await this.setUpInventory(playerToSetUp, playerObjectFromDb);
		}
	}

	//create new item for the player in the roomstate from the player inventory in the db
	async setUpInventory(playerToSetUp: Player, playerObjectFromDb: Player) {

		const equippedItemIdsFromDb = playerObjectFromDb.equippedItems as unknown as number[];

		if (playerObjectFromDb.inventory.length > 0) {
			const itemsDataFromDb = (await getItemsById(
				playerObjectFromDb.inventory as unknown as number[]
			)) as Item[];
			playerObjectFromDb.inventory.forEach((itemId) => {
				let itemFromDb = itemsDataFromDb.find(
					(item) => item.itemId === (itemId as unknown as number)
				);
				const affectedStatsData = itemFromDb.affectedStats;
				itemFromDb.affectedStats = new AffectedStats().assign(affectedStatsData);
				const newItem = new Item().assign(itemFromDb);

				if (equippedItemIdsFromDb.includes(newItem.itemId)) {
					newItem.equipped = true;
					playerToSetUp.equippedItems.push(newItem);
				}
				playerToSetUp.inventory.push(newItem);
				playerToSetUp.initialInventory.push(newItem);
			});
		}
		await playerToSetUp.updateAvailableItemCollections();
		await playerToSetUp.updateActiveItemCollections();
	}
}

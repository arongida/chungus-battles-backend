import { Client } from '@colyseus/core';
import { DraftRoom } from '../rooms/DraftRoom';
import { EquipSlot } from '../items/types/ItemTypes';
import { BotAction } from './BotPolicy';

/**
 * A DraftRoom driven headlessly by a BotRunner instead of a real WebSocket client.
 * `maxClients = 0` — never joined by matchmaking, only ever created directly via
 * `matchMaker.createRoom('bot_draft', {})` (same pattern TournamentRunner uses for
 * `tournament_fight` — see src/tournament/TournamentRunner.ts's createHeadlessRoom).
 *
 * `onCreate`/`onAuth`/`onJoin`/`onLeave` are all INHERITED, NOT overridden — the bot runs
 * through the exact same session-claim, player-creation, shop-build, and copyPlayer-on-leave
 * path a real player does. The only thing this subclass adds is `performAction`, a switch that
 * calls straight through to DraftRoom's own (now-protected) action methods — a one-for-one
 * mirror of the `onMessage` wrappers registered in DraftRoom.onCreate (DraftRoom.ts:54-105).
 * That correspondence is the whole safety argument for this class: it can never do anything a
 * real client's messages couldn't already do.
 */
export class BotDraftRoom extends DraftRoom {
    maxClients = 0;

    async performAction(action: BotAction, client: Client): Promise<void> {
        switch (action.type) {
            case 'buy':
                return this.buyItem(action.itemId, client);
            case 'sell':
                return this.sellItem(action.uid);
            case 'undo_sell':
                this.undoSell(client);
                return;
            case 'equip':
                return this.equipItem(action.uid, action.slot as EquipSlot | 'drink', client);
            case 'unequip':
                return this.unequipItem(action.uid, action.slot as EquipSlot);
            case 'refresh_shop':
                return this.refreshShop(client);
            case 'buy_xp':
                return this.buyXp(4, 4, client);
            case 'level_up': {
                // Mirrors DraftRoom's own 'level_up' onMessage handler (DraftRoom.ts:77-82)
                // exactly: buy exactly enough XP to reach the next level.
                const player = this.state.player;
                const purchases = Math.ceil((player.maxXp - player.xp) / 4);
                return this.buyXp(purchases * 4, purchases * 4, client);
            }
            case 'select_talent':
                return this.selectTalent(action.talentId, client);
            case 'refresh_talent_slot':
                return this.handleRefreshTalentSlot(client, action.talentId);
            case 'joker_pick':
                this.handleJokerPick(client, action.stat);
                return;
            case 'lock_shop':
                await this.handleLockShop(client);
                return;
            case 'unlock_shop':
                await this.handleUnlockShop(client);
                return;
            case 'end_draft':
                return;
        }
    }
}

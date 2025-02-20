import {Command} from '@colyseus/command';
import {FightRoom} from '../rooms/FightRoom';
import {DraftRoom} from '../rooms/DraftRoom';
import {Player} from "../players/schema/PlayerSchema";
import {DraftState} from "../rooms/schema/DraftState";
import {AffectedStats} from "../common/schema/AffectedStatsSchema";

export class UpdateStatsCommand extends Command<
    FightRoom | DraftRoom
> {
    async execute() {
        if (!(this.state instanceof DraftState) && this.state.enemy) {
            this.updatePlayer(this.state.enemy);
        }

        this.updatePlayer(this.state.player);
    }

    updatePlayer(player: Player) {
        const previousMaxHp = player.maxHp ?? player.hp; // Store previous max HP (fallback to current HP if undefined)
        const previousHp = player.hp ?? player.maxHp; // Store previous HP (fallback to full HP if undefined)

        const damageTaken = previousMaxHp - previousHp; // Calculate exact damage

        this.setStats(player, player.baseStats);
        this.state.player.equippedItems.forEach((value) => {
            this.increaseStats(player, value.affectedStats);
        });
        this.state.player.talents.forEach((talent) => {
            this.increaseStats(player, talent.affectedStats);
        });
        this.state.player.activeItemCollections.forEach((collection) => {
            this.increaseStats(player, collection.affectedStats);
        });

        player.hp = player.maxHp - damageTaken;
    }


    increaseStats(player: Player, affectedStats: AffectedStats) {
        try {
            player.strength += affectedStats.strength;
            player.accuracy += affectedStats.accuracy;
            player.defense += affectedStats.defense;
            player.attackSpeed += affectedStats.attackSpeed;
            player.dodgeRate += affectedStats.dodgeRate;
            player.flatDmgReduction += affectedStats.flatDmgReduction;
            player.income += affectedStats.income;
            player.hpRegen += affectedStats.hpRegen;
            player.maxHp += affectedStats.maxHp;
        } catch (e) {
            console.error('Failed to increase stats!')
        }
    }


    setStats(player: Player, affectedStats: AffectedStats) {
        player.strength = affectedStats.strength;
        player.accuracy = affectedStats.accuracy;
        player.maxHp = affectedStats.maxHp;

        player.defense = affectedStats.defense;
        player.attackSpeed = affectedStats.attackSpeed;
        player.dodgeRate = affectedStats.dodgeRate;
        player.flatDmgReduction = affectedStats.flatDmgReduction;
        player.income = affectedStats.income;
        player.hpRegen = affectedStats.hpRegen;
    }
}

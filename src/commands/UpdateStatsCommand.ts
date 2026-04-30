import {Command} from '@colyseus/command';
import {FightRoom} from '../rooms/FightRoom';
import {DraftRoom} from '../rooms/DraftRoom';
import {Player} from "../players/schema/PlayerSchema";
import {DraftState} from "../rooms/schema/DraftState";
import {AffectedStats} from "../common/schema/AffectedStatsSchema";
import {addStats} from '../common/statsUtils';

export class UpdateStatsCommand extends Command<
    FightRoom | DraftRoom
> {
    async execute() {
        if (!(this.state instanceof DraftState) && this.state.enemy) {
            this.updatePlayer(this.state.enemy, this.state.player);
            this.updatePlayer(this.state.player, this.state.enemy);
        } else {
            this.updatePlayer(this.state.player);
        }

    }

    updatePlayer(player: Player, enemy?: Player) {
        const previousMaxHp = player.maxHp ?? player.hp;
        const previousHp = player.hp ?? player.maxHp;
        const damageTaken = previousMaxHp - previousHp;

        player.attackSpeedMultiplier = 1;

        this.setStats(player, player.baseStats);

        player.equippedItems.forEach((value) => {
            this.increaseStats(player, value.affectedStats);
            if (value.setActive) this.increaseStats(player, value.setBonusStats);
        });
        player.talents.forEach((talent) => {
            this.increaseStats(player, talent.affectedStats);
        });
        if (enemy) {
            enemy.talents.forEach((talent) => {
                this.increaseStats(player, talent.affectedEnemyStats);
            });
            enemy.equippedItems.forEach((item) => {
                if (item.affectedEnemyStats) {
                    this.increaseStats(player, item.affectedEnemyStats);
                }
            });
        }

        player.attackSpeed = player.attackSpeedMultiplier;
        player.hp = player.maxHp - damageTaken;
    }


    increaseStats(player: Player, affectedStats: AffectedStats) {
        try {
            addStats(player, affectedStats);
            if (affectedStats.attackSpeed !== 0 && affectedStats.attackSpeed !== 1) {
                player.attackSpeedMultiplier *= affectedStats.attackSpeed;
            }
        } catch (e) {
            console.error('Failed to increase stats for player: ', player?.name)
            console.error(e)
        }
    }


    setStats(player: Player, affectedStats: AffectedStats) {
        try {
            player.strength = affectedStats.strength;
            player.accuracy = affectedStats.accuracy;
            player.maxHp = affectedStats.maxHp;
            player.defense = affectedStats.defense;
            player.attackSpeed = affectedStats.attackSpeed;
            player.attackSpeedMultiplier = affectedStats.attackSpeed;
            player.dodgeRate = affectedStats.dodgeRate;
            player.flatDmgReduction = affectedStats.flatDmgReduction;
            player.income = affectedStats.income;
            player.hpRegen = affectedStats.hpRegen;
        } catch (e) {
            console.error('Failed to set stats for player: ', player?.name);
            console.error(e);
        }
    }
}

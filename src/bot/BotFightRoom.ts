import { Client } from '@colyseus/core';
import { FightRoom } from '../rooms/FightRoom';
import { FightResultType } from '../common/types';
import { FightStatsMessage } from '../common/MessageTypes';
import { BotPolicy } from './BotPolicy';
import { buildLossRewardObservation } from './observation';

export interface BotFightOutcome {
    result: FightResultType;
    gameWinPending: boolean;
    livesAfter: number;
    winsAfter: number;
    stats: FightStatsMessage | null;
    replayId?: string;
    durationMs: number;
    lossRewardChoice?: 'gold' | 'xp' | 'item_upgrade';
}

/**
 * A FightRoom driven headlessly by a BotRunner. `maxClients = 0`, created directly via
 * `matchMaker.createRoom('bot_fight', {})`.
 *
 * Unlike src/tournament/TournamentFightRoom.ts — which deliberately SKIPS progression (wins,
 * lives, gold, xp, saveReplay) because a tournament fight must never touch a character's real
 * run — this room wants the OPPOSITE: full progression, exactly like a live fight, because a bot
 * run is a real run. So `handleFightEnd` calls `await super.handleFightEnd()` first (which is
 * where FightRoom's win/lose/draw handling, reward payout, and replay save all happen — see
 * FightRoom.ts:961-1034) and only adds the one thing a live fight relies on a connected client
 * for: answering the loss-reward prompt.
 *
 * `onJoin`/`onLeave`/`onCreate`/`startBattle`/`concludeBattle` are all INHERITED, NOT
 * overridden — pickEnemy, the countdown, and combat itself all run unmodified.
 */
export class BotFightRoom extends FightRoom {
    maxClients = 0;
    protected replayKind: 'run' | 'bot' | 'tournament' = 'bot';

    private policy!: BotPolicy;
    private headlessClient!: Client;
    private runId = '';
    private fightDeferred: { resolve(o: BotFightOutcome): void; reject(e: any): void } | null = null;

    /** Must be called once, before onJoin, so handleFightEnd has what it needs to decide a loss
     *  reward and resolve the fight's outcome back to the runner. */
    configure(policy: BotPolicy, headlessClient: Client, runId: string): void {
        this.policy = policy;
        this.headlessClient = headlessClient;
        this.runId = runId;
    }

    /** Resolves once handleFightEnd (and, if applicable, the loss-reward decision) has fully
     *  run. Must be called before onJoin so the deferred exists before the fight can possibly
     *  end (mirrors TournamentFightRoom.runFight's ordering). */
    awaitFightEnd(): Promise<BotFightOutcome> {
        return new Promise<BotFightOutcome>((resolve, reject) => {
            this.fightDeferred = { resolve, reject };
        });
    }

    protected async handleFightEnd(): Promise<void> {
        await super.handleFightEnd();

        let lossRewardChoice: 'gold' | 'xp' | 'item_upgrade' | undefined;
        if (this.state.lossRewardPending && this.state.lossRewardOptions) {
            const { goldAmount, xpAmount, itemUpgradeAvailable, itemUpgradeCount } = this.state.lossRewardOptions;
            const obs = buildLossRewardObservation(
                this.state.player, this.state.player.round, this.runId,
                goldAmount, xpAmount, itemUpgradeAvailable, itemUpgradeCount,
            );
            lossRewardChoice = await this.policy.decideLossReward(obs);
            // handleSelectLossReward sets state.lossRewardPending = false synchronously and, for
            // item_upgrade, kicks off state.lossRewardApplication without awaiting it — await it
            // here (same gate sendFightEndToClient uses, FightRoom.ts:376) so the outcome below
            // reflects the upgrade having actually landed.
            this.handleSelectLossReward(this.headlessClient, { choice: lossRewardChoice });
            if (this.state.lossRewardApplication) await this.state.lossRewardApplication;
        }

        const deferred = this.fightDeferred;
        this.fightDeferred = null;
        deferred?.resolve({
            result: this.state.fightResult,
            gameWinPending: this.state.gameWinPending,
            livesAfter: this.state.player.lives,
            winsAfter: this.state.player.wins,
            stats: this.fightStatsPayload,
            replayId: this.recorder.initialState ? this.replayId : undefined,
            durationMs: this.recorder.durationMs(),
            lossRewardChoice,
        });
    }
}

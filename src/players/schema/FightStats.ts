// Server-only per-fight accumulator (not a Colyseus Schema — no client sync needed).
// Reset at the start of every fight in FightRoom.startBattle.
export class FightStats {
    damageTaken = { normal: 0, burn: 0, poison: 0 };
    healingReceived: number = 0;
    damageReducedByDefense: number = 0;
    attacksDodged: number = 0;
    damageBlockedByInvincible: number = 0;

    reset(): void {
        this.damageTaken = { normal: 0, burn: 0, poison: 0 };
        this.healingReceived = 0;
        this.damageReducedByDefense = 0;
        this.attacksDodged = 0;
        this.damageBlockedByInvincible = 0;
    }
}

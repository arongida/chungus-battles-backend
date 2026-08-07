// Server-only per-fight accumulator (not a Colyseus Schema — no client sync needed).
// Reset at the start of every fight in FightRoom.startBattle.
export class FightStats {
    damageTaken = { normal: 0, burn: 0, poison: 0 };
    healingReceived: number = 0;
    damageReducedByDefense: number = 0;
    attacksDodged: number = 0;
    damageBlockedByInvincible: number = 0;
    // Unstoppable Force (WARRIOR_3): count and bonus (extra, not full-hit) damage of this side's
    // empowered attacks this fight. Set in FightRoom.tryWeaponAttack.
    empoweredAttacks: number = 0;
    empoweredDamage: number = 0;

    reset(): void {
        this.damageTaken = { normal: 0, burn: 0, poison: 0 };
        this.healingReceived = 0;
        this.damageReducedByDefense = 0;
        this.attacksDodged = 0;
        this.damageBlockedByInvincible = 0;
        this.empoweredAttacks = 0;
        this.empoweredDamage = 0;
    }
}

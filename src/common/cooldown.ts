/**
 * Cooldown reduction (CDR): shortens active-skill intervals (TriggerType.ACTIVE talents and
 * items — see commands/triggers/ActiveTriggerCommand.ts). `cooldownReduction` is an additive
 * rating, never a percent directly, converted here using the same hyperbolic shape as
 * PlayerSchema.getDamageAfterDefense (`100 / (100 + x)`) so the resulting interval can never
 * reach zero no matter how much CDR is stacked, and needs no hard cap.
 */
export function applyCooldownReduction(baseIntervalMs: number, cooldownReduction: number): number {
    const cdr = Math.max(0, cooldownReduction || 0);
    return baseIntervalMs * (100 / (100 + cdr));
}

/** Score complete boards against the same reference, rather than adding unrelated marginals. */
import { DraftObservation, PlayerView, StatBlock, TalentView } from '../BotPolicy';
import { ARCHETYPES, ArchetypeWeights } from './archetypes';
import {
    addAffected, buildPowerContext, cloneRaw, estimateDps, estimatePower, fightSeconds, normalize,
    PowerContext, rawStatsFromPlayer, weaponProfiles,
} from './combatModel';
import { buildActivationContext, valueSkill, valueTalent } from './synergy';
import { SCALING_ORDER, SCALING_SKILL_IDS, SCALING_TALENT_IDS } from '../../common/scalingRegistry';
import { skillNode, talentNode } from '../../common/scalingGraph';

export function evaluateLoadout(
    obs: DraftObservation, equipped: PlayerView['equipped'],
    archetype: ArchetypeWeights = ARCHETYPES.balanced, talents: TalentView[] = obs.player.talents,
    onUnknown?: (id: number) => void,
) {
    const raw = rawStatsFromPlayer(obs.player);
    // Remove measured output before estimating it again. Include both Weapon Whisperer slots.
    for (const item of Object.values(obs.player.equipped)) {
        if (!item) continue;
        addAffected(raw, item.affectedStats, -1);
        addAffected(raw, item.skillAffectedStats, -1);
        addAffected(raw, item.skillAffectedStats2, -1);
    }
    const initialActivation = buildActivationContext(obs, buildPowerContext(obs));
    for (const talent of obs.player.talents) {
        if (!talents.includes(talent) || SCALING_TALENT_IDS.has(talent.talentId)) addAffected(raw, talent.affectedStats, -1);
        else {
            const aura = valueTalent(talent, initialActivation, archetype)?.auraStats;
            // Preserve static talent grants; replace only fields written by the estimated aura.
            const measured = Object.fromEntries(Object.keys(aura ?? {}).map(key => [key, talent.affectedStats[key as keyof StatBlock]]));
            addAffected(raw, measured, -1);
        }
    }
    for (const talent of talents) {
        if (!obs.player.talents.includes(talent) && !SCALING_TALENT_IDS.has(talent.talentId)) {
            addAffected(raw, talent.affectedStats, 1);
        }
    }
    for (const item of Object.values(equipped)) if (item) addAffected(raw, item.affectedStats, 1);
    const target = { ...obs, player: { ...obs.player, equipped, talents } };
    const ref = buildPowerContext(obs).ref;
    const weapons = weaponProfiles(equipped);
    const powerContext = (): PowerContext => {
        const stats = normalize(cloneRaw(raw));
        return { raw: cloneRaw(raw), stats, weapons, ref, round: obs.round,
            basePower: estimatePower(stats, weapons, ref),
            fightSeconds: fightSeconds(estimateDps(stats, weapons, ref), ref) };
    };
    const slots = Object.values(equipped).filter(Boolean).flatMap(item =>
        [item.skillId, item.skillId2].filter(Boolean).map(id => ({ item, id })));

    // Same-node duplicates share an input snapshot, exactly as the server's scaling pass does.
    for (const node of SCALING_ORDER) {
        const activation = buildActivationContext(target, powerContext());
        const grants: Partial<StatBlock>[] = [];
        for (const { item, id } of slots) {
            if (skillNode(id) === node) grants.push(valueSkill(id, item.rarity, activation, archetype, item, false).auraStats);
        }
        for (const talent of talents) {
            if (talentNode(talent.talentId) === node) grants.push(valueTalent(talent, activation, archetype)?.auraStats);
        }
        for (const grant of grants) addAffected(raw, grant, 1);
    }
    // Combat-only auras use one simultaneous estimate to avoid self-feeding feedback loops.
    const auraContext = buildActivationContext(target, powerContext());
    for (const { item, id } of slots) {
        if (!SCALING_SKILL_IDS.has(id)) addAffected(raw, valueSkill(id, item.rarity, auraContext, archetype, item, false).auraStats, 1);
    }
    for (const talent of talents) {
        if (!SCALING_TALENT_IDS.has(talent.talentId)) addAffected(raw, valueTalent(talent, auraContext, archetype)?.auraStats, 1);
    }
    const power = powerContext();
    const activation = buildActivationContext(target, power);
    let damage = 0, ehp = 0, goldPerRound = 0;
    for (const { item, id } of slots) {
        const value = valueSkill(id, item.rarity, activation, archetype, item, false, onUnknown);
        damage += value.damagePerFight;
        ehp += value.ehpPerFight;
        goldPerRound += value.goldPerRound;
    }
    for (const talent of talents) {
        const value = valueTalent(talent, activation, archetype, onUnknown);
        if (!value) continue;
        damage += value.damagePerFight;
        ehp += value.ehpPerFight;
        goldPerRound += value.goldPerRound;
    }
    for (const source of [...Object.values(equipped).filter(Boolean), ...talents]) {
        const debuff = source.affectedEnemyStats;
        const speed = Math.min(0.9, Math.max(0, 1 - (debuff.attackSpeed || 1)));
        ehp += ref.dps * power.fightSeconds * speed
            + Math.max(0, -(debuff.strength ?? 0)) * activation.enemyAttackRate * power.fightSeconds;
    }
    return { power: estimatePower(power.stats, weapons, ref, { dps: damage / power.fightSeconds, ehp }),
        income: power.stats.income, goldPerRound, activation, stats: power.stats };
}

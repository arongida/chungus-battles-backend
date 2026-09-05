// Tuning + metadata for class-item skills (see ItemSkillBehaviors.ts for the logic that
// reads these). One definition per ItemSkillType, grouped by class for the roller
// (itemSkillRoller.ts). Mirrors the uniqueItemBalance.ts convention: every tunable
// number lives here so balance passes touch one file.

import { EquipSlot, ItemClass, ItemRarity } from '../types/ItemTypes';
import { TriggerType } from '../../common/types';
import { ItemSkillType } from '../types/ItemSkillTypes';
import { fmt } from '../../common/MessageTypes';
import {
  coatedEdgeCounters, openingActCounters, crushingBlowCounters, protectionMoneyLastProcMs,
  shieldBashLastProcMs, braceCounters, smokeBombUsed, battleFocusCounters, ironbloodCleansed,
} from './itemSkillState';
// Scaling-graph plumbing (see scalingGraph.ts) — only the skills that read another scaling
// source's output declare a `scaling` block below. TalentType is needed only for BULWARK's
// `after` tie-break against the Strong talent.
import { ScalingDeclaration, talentNode } from '../../common/scalingGraph';
import { TalentType } from '../../talents/types/TalentTypes';
// Type-only — see itemSkillState.ts's header comment on why this doesn't create a runtime cycle
// with ItemSchema.ts (which imports ItemSkillBehaviors.ts, which imports this file).
import type { Item } from '../schema/ItemSchema';
import type { Player } from '../../players/schema/PlayerSchema';
import type { ClockTimer } from '@colyseus/timer';

/** Class skills only ever roll onto a `class`-bearing item (ItemClass); shield skills roll
 *  onto any shield regardless of `class`; potion skills (Health Flask brews) roll onto any
 *  item of type 'potion' (see itemSkillRoller.ts's type-based pool branches). */
export type ItemSkillGroup = ItemClass | 'shield' | 'potion';

/** Context passed to `status()` every UpdateStatsCommand tick, for an EQUIPPED item only (see
 *  itemSkillStatus.ts's refreshItemSkillStatus, the only caller). */
export interface ItemSkillStatusContext {
  item: Item;
  player: Player;
  /** Only set in FightRoom. */
  enemy?: Player;
  /** Only set in FightRoom. */
  clock?: ClockTimer;
  inFight: boolean;
}

export interface ItemSkillDefinition {
  id: ItemSkillType;
  class: ItemSkillGroup;
  name: string;
  /** Equip slots this skill is allowed to roll onto. OnAttackTriggerCommand only ever fires
   *  the weapon that swung, so any skill using ON_ATTACK/ON_DODGE combat procs must be
   *  weapon-only (see rollItemSkill's slot filter). Shields have baseAttackSpeed 0 and never
   *  swing (see FightRoom.startWeaponAttackTimers), so no shield skill may use ON_ATTACK either. */
  slots: EquipSlot[];
  /** Unioned onto item.triggerTypes when the skill is granted (see grantItemSkill). */
  triggerTypes: TriggerType[];
  /** Declares this skill as a scaling source whose AURA output is computed from another stat —
   *  see scalingGraph.ts. Omit for the vast majority of skills, whose AURA output (if any)
   *  doesn't depend on any other scaling source's contribution. */
  scaling?: ScalingDeclaration;
  /** Rarity-keyed tuning — ItemSkillBehaviors reads skillValues(def, item.rarity). Class skills
   *  only define LEGENDARY/MYTHIC (they never roll below Legendary). Shield skills define every
   *  bracket, since shield skills are active from Common — see skillValues' fallback below. */
  values: Partial<Record<ItemRarity, Record<string, number>>>;
  describe(rarity: ItemRarity): string;
  /** Live one-line state for an EQUIPPED item (e.g. "+42 / +100 defense"), or '' to render no
   *  status line at all — see itemSkillStatus.ts. Omitted entirely for skills with no
   *  meaningful moment-to-moment state (Aegis, Cash Back). */
  status?(ctx: ItemSkillStatusContext): string;
}

const ANY_SLOT: EquipSlot[] = [EquipSlot.ARMOR, EquipSlot.HELMET, EquipSlot.MAIN_HAND, EquipSlot.OFF_HAND];
const WEAPON_SLOTS: EquipSlot[] = [EquipSlot.MAIN_HAND, EquipSlot.OFF_HAND];
const GEAR_SLOTS: EquipSlot[] = [EquipSlot.ARMOR, EquipSlot.HELMET];
// Shields normally live in offHand; Shady Shields (talent) moves them into mainHand too.
const SHIELD_SLOTS: EquipSlot[] = [EquipSlot.OFF_HAND, EquipSlot.MAIN_HAND];

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// Bulk Discount (item skill): hard cap on the shop-price discount fraction, regardless of how
// high stacked lucky-find chance (Insider Trading + VIP Pass + Black Market Contact x2 + Mythic
// snowball bonus, etc.) climbs. Keeps the shop from ever going literally free.
export const BULK_DISCOUNT_MAX_DISCOUNT_FRACTION = 0.75;

const RARITY_ORDER = [ItemRarity.COMMON, ItemRarity.RARE, ItemRarity.EPIC, ItemRarity.LEGENDARY, ItemRarity.MYTHIC];

/** Looks up the rarity-appropriate value bracket for a skill. Returns the highest defined
 *  bracket at or below `rarity`, falling back to the lowest defined bracket for anything below
 *  that (so a class skill — which only defines LEGENDARY/MYTHIC — still resolves to LEGENDARY's
 *  numbers for rarity 1-3, exactly as before this was widened to support shield skills, which
 *  define every bracket from COMMON up). */
export function skillValues(def: ItemSkillDefinition, rarity: ItemRarity): Record<string, number> {
  let fallback: Record<string, number> | undefined;
  for (const r of RARITY_ORDER) {
    const bracket = def.values[r];
    if (!bracket) continue;
    if (!fallback) fallback = bracket;
    if (r <= rarity) fallback = bracket;
  }
  return fallback ?? {};
}

/** Rarities `def` actually defines a bracket for, ascending — e.g. `[LEGENDARY, MYTHIC]` for a
 *  class skill, all 5 for a shield skill. Used by the /itemSkills catalog endpoint (app.config.ts)
 *  so it shows exactly the tiers that mean something for each skill, instead of calling
 *  describe() for every rarity and having skillValues' fallback silently repeat the same text. */
export function definedRarityTiers(def: ItemSkillDefinition): ItemRarity[] {
  return RARITY_ORDER.filter((r) => !!def.values[r]);
}

export const ITEM_SKILLS: Record<number, ItemSkillDefinition> = {
  // ---------------------------------------------------------------- ROGUE ----

  [ItemSkillType.EXPLOIT_WEAKNESS]: {
    id: ItemSkillType.EXPLOIT_WEAKNESS,
    class: ItemClass.ROGUE,
    name: 'Exploit Weakness',
    slots: WEAPON_SLOTS,
    triggerTypes: [TriggerType.ON_ATTACK],
    values: {
      [ItemRarity.LEGENDARY]: { ratio: 0.04 },
      [ItemRarity.MYTHIC]: { ratio: 0.08 },
    },
    describe: (r) => `On hit: deal bonus damage equal to ${pct(skillValues(ITEM_SKILLS[ItemSkillType.EXPLOIT_WEAKNESS], r).ratio)} of the enemy's defense.`,
    status: (ctx) => {
      if (!ctx.inFight || !ctx.enemy) return '';
      const { ratio } = skillValues(ITEM_SKILLS[ItemSkillType.EXPLOIT_WEAKNESS], ctx.item.rarity);
      return `+${fmt(ctx.enemy.defense * ratio)} bonus damage per hit`;
    },
  },

  [ItemSkillType.FLUID_MOTION]: {
    id: ItemSkillType.FLUID_MOTION,
    class: ItemClass.ROGUE,
    name: 'Fluid Motion',
    slots: ANY_SLOT,
    triggerTypes: [TriggerType.AURA],
    // Reads dodgeRate — no other scaling source writes dodgeRate (see talentScaling.ts's
    // MERCHANT_5, which is forced to run after this), so this node has no natural predecessor
    // and always resolves against the floor value; declared anyway for uniform treatment and
    // documentation.
    scaling: { reads: ['dodgeRate'], writes: [] },
    values: {
      [ItemRarity.LEGENDARY]: { perDodgeRate: 10 },
      [ItemRarity.MYTHIC]: { perDodgeRate: 5 },
    },
    describe: (r) => `Gain 1% attack speed per ${skillValues(ITEM_SKILLS[ItemSkillType.FLUID_MOTION], r).perDodgeRate} dodge rate.`,
    status: (ctx) => {
      const as = ctx.item.skillAffectedStats.attackSpeed;
      return as === 1 ? '' : `+${pct(as - 1)} attack speed`;
    },
  },

  [ItemSkillType.PLAGUE_BEARER]: {
    id: ItemSkillType.PLAGUE_BEARER,
    class: ItemClass.ROGUE,
    name: 'Plague Bearer',
    slots: ANY_SLOT,
    triggerTypes: [TriggerType.AURA],
    values: {
      [ItemRarity.LEGENDARY]: { ratioPerStack: 0.01 },
      [ItemRarity.MYTHIC]: { ratioPerStack: 0.02 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.PLAGUE_BEARER], r);
      return `While the enemy is poisoned, gain ${pct(v.ratioPerStack)} attack speed per poison stack.`;
    },
    status: (ctx) => {
      if (!ctx.inFight) return '';
      const stacks = ctx.enemy?.poisonStack ?? 0;
      if (stacks <= 0) return 'enemy not poisoned';
      const { ratioPerStack } = skillValues(ITEM_SKILLS[ItemSkillType.PLAGUE_BEARER], ctx.item.rarity);
      return `+${pct(stacks * ratioPerStack)} attack speed (${stacks} poison stacks)`;
    },
  },

  [ItemSkillType.COATED_EDGE]: {
    id: ItemSkillType.COATED_EDGE,
    class: ItemClass.ROGUE,
    name: 'Coated Edge',
    slots: WEAPON_SLOTS,
    triggerTypes: [TriggerType.ON_ATTACK, TriggerType.FIGHT_START],
    values: {
      [ItemRarity.LEGENDARY]: { every: 3, stacks: 2 },
      [ItemRarity.MYTHIC]: { every: 2, stacks: 3 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.COATED_EDGE], r);
      return `Every ${v.every === 2 ? '2nd' : `${v.every}rd`} attack applies ${v.stacks} poison stacks.`;
    },
    status: (ctx) => {
      if (!ctx.inFight) return '';
      const { every } = skillValues(ITEM_SKILLS[ItemSkillType.COATED_EDGE], ctx.item.rarity);
      const count = coatedEdgeCounters.get(ctx.item) ?? 0;
      return `${count % every}/${every} attacks charged`;
    },
  },

  [ItemSkillType.SHADOWSTEP]: {
    id: ItemSkillType.SHADOWSTEP,
    class: ItemClass.ROGUE,
    name: 'Shadowstep',
    slots: ANY_SLOT,
    // ON_DODGE pays out the heal; FIGHT_END resets the accumulated dodgeRate penalty (see
    // ItemSkillBehaviors.ts — this is one of the rare skills that writes -= instead of =).
    triggerTypes: [TriggerType.ON_DODGE, TriggerType.FIGHT_END],
    values: {
      [ItemRarity.LEGENDARY]: { healRatio: 0.02, dodgeCost: 3 },
      [ItemRarity.MYTHIC]: { healRatio: 0.04, dodgeCost: 4 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.SHADOWSTEP], r);
      return `Each dodge heals ${pct(v.healRatio)} of your max HP, but costs you ${v.dodgeCost}% dodge rating for the rest of the fight.`;
    },
    status: (ctx) => (ctx.inFight ? `${fmt(-ctx.item.skillAffectedStats.dodgeRate)} dodge rate spent this fight` : ''),
  },

  [ItemSkillType.OPENING_ACT]: {
    id: ItemSkillType.OPENING_ACT,
    class: ItemClass.ROGUE,
    name: 'Opening Act',
    slots: WEAPON_SLOTS,
    // ON_ATTACK is deliberately absent — the empowerment check runs directly in
    // FightRoom.tryWeaponAttack (before the dodge roll), not through the trigger system. See
    // ItemSkillBehaviors.ts's OPENING_ACT entry for why (same reasoning as Crushing Blow).
    triggerTypes: [TriggerType.FIGHT_START],
    values: {
      [ItemRarity.LEGENDARY]: { count: 3 },
      [ItemRarity.MYTHIC]: { count: 5 },
    },
    describe: (r) => `Your first ${skillValues(ITEM_SKILLS[ItemSkillType.OPENING_ACT], r).count} attacks each fight are empowered: unavoidable, +50% bonus damage.`,
    status: (ctx) => {
      if (!ctx.inFight) return '';
      const { count } = skillValues(ITEM_SKILLS[ItemSkillType.OPENING_ACT], ctx.item.rarity);
      const remaining = Math.max(0, count - (openingActCounters.get(ctx.item) ?? 0));
      return remaining > 0 ? `${remaining} empowered attack${remaining > 1 ? 's' : ''} left` : 'used up';
    },
  },

  [ItemSkillType.SMOKE_BOMB]: {
    id: ItemSkillType.SMOKE_BOMB,
    class: ItemClass.ROGUE,
    name: 'Smoke Bomb',
    slots: GEAR_SLOTS,
    // AURA checks the HP threshold every ~1s and fires the (once-per-fight) vanish; FIGHT_END
    // resets the latch and any lingering stat output.
    triggerTypes: [TriggerType.AURA, TriggerType.FIGHT_END],
    values: {
      [ItemRarity.LEGENDARY]: { hpThreshold: 0.5, durationMs: 2000, dodgeRate: 1000 },
      [ItemRarity.MYTHIC]: { hpThreshold: 0.5, durationMs: 4000, dodgeRate: 1000 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.SMOKE_BOMB], r);
      return `The first time you fall below ${pct(v.hpThreshold)} HP, vanish for ${v.durationMs / 1000}s: `
        + `+${v.dodgeRate} dodge rate, but your attacks deal no damage while vanished.`;
    },
    status: (ctx) => {
      if (!ctx.inFight) return '';
      if (ctx.player.damageDisabled) return 'vanished — attacks deal no damage';
      return smokeBombUsed.get(ctx.item) ? 'used' : 'ready — triggers below 50% HP';
    },
  },

  [ItemSkillType.LIGHT_FINGERS]: {
    id: ItemSkillType.LIGHT_FINGERS,
    class: ItemClass.ROGUE,
    name: 'Light Fingers',
    slots: ANY_SLOT,
    // ON_SELL only reaches equipped items (triggerEquippedItems), so this must stay equipped to
    // fire — unlike the old SHOP_START version, which also swept inventory copies.
    triggerTypes: [TriggerType.ON_SELL],
    values: {
      [ItemRarity.LEGENDARY]: { upgrade: 0 },
      [ItemRarity.MYTHIC]: { upgrade: 1 },
    },
    describe: (r) => {
      const { upgrade } = skillValues(ITEM_SKILLS[ItemSkillType.LIGHT_FINGERS], r);
      return upgrade > 0
        ? 'When you sell an item: steal a random shop item, and it gains one rarity. Costs 1 income.'
        : 'When you sell an item: steal a random shop item. Costs 1 income.';
    },
    status: (ctx) => (ctx.inFight ? '' : 'steals a random shop item on sell'),
  },

  // -------------------------------------------------------------- WARRIOR ----

  [ItemSkillType.BATTLE_FOCUS]: {
    id: ItemSkillType.BATTLE_FOCUS,
    class: ItemClass.WARRIOR,
    name: 'Battle Focus',
    slots: ANY_SLOT,
    // ON_ATTACK_DODGED charges the empowerment; FIGHT_START resets the per-item dodge counter.
    triggerTypes: [TriggerType.ON_ATTACK_DODGED, TriggerType.FIGHT_START],
    values: {
      [ItemRarity.LEGENDARY]: { every: 3 },
      [ItemRarity.MYTHIC]: { every: 2 },
    },
    describe: (r) => {
      const { every } = skillValues(ITEM_SKILLS[ItemSkillType.BATTLE_FOCUS], r);
      const ordinal = every === 2 ? '2nd' : every === 3 ? '3rd' : `${every}th`;
      return `Every ${ordinal} time the enemy dodges your attack, your next attack is empowered: unavoidable, +50% bonus damage.`;
    },
    status: (ctx) => {
      if (!ctx.inFight) return '';
      const { every } = skillValues(ITEM_SKILLS[ItemSkillType.BATTLE_FOCUS], ctx.item.rarity);
      const count = battleFocusCounters.get(ctx.item) ?? 0;
      return `${count % every}/${every} dodges charged`;
    },
  },

  [ItemSkillType.INTIMIDATING_PRESENCE]: {
    id: ItemSkillType.INTIMIDATING_PRESENCE,
    class: ItemClass.WARRIOR,
    name: 'Intimidating Presence',
    slots: ANY_SLOT,
    triggerTypes: [TriggerType.AURA],
    values: {
      [ItemRarity.LEGENDARY]: { ratio: 0.25 },
      [ItemRarity.MYTHIC]: { ratio: 0.5 },
    },
    describe: (r) => `Reduce enemy attack speed by ${pct(skillValues(ITEM_SKILLS[ItemSkillType.INTIMIDATING_PRESENCE], r).ratio)}.`,
    status: (ctx) => {
      if (!ctx.inFight) return '';
      const as = ctx.item.skillAffectedEnemyStats.attackSpeed;
      return as === 1 ? '' : `enemy attack speed -${pct(1 - as)}`;
    },
  },

  [ItemSkillType.TITANS_MIGHT]: {
    id: ItemSkillType.TITANS_MIGHT,
    class: ItemClass.WARRIOR,
    name: "Titan's Might",
    slots: ANY_SLOT,
    triggerTypes: [TriggerType.AURA],
    // Reads max HP, which can now include Bulwark's and Strong's contributions (see BULWARK's
    // `scaling` below) instead of just base+item max HP — a real power increase for a board
    // stacking both, so divisors are raised ~20% from their Season 25 values to compensate. No
    // `after` needed: the natural edges from BULWARK/STRONG (both write maxHp, this only reads
    // it) already place this after them.
    scaling: { reads: ['maxHp'], writes: ['strength'] },
    values: {
      [ItemRarity.LEGENDARY]: { divisor: 18 },
      [ItemRarity.MYTHIC]: { divisor: 11 },
    },
    describe: (r) => `Gain 1 strength per ${skillValues(ITEM_SKILLS[ItemSkillType.TITANS_MIGHT], r).divisor} max HP.`,
    status: (ctx) => `+${fmt(ctx.item.skillAffectedStats.strength)} strength`,
  },

  // Reworked (Season 27), formerly Iron Hide: was a flat "1 defense per X max HP" drip, then
  // briefly a regen-to-defense hardening skill — both unconditional or nearly so, and neither
  // one answered anything the enemy could actually do to you. Now grants bonus HP regen that,
  // while you're poisoned, cleanses stacks instead of healing you — a real answer to the poison
  // line (which otherwise has no counter at all) that's dead weight in a poison-free matchup only
  // in the sense that the regen bonus alone still justifies the slot. Burn is deliberately left
  // untouched: poison is the stat-scaling, healing-halving DoT, and leaving burn alone keeps this
  // a poison answer rather than a blanket DoT immunity. See Player.consumePoisonStacks /
  // regenSuppressed for the plumbing this reuses.
  [ItemSkillType.IRONBLOOD]: {
    id: ItemSkillType.IRONBLOOD,
    class: ItemClass.WARRIOR,
    name: 'Ironblood',
    slots: GEAR_SLOTS,
    // AURA grants the regen bonus every tick and cleanses poison with it when there's any to
    // cleanse (see ItemSkillBehaviors.ts); FIGHT_END resets both the bonus and the suppression
    // flag it can leave set.
    triggerTypes: [TriggerType.AURA, TriggerType.FIGHT_END],
    // Reads and writes the same stat (hpRegen) — the self-edge the scaling graph excludes by
    // construction, so this always reads a snapshot free of its own previous tick's output.
    // Nothing else reads hpRegen except Merchant's capstone (forced last — see talentScaling.ts),
    // so the only edge here is the natural LAST_STAND -> IRONBLOOD one: Last Stand's emergency
    // regen feeds this skill's bonus/cleanse for the rest of that tick.
    scaling: { reads: ['hpRegen'], writes: ['hpRegen'] },
    values: {
      [ItemRarity.LEGENDARY]: { regenBonus: 0.30 },
      [ItemRarity.MYTHIC]: { regenBonus: 0.60 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.IRONBLOOD], r);
      return `+${pct(v.regenBonus)} HP regen. While poisoned, that regen cleanses stacks instead of healing you.`;
    },
    status: (ctx) => {
      const cleansed = ironbloodCleansed.get(ctx.item) ?? 0;
      if (ctx.inFight && cleansed > 0 && ctx.player.regenSuppressed) {
        return `cleansing — ${cleansed} poison stack${cleansed === 1 ? '' : 's'} purged`;
      }
      return `+${fmt(ctx.item.skillAffectedStats.hpRegen)} hp regen`;
    },
  },

  [ItemSkillType.BULWARK]: {
    id: ItemSkillType.BULWARK,
    class: ItemClass.WARRIOR,
    name: 'Bulwark',
    slots: GEAR_SLOTS,
    // AURA drives the persistent max HP bonus (self-clearing, see ItemSkillBehaviors.ts); a
    // fight-start heal would be a no-op since fights always start at full HP, so this grants max
    // HP instead. FIGHT_START is kept only for the Mythic invulnerability rider.
    triggerTypes: [TriggerType.AURA, TriggerType.FIGHT_START],
    // `after: STRONG` — this and the Strong talent both read AND write maxHp, so left to natural
    // edges alone they'd cycle. Ordering item skills after talents means gear builds on top of
    // whatever the talent board already grants, not the reverse.
    scaling: { reads: ['maxHp'], writes: ['maxHp'], after: [talentNode(TalentType.STRONG)] },
    values: {
      [ItemRarity.LEGENDARY]: { hpRatio: 0.2, invulnMs: 0 },
      [ItemRarity.MYTHIC]: { hpRatio: 0.4, invulnMs: 1300 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.BULWARK], r);
      return v.invulnMs > 0
        ? `+${pct(v.hpRatio)} max HP, and gain ${v.invulnMs / 1000}s invulnerability at fight start.`
        : `+${pct(v.hpRatio)} max HP.`;
    },
    status: (ctx) => `+${fmt(ctx.item.skillAffectedStats.maxHp)} max HP`,
  },

  [ItemSkillType.LAST_STAND]: {
    id: ItemSkillType.LAST_STAND,
    class: ItemClass.WARRIOR,
    name: 'Last Stand',
    slots: ANY_SLOT,
    triggerTypes: [TriggerType.AURA],
    // Reads defense. Zealot (talentScaling.ts) also writes defense and is forced to run AFTER
    // this node, so this always resolves against base+item defense, same as before Zealot became
    // a scaling source. Writing hpRegen is what puts this before Ironblood in the sort: Ironblood
    // reads hpRegen, so this emergency regen bonus feeds Ironblood's bonus/cleanse the same tick
    // it turns on.
    scaling: { reads: ['defense'], writes: ['defense', 'hpRegen'] },
    values: {
      [ItemRarity.LEGENDARY]: { defenseRatio: 0.5, hpRegen: 10 },
      [ItemRarity.MYTHIC]: { defenseRatio: 1.0, hpRegen: 20 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.LAST_STAND], r);
      return `Below 50% HP: +${pct(v.defenseRatio)} defense and +${v.hpRegen} HP regen.`;
    },
    status: (ctx) => {
      const active = ctx.item.skillAffectedStats.hpRegen > 0;
      return active
        ? `active: +${fmt(ctx.item.skillAffectedStats.defense)} defense, +${fmt(ctx.item.skillAffectedStats.hpRegen)} regen`
        : 'inactive - above 50% HP';
    },
  },

  [ItemSkillType.WARLORDS_ROAR]: {
    id: ItemSkillType.WARLORDS_ROAR,
    class: ItemClass.WARRIOR,
    name: "Warlord's Roar",
    slots: ANY_SLOT,
    triggerTypes: [TriggerType.FIGHT_START, TriggerType.FIGHT_END],
    values: {
      [ItemRarity.LEGENDARY]: { ratio: 0.2 },
      [ItemRarity.MYTHIC]: { ratio: 0.4 },
    },
    describe: (r) => `Fight start: reduce enemy strength by ${pct(skillValues(ITEM_SKILLS[ItemSkillType.WARLORDS_ROAR], r).ratio)}`,
    status: (ctx) => {
      const { ratio } = skillValues(ITEM_SKILLS[ItemSkillType.WARLORDS_ROAR], ctx.item.rarity);
      if (ctx.inFight) {
        const reduction = -ctx.item.skillAffectedEnemyStats.strength;
        return reduction > 0 ? `enemy -${fmt(reduction)} strength` : 'not triggered yet';
      }
      return `would be -${fmt(ctx.player.defense * ratio)} strength`;
    },
  },

  [ItemSkillType.CRUSHING_BLOW]: {
    id: ItemSkillType.CRUSHING_BLOW,
    class: ItemClass.WARRIOR,
    name: 'Crushing Blow',
    slots: WEAPON_SLOTS,
    // ON_ATTACK is deliberately absent — the empowerment check now runs directly in
    // FightRoom.tryWeaponAttack (before the dodge roll), not through the trigger system. See
    // ItemSkillBehaviors.ts's CRUSHING_BLOW entry for why.
    triggerTypes: [TriggerType.FIGHT_START],
    values: {
      [ItemRarity.LEGENDARY]: { every: 3 },
      [ItemRarity.MYTHIC]: { every: 2 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.CRUSHING_BLOW], r);
      // +50% mirrors FightRoom's EMPOWERED_DAMAGE_MULTIPLIER (shared by every empowered-attack
      // source) — not read from there directly to avoid a FightRoom <-> item-skill import cycle.
      return `Every ${v.every === 3 ? '3rd' : `${v.every}th`} attack is empowered: unavoidable, +50% bonus damage.`;
    },
    status: (ctx) => {
      if (!ctx.inFight) return '';
      const { every } = skillValues(ITEM_SKILLS[ItemSkillType.CRUSHING_BLOW], ctx.item.rarity);
      const count = crushingBlowCounters.get(ctx.item) ?? 0;
      return `${count % every}/${every} attacks charged`;
    },
  },

  // ------------------------------------------------------------- MERCHANT ----

  [ItemSkillType.HAGGLER]: {
    id: ItemSkillType.HAGGLER,
    class: ItemClass.MERCHANT,
    name: 'Haggler',
    slots: ANY_SLOT,
    triggerTypes: [TriggerType.AURA],
    values: {
      [ItemRarity.LEGENDARY]: { count: 2 },
      [ItemRarity.MYTHIC]: { count: 3 },
    },
    describe: (r) => {
      const count = skillValues(ITEM_SKILLS[ItemSkillType.HAGGLER], r).count;
      return `${count} free shop reroll${count > 1 ? 's' : ''} per round.`;
    },
    status: (ctx) => {
      if (ctx.inFight) return '';
      // Shared pool (see PlayerSchema.freeRerollCharges) — may include charges contributed by
      // Bargain Hunter too if the player also owns that talent.
      const left = ctx.player.freeRerollCharges;
      return `${left} free reroll${left === 1 ? '' : 's'} left`;
    },
  },

  [ItemSkillType.STORE_CREDIT]: {
    id: ItemSkillType.STORE_CREDIT,
    class: ItemClass.MERCHANT,
    name: 'Store Credit',
    slots: ANY_SLOT,
    triggerTypes: [TriggerType.AURA],
    values: {
      [ItemRarity.LEGENDARY]: { cap: 14 },
      [ItemRarity.MYTHIC]: { cap: Number.MAX_SAFE_INTEGER },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.STORE_CREDIT], r);
      return v.cap >= Number.MAX_SAFE_INTEGER
        ? 'Shop phase: claim one free item, any price.'
        : `Shop phase: claim one free item priced ${v.cap} gold or less.`;
    },
    status: (ctx) => {
      if (ctx.inFight) return '';
      if (ctx.item.storeCreditClaimUsed) return 'claim used this round';
      const { cap } = skillValues(ITEM_SKILLS[ItemSkillType.STORE_CREDIT], ctx.item.rarity);
      return cap >= Number.MAX_SAFE_INTEGER ? 'free claim available (any price)' : `free claim available (up to ${cap} gold)`;
    },
  },

  [ItemSkillType.CASH_BACK]: {
    id: ItemSkillType.CASH_BACK,
    class: ItemClass.MERCHANT,
    name: 'Cash Back',
    slots: ANY_SLOT,
    triggerTypes: [TriggerType.ON_SELL],
    values: {
      [ItemRarity.LEGENDARY]: { gold: 2, xp: 3 },
      [ItemRarity.MYTHIC]: { gold: 3, xp: 5 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.CASH_BACK], r);
      return `Selling an item grants ${v.gold} gold and ${v.xp} xp.`;
    },
  },

  [ItemSkillType.COMPOUND_INTEREST]: {
    id: ItemSkillType.COMPOUND_INTEREST,
    class: ItemClass.MERCHANT,
    name: 'Compound Interest',
    slots: ANY_SLOT,
    triggerTypes: [TriggerType.AURA],
    // Reads AND writes income — without graph placement this would read its own previous
    // output and compound every tick, exactly the old bug's shape. No other scaling source
    // writes income (Merchant's capstone does, but is forced to run after every other scaling
    // node — see talentScaling.ts's MERCHANT_5), so this resolves against the floor income.
    scaling: { reads: ['income'], writes: ['income'] },
    values: {
      [ItemRarity.LEGENDARY]: { ratio: 0.15 },
      [ItemRarity.MYTHIC]: { ratio: 0.3 },
    },
    describe: (r) => `Increase income by ${pct(skillValues(ITEM_SKILLS[ItemSkillType.COMPOUND_INTEREST], r).ratio)}.`,
    status: (ctx) => `+${fmt(ctx.item.skillAffectedStats.income)} income`,
  },

  // Renamed from Market Manipulation (was: shop-start, upgrade N random shop items one rarity).
  // Kept the same id (305) — items already carrying this skill pick up the rename/rework
  // automatically via reconcileItemSkill on their next DB->schema load.
  [ItemSkillType.MARKET_MANIPULATION]: {
    id: ItemSkillType.MARKET_MANIPULATION,
    class: ItemClass.MERCHANT,
    name: 'Insider Trading',
    slots: ANY_SLOT,
    triggerTypes: [TriggerType.AURA],
    values: {
      [ItemRarity.LEGENDARY]: { chance: 0.10 },
      [ItemRarity.MYTHIC]: { chance: 0.20 },
    },
    describe: (r) => `+${pct(skillValues(ITEM_SKILLS[ItemSkillType.MARKET_MANIPULATION], r).chance)} lucky find chance.`,
    status: (ctx) => (ctx.inFight ? '' : `+${pct(skillValues(ITEM_SKILLS[ItemSkillType.MARKET_MANIPULATION], ctx.item.rarity).chance)} lucky find`),
  },

  // Scales off the player's own lucky find chance (Insider Trading, VIP Pass, Black Market
  // Contact, Mythic snowball bonus, etc.) instead of counting equipped merchant items — so it
  // rewards the same economy stat every other merchant piece is already pushing, rather than
  // sitting in tension with it. Percentage-off-price (not a flat gold amount) so stacked luck
  // scales the discount proportionally on every item instead of flattening cheap items to free
  // while barely denting expensive ones — see BULK_DISCOUNT_MAX_DISCOUNT_FRACTION for the cap
  // that keeps even very high luck from making the shop literally free.
  [ItemSkillType.BULK_DISCOUNT]: {
    id: ItemSkillType.BULK_DISCOUNT,
    class: ItemClass.MERCHANT,
    name: 'Bulk Discount',
    slots: ANY_SLOT,
    triggerTypes: [TriggerType.AURA],
    values: {
      [ItemRarity.LEGENDARY]: { percentPerLuckPercent: 0.005 },
      [ItemRarity.MYTHIC]: { percentPerLuckPercent: 0.01 },
    },
    describe: (r) => {
      const { percentPerLuckPercent } = skillValues(ITEM_SKILLS[ItemSkillType.BULK_DISCOUNT], r);
      return `Shop prices drop ${pct(percentPerLuckPercent)} per 1% lucky find chance (max ${pct(BULK_DISCOUNT_MAX_DISCOUNT_FRACTION)} off).`;
    },
    status: (ctx) => {
      if (ctx.inFight) return '';
      const luckPercent = ctx.player.luckyFindChance * 100;
      const discountFraction = Math.min(BULK_DISCOUNT_MAX_DISCOUNT_FRACTION, luckPercent * ctx.player.bulkDiscountPercentPerLuckPercent);
      return `${fmt(luckPercent)}% lucky find - shop prices -${pct(discountFraction)}`;
    },
  },

  [ItemSkillType.PROTECTION_MONEY]: {
    id: ItemSkillType.PROTECTION_MONEY,
    class: ItemClass.MERCHANT,
    name: 'Protection Money',
    slots: GEAR_SLOTS,
    triggerTypes: [TriggerType.ON_ATTACKED],
    values: {
      [ItemRarity.LEGENDARY]: { gold: 1, cooldownMs: 1000 },
      [ItemRarity.MYTHIC]: { gold: 2, cooldownMs: 1000 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.PROTECTION_MONEY], r);
      return v.cooldownMs > 0
        ? `On being attacked: gain ${v.gold} gold (max once per second).`
        : `On being attacked: gain ${v.gold} gold.`;
    },
    status: (ctx) => {
      if (!ctx.inFight) return '';
      const { cooldownMs } = skillValues(ITEM_SKILLS[ItemSkillType.PROTECTION_MONEY], ctx.item.rarity);
      if (cooldownMs <= 0 || !ctx.clock) return 'ready';
      const last = protectionMoneyLastProcMs.get(ctx.item);
      if (last === undefined) return 'ready';
      const remaining = cooldownMs - (ctx.clock.elapsedTime - last);
      return remaining > 0 ? `${(remaining / 1000).toFixed(1)}s` : 'ready';
    },
  },

  [ItemSkillType.WAR_CHEST]: {
    id: ItemSkillType.WAR_CHEST,
    class: ItemClass.MERCHANT,
    name: 'War Chest',
    slots: ANY_SLOT,
    // FIGHT_START spends the gold; FIGHT_END resets the granted stats (see ItemSkillBehaviors.ts).
    triggerTypes: [TriggerType.FIGHT_START, TriggerType.FIGHT_END],
    values: {
      [ItemRarity.LEGENDARY]: { maxGold: 10, strengthPerGold: 3, defensePerGold: 2 },
      [ItemRarity.MYTHIC]: { maxGold: 15, strengthPerGold: 4, defensePerGold: 3 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.WAR_CHEST], r);
      return `Fight start: spend up to ${v.maxGold} gold — gain ${v.strengthPerGold} strength and ${v.defensePerGold} defense per gold spent for this fight.`;
    },
    status: (ctx) => {
      const { maxGold, strengthPerGold, defensePerGold } = skillValues(ITEM_SKILLS[ItemSkillType.WAR_CHEST], ctx.item.rarity);
      if (ctx.inFight) {
        const strength = ctx.item.skillAffectedStats.strength;
        const defense = ctx.item.skillAffectedStats.defense;
        return strength > 0 || defense > 0
          ? `spent gold: +${fmt(strength)} strength, +${fmt(defense)} defense`
          : 'no gold spent';
      }
      const spend = Math.min(maxGold, Math.max(0, Math.floor(ctx.player.gold)));
      return `would spend ${spend} gold: +${spend * strengthPerGold} strength, +${spend * defensePerGold} defense`;
    },
  },

  // --------------------------------------------------------------- SHIELD ----
  // Any shield (76-80) rolls one of these regardless of ItemClass — shields carry
  // `class: ""` in Mongo. Active from Common (see skillValues' fallback), replacing the old
  // flat fight-start invulnerability (ItemBehaviors[ItemType.SHIELD], removed alongside this).

  [ItemSkillType.AEGIS]: {
    id: ItemSkillType.AEGIS,
    class: 'shield',
    name: 'Aegis',
    slots: SHIELD_SLOTS,
    triggerTypes: [TriggerType.FIGHT_START],
    values: {
      [ItemRarity.COMMON]: { invulnMs: 1200 },
      [ItemRarity.RARE]: { invulnMs: 1400 },
      [ItemRarity.EPIC]: { invulnMs:  1600},
      [ItemRarity.LEGENDARY]: { invulnMs: 1800 },
      [ItemRarity.MYTHIC]: { invulnMs: 2000 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.AEGIS], r);
      return `Fight start: ${(v.invulnMs / 1000).toFixed(1)}s invulnerability.`;
    },
  },

  // Reworked (Season 26): from a percentage of the shield owner's own defense (then reduced AGAIN
  // by the attacker's defense — a tanky attacker barely felt it) into a straight reflect of a
  // percentage of the damage just taken, dealt back as-is. Keeps its downside (like Shield Wall):
  // each counter permanently burns a slice of your own defense for the rest of the fight (reset
  // on FIGHT_END) — and now that's self-escalating rather than just decaying, since less defense
  // means bigger hits taken, which means bigger reflects.
  [ItemSkillType.RIPOSTE]: {
    id: ItemSkillType.RIPOSTE,
    class: 'shield',
    name: 'Riposte',
    slots: SHIELD_SLOTS,
    triggerTypes: [TriggerType.ON_ATTACKED, TriggerType.FIGHT_END],
    values: {
      [ItemRarity.COMMON]: { ratio: 0.15, defenseCost: 1 },
      [ItemRarity.RARE]: { ratio: 0.20, defenseCost: 1 },
      [ItemRarity.EPIC]: { ratio: 0.25, defenseCost: 2 },
      [ItemRarity.LEGENDARY]: { ratio: 0.30, defenseCost: 3 },
      [ItemRarity.MYTHIC]: { ratio: 0.40, defenseCost: 4 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.RIPOSTE], r);
      return `On being attacked: reflect ${pct(v.ratio)} of the damage you just took back at the attacker, but lose ${v.defenseCost}% defense for the rest of the fight.`;
    },
    status: (ctx) => (ctx.inFight ? `${fmt(-ctx.item.skillAffectedStats.defense)} defense spent this fight` : ''),
  },

  // Shield Wall is the one shield skill that keeps a downside (the attack-speed tax) — its
  // numbers are pushed considerably harder than the other four to make that trade worth taking.
  [ItemSkillType.SHIELD_WALL]: {
    id: ItemSkillType.SHIELD_WALL,
    class: 'shield',
    name: 'Shield Wall',
    slots: SHIELD_SLOTS,
    // ON_ATTACKED accumulates the defense stack (+=, persists for the fight); AURA applies the
    // self-clearing attack-speed tax (=, every tick) — two different write styles on the same
    // skillAffectedStats because they touch disjoint fields. FIGHT_END resets the defense stack.
    triggerTypes: [TriggerType.ON_ATTACKED, TriggerType.AURA, TriggerType.FIGHT_END],
    values: {
      [ItemRarity.COMMON]: { defensePerHit: 5, maxDefense: 75, attackSpeedPenalty: 0.20 },
      [ItemRarity.RARE]: { defensePerHit: 6, maxDefense: 100, attackSpeedPenalty: 0.20 },
      [ItemRarity.EPIC]: { defensePerHit: 7, maxDefense: 150, attackSpeedPenalty: 0.25 },
      [ItemRarity.LEGENDARY]: { defensePerHit: 8, maxDefense: 200, attackSpeedPenalty: 0.25 },
      [ItemRarity.MYTHIC]: { defensePerHit: 10, maxDefense: 300, attackSpeedPenalty: 0.30 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.SHIELD_WALL], r);
      return `Each hit taken grants +${v.defensePerHit} defense for the rest of the fight (max +${v.maxDefense}), but you always suffer -${pct(v.attackSpeedPenalty)} attack speed.`;
    },
    status: (ctx) => {
      const { maxDefense } = skillValues(ITEM_SKILLS[ItemSkillType.SHIELD_WALL], ctx.item.rarity);
      return `+${fmt(ctx.item.skillAffectedStats.defense)} / +${maxDefense} defense`;
    },
  },

  [ItemSkillType.SHIELD_BASH]: {
    id: ItemSkillType.SHIELD_BASH,
    class: 'shield',
    name: 'Shield Bash',
    slots: SHIELD_SLOTS,
    // FIGHT_START resets the proc cooldown; ON_ATTACKED procs the stun (on cooldown).
    triggerTypes: [TriggerType.FIGHT_START, TriggerType.ON_ATTACKED],
    // A real stun (Player.setStunned) is strictly stronger than the old attack-speed slow it
    // replaces, so the cooldown is longer across the board — see PlayerSchema.setStunned.
    values: {
      [ItemRarity.COMMON]: { stunMs: 1000, cooldownMs: 4600 },
      [ItemRarity.RARE]: { stunMs: 1100, cooldownMs: 4400 },
      [ItemRarity.EPIC]: { stunMs: 1200, cooldownMs: 4200 },
      [ItemRarity.LEGENDARY]: { stunMs: 1300, cooldownMs: 4000 },
      [ItemRarity.MYTHIC]: { stunMs: 1400, cooldownMs: 3800 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.SHIELD_BASH], r);
      return `On being attacked (max once every ${v.cooldownMs / 1000}s): stun the enemy for ${(v.stunMs / 1000).toFixed(1)}s — they cannot attack, regenerate, use skills, or dodge.`;
    },
    status: (ctx) => {
      if (!ctx.inFight || !ctx.clock) return '';
      const { cooldownMs } = skillValues(ITEM_SKILLS[ItemSkillType.SHIELD_BASH], ctx.item.rarity);
      const last = shieldBashLastProcMs.get(ctx.item);
      if (last === undefined) return 'ready';
      const remaining = cooldownMs - (ctx.clock.elapsedTime - last);
      return remaining > 0 ? `${(remaining / 1000).toFixed(1)}s` : 'ready';
    },
  },

  [ItemSkillType.BRACE]: {
    id: ItemSkillType.BRACE,
    class: 'shield',
    name: 'Brace',
    slots: SHIELD_SLOTS,
    // FIGHT_START resets the hit counter; ON_ATTACKED blocks every Nth hit.
    triggerTypes: [TriggerType.FIGHT_START, TriggerType.ON_ATTACKED],
    values: {
      [ItemRarity.COMMON]: { every: 6 },
      [ItemRarity.RARE]: { every: 5 },
      [ItemRarity.EPIC]: { every: 4 },
      [ItemRarity.LEGENDARY]: { every: 3 },
      [ItemRarity.MYTHIC]: { every: 2 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.BRACE], r);
      const ordinal = v.every === 2 ? '2nd' : v.every === 3 ? '3rd' : `${v.every}th`;
      return `Every ${ordinal} hit taken is fully blocked.`;
    },
    status: (ctx) => {
      if (!ctx.inFight) return '';
      const { every } = skillValues(ITEM_SKILLS[ItemSkillType.BRACE], ctx.item.rarity);
      const count = braceCounters.get(ctx.item) ?? 0;
      return `${count % every}/${every} hits to next block`;
    },
  },

  // ------------------------------------------------------------- POTION (Health Flask) ----
  // Health Flask brews — one is rolled per shop slot (itemSkillRoller.ts's ensurePotionEffect),
  // shown on the card before purchase, banked on drink (DraftRoom.drinkItem) and spent by the
  // wearer's very next fight only (PlayerSchema.pendingPotionEffects, folded in by
  // statsUtils.recalculatePlayerStats / FightRoom.startBattle). Pinned to Common — flasks are in
  // NON_UPGRADEABLE_ITEM_IDS and excluded from shop lucky-find (see uniqueItemBalance.ts,
  // DraftRoom.ts) — so only a COMMON bracket is ever defined; no status() since potions are never
  // equipped, so ItemSkillStatusContext's per-tick sweep would never reach them.

  [ItemSkillType.REGENERATION]: {
    id: ItemSkillType.REGENERATION,
    class: 'potion',
    name: 'Regeneration',
    slots: [],
    triggerTypes: [],
    values: { [ItemRarity.COMMON]: { hpRegen: 12 } },
    describe: (r) => `+${skillValues(ITEM_SKILLS[ItemSkillType.REGENERATION], r).hpRegen} HP regen for your next fight.`,
  },

  // Antidote and Salve reduce (not block) their damage type — see PlayerSchema's
  // getPoisonDamageMultiplier/getBurnDamageMultiplier, applied at tick-damage calculation time in
  // FightRoom.ts (startPoisonTimer/checkBurn) rather than at stack application, so poison/burn
  // stacks still visibly apply (log lines, healing-effectiveness penalty) — only the tick damage
  // itself is softened. This also softens Salve's own wearer's self-burn tax (igniteEnemy), since
  // that's just another addBurnStacks call on the same player.
  [ItemSkillType.ANTIDOTE]: {
    id: ItemSkillType.ANTIDOTE,
    class: 'potion',
    name: 'Antidote',
    slots: [],
    triggerTypes: [],
    values: { [ItemRarity.COMMON]: { resistFraction: 0.5 } },
    describe: (r) => `Take ${pct(skillValues(ITEM_SKILLS[ItemSkillType.ANTIDOTE], r).resistFraction)} less damage from poison for your next fight.`,
  },

  [ItemSkillType.SALVE]: {
    id: ItemSkillType.SALVE,
    class: 'potion',
    name: 'Salve',
    slots: [],
    triggerTypes: [],
    values: { [ItemRarity.COMMON]: { resistFraction: 0.5 } },
    describe: (r) => `Take ${pct(skillValues(ITEM_SKILLS[ItemSkillType.SALVE], r).resistFraction)} less damage from burn (including your own self-inflicted burn) for your next fight.`,
  },

  [ItemSkillType.EVASION]: {
    id: ItemSkillType.EVASION,
    class: 'potion',
    name: 'Evasion',
    slots: [],
    triggerTypes: [],
    values: { [ItemRarity.COMMON]: { dodgeRate: 75 } },
    describe: (r) => `+${skillValues(ITEM_SKILLS[ItemSkillType.EVASION], r).dodgeRate} dodge rate for your next fight.`,
  },

  [ItemSkillType.STONESKIN]: {
    id: ItemSkillType.STONESKIN,
    class: 'potion',
    name: 'Stoneskin',
    slots: [],
    triggerTypes: [],
    values: { [ItemRarity.COMMON]: { defense: 75 } },
    describe: (r) => `+${skillValues(ITEM_SKILLS[ItemSkillType.STONESKIN], r).defense} defense for your next fight.`,
  },

  [ItemSkillType.FORTITUDE]: {
    id: ItemSkillType.FORTITUDE,
    class: 'potion',
    name: 'Fortitude',
    slots: [],
    triggerTypes: [],
    values: { [ItemRarity.COMMON]: { maxHp: 200 } },
    describe: (r) => `+${skillValues(ITEM_SKILLS[ItemSkillType.FORTITUDE], r).maxHp} max HP for your next fight.`,
  },

  [ItemSkillType.LIQUID_COURAGE]: {
    id: ItemSkillType.LIQUID_COURAGE,
    class: 'potion',
    name: 'Liquid Courage',
    slots: [],
    triggerTypes: [],
    values: { [ItemRarity.COMMON]: { invulnMs: 2000 } },
    describe: (r) => `Invulnerable for the first ${(skillValues(ITEM_SKILLS[ItemSkillType.LIQUID_COURAGE], r).invulnMs / 1000).toFixed(1)}s of your next fight.`,
  },
};

export const SKILLS_BY_CLASS: Record<ItemClass, ItemSkillDefinition[]> = {
  [ItemClass.ROGUE]: Object.values(ITEM_SKILLS).filter((d) => d.class === ItemClass.ROGUE),
  [ItemClass.WARRIOR]: Object.values(ITEM_SKILLS).filter((d) => d.class === ItemClass.WARRIOR),
  [ItemClass.MERCHANT]: Object.values(ITEM_SKILLS).filter((d) => d.class === ItemClass.MERCHANT),
};

/** Every class skill in one pool — Weapon Whisperer's fallback for a weapon that carries no
 *  `class` of its own (Wand of Fire, Chungi, Zwei-hander, …), so a unique still has something
 *  to roll from. Shields keep their own SHIELD_SKILLS pool. */
export const ALL_CLASS_SKILLS: ItemSkillDefinition[] = Object.values(SKILLS_BY_CLASS).flat();

/** Shield-only skill pool — rolled onto any shield (ItemType.SHIELD) regardless of `class`,
 *  see itemSkillRoller.ts's type-based branch. */
export const SHIELD_SKILLS: ItemSkillDefinition[] = Object.values(ITEM_SKILLS).filter((d) => d.class === 'shield');

/** Health Flask brew pool — rolled onto any item.type === 'potion', see
 *  itemSkillRoller.ts's ensurePotionEffect. */
export const POTION_SKILLS: ItemSkillDefinition[] = Object.values(ITEM_SKILLS).filter((d) => d.class === 'potion');

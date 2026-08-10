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
  shieldBashLastProcMs, braceCounters,
} from './itemSkillState';
// Type-only — see itemSkillState.ts's header comment on why this doesn't create a runtime cycle
// with ItemSchema.ts (which imports ItemSkillBehaviors.ts, which imports this file).
import type { Item } from '../schema/ItemSchema';
import type { Player } from '../../players/schema/PlayerSchema';
import type { ClockTimer } from '@colyseus/timer';

/** Class skills only ever roll onto a `class`-bearing item (ItemClass); shield skills roll
 *  onto any shield regardless of `class` (see itemSkillRoller.ts's type-based pool branch). */
export type ItemSkillGroup = ItemClass | 'shield';

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
  /** Rarity-keyed tuning — ItemSkillBehaviors reads skillValues(def, item.rarity). Class skills
   *  only define LEGENDARY/MYTHIC (they never roll below Legendary). Shield skills define every
   *  bracket, since shield skills are active from Common — see skillValues' fallback below. */
  values: Partial<Record<ItemRarity, Record<string, number>>>;
  describe(rarity: ItemRarity): string;
  /** Live one-line state for an EQUIPPED item (e.g. "+42 / +100 defense"), or '' to render no
   *  status line at all — see itemSkillStatus.ts. Omitted entirely for skills with no
   *  meaningful moment-to-moment state (Aegis, Light Fingers, Market Manipulation, Cash Back). */
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
    values: {
      [ItemRarity.LEGENDARY]: { ratio: 0.15 },
      [ItemRarity.MYTHIC]: { ratio: 0.3 },
    },
    describe: (r) => `Gain accuracy equal to ${pct(skillValues(ITEM_SKILLS[ItemSkillType.FLUID_MOTION], r).ratio)} of your dodge rate.`,
    status: (ctx) => `+${fmt(ctx.item.skillAffectedStats.accuracy)} accuracy`,
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
      [ItemRarity.MYTHIC]: { healRatio: 0.04, dodgeCost: 2 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.SHADOWSTEP], r);
      return `Each dodge heals ${pct(v.healRatio)} of your max HP, but costs you ${v.dodgeCost} dodge rate for the rest of the fight.`;
    },
    status: (ctx) => (ctx.inFight ? `${fmt(-ctx.item.skillAffectedStats.dodgeRate)} dodge rate spent this fight` : ''),
  },

  [ItemSkillType.OPENING_ACT]: {
    id: ItemSkillType.OPENING_ACT,
    class: ItemClass.ROGUE,
    name: 'Opening Act',
    slots: WEAPON_SLOTS,
    triggerTypes: [TriggerType.ON_ATTACK, TriggerType.FIGHT_START],
    values: {
      [ItemRarity.LEGENDARY]: { count: 3 },
      [ItemRarity.MYTHIC]: { count: 5 },
    },
    describe: (r) => `Your first ${skillValues(ITEM_SKILLS[ItemSkillType.OPENING_ACT], r).count} attacks each fight deal double damage.`,
    status: (ctx) => {
      if (!ctx.inFight) return '';
      const { count } = skillValues(ITEM_SKILLS[ItemSkillType.OPENING_ACT], ctx.item.rarity);
      const remaining = Math.max(0, count - (openingActCounters.get(ctx.item) ?? 0));
      return remaining > 0 ? `${remaining} double-damage attack${remaining > 1 ? 's' : ''} left` : 'used up';
    },
  },

  [ItemSkillType.SMOKE_BOMB]: {
    id: ItemSkillType.SMOKE_BOMB,
    class: ItemClass.ROGUE,
    name: 'Smoke Bomb',
    slots: GEAR_SLOTS,
    triggerTypes: [TriggerType.FIGHT_START, TriggerType.FIGHT_END],
    values: {
      [ItemRarity.LEGENDARY]: { ratio: 0.3, durationMs: 10000 },
      [ItemRarity.MYTHIC]: { ratio: 0.6, durationMs: 20000 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.SMOKE_BOMB], r);
      return `Fight start: enemy loses ${pct(v.ratio)} accuracy for ${v.durationMs / 1000}s.`;
    },
    status: (ctx) => {
      if (!ctx.inFight) return '';
      const debuff = -ctx.item.skillAffectedEnemyStats.accuracy;
      return debuff > 0 ? `enemy -${fmt(debuff)} accuracy (active)` : 'expired';
    },
  },

  [ItemSkillType.LIGHT_FINGERS]: {
    id: ItemSkillType.LIGHT_FINGERS,
    class: ItemClass.ROGUE,
    name: 'Light Fingers',
    slots: ANY_SLOT,
    triggerTypes: [TriggerType.SHOP_START],
    values: {
      [ItemRarity.LEGENDARY]: { count: 1 },
      [ItemRarity.MYTHIC]: { count: 2 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.LIGHT_FINGERS], r);
      return v.count > 1 ? 'Shop start: the cheapest two shop items are free.' : 'Shop start: the cheapest shop item is free.';
    },
  },

  // -------------------------------------------------------------- WARRIOR ----

  [ItemSkillType.BATTLE_FOCUS]: {
    id: ItemSkillType.BATTLE_FOCUS,
    class: ItemClass.WARRIOR,
    name: 'Battle Focus',
    slots: ANY_SLOT,
    triggerTypes: [TriggerType.AURA],
    values: {
      [ItemRarity.LEGENDARY]: { ratio: 0.15 },
      [ItemRarity.MYTHIC]: { ratio: 0.3 },
    },
    describe: (r) => `Gain accuracy equal to ${pct(skillValues(ITEM_SKILLS[ItemSkillType.BATTLE_FOCUS], r).ratio)} of your defense.`,
    status: (ctx) => `+${fmt(ctx.item.skillAffectedStats.accuracy)} accuracy`,
  },

  [ItemSkillType.INTIMIDATING_PRESENCE]: {
    id: ItemSkillType.INTIMIDATING_PRESENCE,
    class: ItemClass.WARRIOR,
    name: 'Intimidating Presence',
    slots: ANY_SLOT,
    triggerTypes: [TriggerType.AURA],
    values: {
      [ItemRarity.LEGENDARY]: { ratio: 0.2 },
      [ItemRarity.MYTHIC]: { ratio: 0.4 },
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
    values: {
      [ItemRarity.LEGENDARY]: { divisor: 12 },
      [ItemRarity.MYTHIC]: { divisor: 6 },
    },
    describe: (r) => `Gain 1 strength per ${skillValues(ITEM_SKILLS[ItemSkillType.TITANS_MIGHT], r).divisor} max HP.`,
    status: (ctx) => `+${fmt(ctx.item.skillAffectedStats.strength)} strength`,
  },

  [ItemSkillType.IRON_HIDE]: {
    id: ItemSkillType.IRON_HIDE,
    class: ItemClass.WARRIOR,
    name: 'Iron Hide',
    slots: GEAR_SLOTS,
    triggerTypes: [TriggerType.AURA],
    values: {
      [ItemRarity.LEGENDARY]: { divisor: 8 },
      [ItemRarity.MYTHIC]: { divisor: 4 },
    },
    describe: (r) => `Gain 1 defense per ${skillValues(ITEM_SKILLS[ItemSkillType.IRON_HIDE], r).divisor} max HP.`,
    status: (ctx) => `+${fmt(ctx.item.skillAffectedStats.defense)} defense`,
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
      [ItemRarity.LEGENDARY]: { count: 1 },
      [ItemRarity.MYTHIC]: { count: 2 },
    },
    describe: (r) => {
      const count = skillValues(ITEM_SKILLS[ItemSkillType.HAGGLER], r).count;
      return `${count} free shop reroll${count > 1 ? 's' : ''} per round.`;
    },
    status: (ctx) => {
      if (ctx.inFight) return '';
      const left = ctx.player.hagglerFreeRerolls;
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
    status: (ctx) => (ctx.inFight ? '' : (ctx.player.storeCreditFreeClaim ? 'free claim available' : 'claim used this round')),
  },

  [ItemSkillType.CASH_BACK]: {
    id: ItemSkillType.CASH_BACK,
    class: ItemClass.MERCHANT,
    name: 'Cash Back',
    slots: ANY_SLOT,
    triggerTypes: [TriggerType.ON_SELL],
    values: {
      [ItemRarity.LEGENDARY]: { gold: 1, xp: 2 },
      [ItemRarity.MYTHIC]: { gold: 2, xp: 4 },
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
    values: {
      [ItemRarity.LEGENDARY]: { ratio: 0.15 },
      [ItemRarity.MYTHIC]: { ratio: 0.3 },
    },
    describe: (r) => `Increase income by ${pct(skillValues(ITEM_SKILLS[ItemSkillType.COMPOUND_INTEREST], r).ratio)}.`,
    status: (ctx) => `+${fmt(ctx.item.skillAffectedStats.income)} income`,
  },

  [ItemSkillType.MARKET_MANIPULATION]: {
    id: ItemSkillType.MARKET_MANIPULATION,
    class: ItemClass.MERCHANT,
    name: 'Market Manipulation',
    slots: ANY_SLOT,
    triggerTypes: [TriggerType.SHOP_START, TriggerType.AFTER_REFRESH],
    values: {
      [ItemRarity.LEGENDARY]: { count: 1 },
      [ItemRarity.MYTHIC]: { count: 2 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.MARKET_MANIPULATION], r);
      return v.count > 1 ? 'Shop start: two random shop items are upgraded one rarity.' : 'Shop start: a random shop item is upgraded one rarity.';
    },
  },

  [ItemSkillType.BULK_DISCOUNT]: {
    id: ItemSkillType.BULK_DISCOUNT,
    class: ItemClass.MERCHANT,
    name: 'Bulk Discount',
    slots: ANY_SLOT,
    triggerTypes: [TriggerType.AURA],
    values: {
      [ItemRarity.LEGENDARY]: { perItem: 1 },
      [ItemRarity.MYTHIC]: { perItem: 2 },
    },
    describe: (r) => `Shop prices drop ${skillValues(ITEM_SKILLS[ItemSkillType.BULK_DISCOUNT], r).perItem} gold per merchant item equipped.`,
    status: (ctx) => {
      if (ctx.inFight) return '';
      const { perItem } = skillValues(ITEM_SKILLS[ItemSkillType.BULK_DISCOUNT], ctx.item.rarity);
      let merchantCount = 0;
      ctx.player.equippedItems.forEach((i) => { if (i.class === ItemClass.MERCHANT) merchantCount++; });
      return `${merchantCount} merchant item${merchantCount === 1 ? '' : 's'} equipped - shop prices -${merchantCount * perItem} gold`;
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
      [ItemRarity.MYTHIC]: { gold: 1, cooldownMs: 0 },
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

  // Riposte keeps a downside (like Shield Wall): each counter permanently burns a slice of your
  // own defense for the rest of the fight (reset on FIGHT_END), so it decays with use rather than
  // being pure upside like Aegis/Brace.
  [ItemSkillType.RIPOSTE]: {
    id: ItemSkillType.RIPOSTE,
    class: 'shield',
    name: 'Riposte',
    slots: SHIELD_SLOTS,
    triggerTypes: [TriggerType.ON_ATTACKED, TriggerType.FIGHT_END],
    values: {
      [ItemRarity.COMMON]: { ratio: 0.04, defenseCost: 1 },
      [ItemRarity.RARE]: { ratio: 0.08, defenseCost: 2 },
      [ItemRarity.EPIC]: { ratio: 0.12, defenseCost: 3 },
      [ItemRarity.LEGENDARY]: { ratio: 0.16, defenseCost: 4 },
      [ItemRarity.MYTHIC]: { ratio: 0.20, defenseCost: 5 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.RIPOSTE], r);
      return `On being attacked: counter for damage equal to ${pct(v.ratio)} of your defense, but lose ${v.defenseCost}% defense for the rest of the fight.`;
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
      [ItemRarity.COMMON]: { defensePerHit: 4, maxDefense: 50, attackSpeedPenalty: 0.20 },
      [ItemRarity.RARE]: { defensePerHit: 5, maxDefense: 75, attackSpeedPenalty: 0.20 },
      [ItemRarity.EPIC]: { defensePerHit: 6, maxDefense: 100, attackSpeedPenalty: 0.25 },
      [ItemRarity.LEGENDARY]: { defensePerHit: 7, maxDefense: 150, attackSpeedPenalty: 0.25 },
      [ItemRarity.MYTHIC]: { defensePerHit: 8, maxDefense: 200, attackSpeedPenalty: 0.30 },
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
    // FIGHT_START resets the proc cooldown; ON_ATTACKED procs the slow (on cooldown).
    triggerTypes: [TriggerType.FIGHT_START, TriggerType.ON_ATTACKED],
    values: {
      [ItemRarity.COMMON]: { slowRatio: 0.20, slowMs: 3000, cooldownMs: 4000 },
      [ItemRarity.RARE]: { slowRatio: 0.25, slowMs: 3000, cooldownMs: 4000 },
      [ItemRarity.EPIC]: { slowRatio: 0.30, slowMs: 3000, cooldownMs: 4000 },
      [ItemRarity.LEGENDARY]: { slowRatio: 0.35, slowMs: 3000, cooldownMs: 4000 },
      [ItemRarity.MYTHIC]: { slowRatio: 0.40, slowMs: 3000, cooldownMs: 4000 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.SHIELD_BASH], r);
      return `On being attacked (max once every ${v.cooldownMs / 1000}s): slow the enemy by ${pct(v.slowRatio)} attack speed for ${v.slowMs / 1000}s.`;
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
      [ItemRarity.EPIC]: { every: 5 },
      [ItemRarity.LEGENDARY]: { every: 4 },
      [ItemRarity.MYTHIC]: { every: 3 },
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
};

export const SKILLS_BY_CLASS: Record<ItemClass, ItemSkillDefinition[]> = {
  [ItemClass.ROGUE]: Object.values(ITEM_SKILLS).filter((d) => d.class === ItemClass.ROGUE),
  [ItemClass.WARRIOR]: Object.values(ITEM_SKILLS).filter((d) => d.class === ItemClass.WARRIOR),
  [ItemClass.MERCHANT]: Object.values(ITEM_SKILLS).filter((d) => d.class === ItemClass.MERCHANT),
};

/** Shield-only skill pool — rolled onto any shield (ItemType.SHIELD) regardless of `class`,
 *  see itemSkillRoller.ts's type-based branch. */
export const SHIELD_SKILLS: ItemSkillDefinition[] = Object.values(ITEM_SKILLS).filter((d) => d.class === 'shield');

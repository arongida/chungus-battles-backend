// Tuning + metadata for class-item skills (see ItemSkillBehaviors.ts for the logic that
// reads these). One definition per ItemSkillType, grouped by class for the roller
// (itemSkillRoller.ts). Mirrors the uniqueItemBalance.ts convention: every tunable
// number lives here so balance passes touch one file.

import { EquipSlot, ItemClass, ItemRarity } from '../types/ItemTypes';
import { TriggerType } from '../../common/types';
import { ItemSkillType } from '../types/ItemSkillTypes';

export interface ItemSkillDefinition {
  id: ItemSkillType;
  class: ItemClass;
  name: string;
  /** Equip slots this skill is allowed to roll onto. OnAttackTriggerCommand only ever fires
   *  the weapon that swung, so any skill using ON_ATTACK/ON_DODGE combat procs must be
   *  weapon-only (see rollItemSkill's slot filter). */
  slots: EquipSlot[];
  /** Unioned onto item.triggerTypes when the skill is granted (see grantItemSkill). */
  triggerTypes: TriggerType[];
  /** Rarity-keyed tuning — ItemSkillBehaviors reads skillValues(def, item.rarity). */
  values: Record<ItemRarity.LEGENDARY | ItemRarity.MYTHIC, Record<string, number>>;
  describe(rarity: ItemRarity): string;
}

const ANY_SLOT: EquipSlot[] = [EquipSlot.ARMOR, EquipSlot.HELMET, EquipSlot.MAIN_HAND, EquipSlot.OFF_HAND];
const WEAPON_SLOTS: EquipSlot[] = [EquipSlot.MAIN_HAND, EquipSlot.OFF_HAND];
const GEAR_SLOTS: EquipSlot[] = [EquipSlot.ARMOR, EquipSlot.HELMET];

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** Looks up the rarity-appropriate value bracket for a skill (LEGENDARY or MYTHIC — item
 *  rarity never rolls a skill below Legendary, see rollItemSkill). */
export function skillValues(def: ItemSkillDefinition, rarity: ItemRarity): Record<string, number> {
  return def.values[rarity >= ItemRarity.MYTHIC ? ItemRarity.MYTHIC : ItemRarity.LEGENDARY];
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
      [ItemRarity.LEGENDARY]: { healRatio: 0.03, dodgeCost: 1 },
      [ItemRarity.MYTHIC]: { healRatio: 0.05, dodgeCost: 1 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.SHADOWSTEP], r);
      return `Each dodge heals ${pct(v.healRatio)} of your max HP, but costs you ${v.dodgeCost} dodge rate for the rest of the fight.`;
    },
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
  },

  [ItemSkillType.TITANS_MIGHT]: {
    id: ItemSkillType.TITANS_MIGHT,
    class: ItemClass.WARRIOR,
    name: "Titan's Might",
    slots: ANY_SLOT,
    triggerTypes: [TriggerType.AURA],
    values: {
      [ItemRarity.LEGENDARY]: { divisor: 10 },
      [ItemRarity.MYTHIC]: { divisor: 5 },
    },
    describe: (r) => `Gain 1 strength per ${skillValues(ITEM_SKILLS[ItemSkillType.TITANS_MIGHT], r).divisor} max HP.`,
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
  },

  [ItemSkillType.WARLORDS_ROAR]: {
    id: ItemSkillType.WARLORDS_ROAR,
    class: ItemClass.WARRIOR,
    name: "Warlord's Roar",
    slots: ANY_SLOT,
    triggerTypes: [TriggerType.FIGHT_START, TriggerType.FIGHT_END],
    values: {
      [ItemRarity.LEGENDARY]: { ratio: 0.1 },
      [ItemRarity.MYTHIC]: { ratio: 0.2 },
    },
    describe: (r) => `Fight start: reduce enemy strength by ${pct(skillValues(ITEM_SKILLS[ItemSkillType.WARLORDS_ROAR], r).ratio)} of your defense.`,
  },

  [ItemSkillType.CRUSHING_BLOW]: {
    id: ItemSkillType.CRUSHING_BLOW,
    class: ItemClass.WARRIOR,
    name: 'Crushing Blow',
    slots: WEAPON_SLOTS,
    triggerTypes: [TriggerType.ON_ATTACK, TriggerType.FIGHT_START],
    values: {
      [ItemRarity.LEGENDARY]: { every: 3, ratio: 1.0 },
      [ItemRarity.MYTHIC]: { every: 2, ratio: 1.5 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.CRUSHING_BLOW], r);
      return `Every ${v.every === 3 ? '3rd' : `${v.every}th`} attack deals +${pct(v.ratio)} bonus damage.`;
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
  },
};

export const SKILLS_BY_CLASS: Record<ItemClass, ItemSkillDefinition[]> = {
  [ItemClass.ROGUE]: Object.values(ITEM_SKILLS).filter((d) => d.class === ItemClass.ROGUE),
  [ItemClass.WARRIOR]: Object.values(ITEM_SKILLS).filter((d) => d.class === ItemClass.WARRIOR),
  [ItemClass.MERCHANT]: Object.values(ITEM_SKILLS).filter((d) => d.class === ItemClass.MERCHANT),
};

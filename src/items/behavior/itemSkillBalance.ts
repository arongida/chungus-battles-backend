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
      [ItemRarity.LEGENDARY]: { ratio: 0.08 },
      [ItemRarity.MYTHIC]: { ratio: 0.16 },
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
      [ItemRarity.LEGENDARY]: { ratio: 0.25 },
      [ItemRarity.MYTHIC]: { ratio: 0.5 },
    },
    describe: (r) => `Gain accuracy equal to ${pct(skillValues(ITEM_SKILLS[ItemSkillType.FLUID_MOTION], r).ratio)} of your dodge rate.`,
  },

  [ItemSkillType.CUTPURSE]: {
    id: ItemSkillType.CUTPURSE,
    class: ItemClass.ROGUE,
    name: 'Cutpurse',
    slots: ANY_SLOT,
    triggerTypes: [TriggerType.ON_DODGE, TriggerType.FIGHT_END],
    values: {
      [ItemRarity.LEGENDARY]: { gold: 1, strength: 0.5 },
      [ItemRarity.MYTHIC]: { gold: 2, strength: 1 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.CUTPURSE], r);
      return `On dodge: steal ${v.gold} gold and ${v.strength} strength from the enemy.`;
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
    triggerTypes: [TriggerType.ON_DODGE],
    values: {
      [ItemRarity.LEGENDARY]: { healRatio: 0 },
      [ItemRarity.MYTHIC]: { healRatio: 0.08 },
    },
    describe: (r) => r >= ItemRarity.MYTHIC
      ? "After you dodge, your next attack can't be dodged, deals double damage, and heals 8% of your max HP."
      : "After you dodge, your next attack can't be dodged and deals double damage.",
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
      [ItemRarity.LEGENDARY]: { ratio: 0.2 },
      [ItemRarity.MYTHIC]: { ratio: 0.4 },
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
      [ItemRarity.LEGENDARY]: { ratio: 0.15 },
      [ItemRarity.MYTHIC]: { ratio: 0.3 },
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
      [ItemRarity.LEGENDARY]: { divisor: 20 },
      [ItemRarity.MYTHIC]: { divisor: 10 },
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
    triggerTypes: [TriggerType.FIGHT_START],
    values: {
      [ItemRarity.LEGENDARY]: { healRatio: 0.08, invulnMs: 0 },
      [ItemRarity.MYTHIC]: { healRatio: 0.15, invulnMs: 1000 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.BULWARK], r);
      return v.invulnMs > 0
        ? `Fight start: heal ${pct(v.healRatio)} of max HP and gain ${v.invulnMs / 1000}s invulnerability.`
        : `Fight start: heal ${pct(v.healRatio)} of max HP.`;
    },
  },

  [ItemSkillType.LAST_STAND]: {
    id: ItemSkillType.LAST_STAND,
    class: ItemClass.WARRIOR,
    name: 'Last Stand',
    slots: ANY_SLOT,
    triggerTypes: [TriggerType.AURA],
    values: {
      [ItemRarity.LEGENDARY]: { defenseRatio: 0.5, hpRegen: 5 },
      [ItemRarity.MYTHIC]: { defenseRatio: 1.0, hpRegen: 12 },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.LAST_STAND], r);
      return `Below 35% HP: +${pct(v.defenseRatio)} defense and +${v.hpRegen} HP regen.`;
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
      [ItemRarity.LEGENDARY]: { every: 4, ratio: 1.0 },
      [ItemRarity.MYTHIC]: { every: 3, ratio: 1.5 },
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
      [ItemRarity.LEGENDARY]: { discount: 1 },
      [ItemRarity.MYTHIC]: { discount: 2 },
    },
    describe: (r) => `Shop reroll costs ${skillValues(ITEM_SKILLS[ItemSkillType.HAGGLER], r).discount} gold less.`,
  },

  [ItemSkillType.STORE_CREDIT]: {
    id: ItemSkillType.STORE_CREDIT,
    class: ItemClass.MERCHANT,
    name: 'Store Credit',
    slots: ANY_SLOT,
    triggerTypes: [TriggerType.AURA],
    values: {
      [ItemRarity.LEGENDARY]: { cap: 12 },
      [ItemRarity.MYTHIC]: { cap: Number.MAX_SAFE_INTEGER },
    },
    describe: (r) => {
      const v = skillValues(ITEM_SKILLS[ItemSkillType.STORE_CREDIT], r);
      return v.cap >= Number.MAX_SAFE_INTEGER
        ? 'Shop phase: claim one free item, any price.'
        : `Shop phase: claim one free item priced ${v.cap} gold or less.`;
    },
  },

  [ItemSkillType.APPRAISER]: {
    id: ItemSkillType.APPRAISER,
    class: ItemClass.MERCHANT,
    name: 'Appraiser',
    slots: ANY_SLOT,
    triggerTypes: [TriggerType.AURA],
    values: {
      [ItemRarity.LEGENDARY]: { multiplier: 1.0 },
      [ItemRarity.MYTHIC]: { multiplier: 1.1 },
    },
    describe: (r) => `Items sell for ${pct(skillValues(ITEM_SKILLS[ItemSkillType.APPRAISER], r).multiplier)} of their price (normally 70%).`,
  },

  [ItemSkillType.COMPOUND_INTEREST]: {
    id: ItemSkillType.COMPOUND_INTEREST,
    class: ItemClass.MERCHANT,
    name: 'Compound Interest',
    slots: ANY_SLOT,
    triggerTypes: [TriggerType.SHOP_START, TriggerType.AFTER_REFRESH],
    values: {
      [ItemRarity.LEGENDARY]: { ratio: 0.1 },
      [ItemRarity.MYTHIC]: { ratio: 0.2 },
    },
    describe: (r) => `Shop start: gain gold equal to ${pct(skillValues(ITEM_SKILLS[ItemSkillType.COMPOUND_INTEREST], r).ratio)} of your unspent gold.`,
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
    describe: (r) => `Shop prices drop ${skillValues(ITEM_SKILLS[ItemSkillType.BULK_DISCOUNT], r).perItem} gold per merchant item you own.`,
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

  [ItemSkillType.LIQUID_ASSETS]: {
    id: ItemSkillType.LIQUID_ASSETS,
    class: ItemClass.MERCHANT,
    name: 'Liquid Assets',
    slots: ANY_SLOT,
    triggerTypes: [TriggerType.AURA],
    values: {
      [ItemRarity.LEGENDARY]: { ratio: 0.008 },
      [ItemRarity.MYTHIC]: { ratio: 0.016 },
    },
    describe: (r) => `Gain ${pct(skillValues(ITEM_SKILLS[ItemSkillType.LIQUID_ASSETS], r).ratio)} attack speed per income.`,
  },
};

export const SKILLS_BY_CLASS: Record<ItemClass, ItemSkillDefinition[]> = {
  [ItemClass.ROGUE]: Object.values(ITEM_SKILLS).filter((d) => d.class === ItemClass.ROGUE),
  [ItemClass.WARRIOR]: Object.values(ITEM_SKILLS).filter((d) => d.class === ItemClass.WARRIOR),
  [ItemClass.MERCHANT]: Object.values(ITEM_SKILLS).filter((d) => d.class === ItemClass.MERCHANT),
};

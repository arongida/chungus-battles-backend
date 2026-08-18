// Class-item skill IDs. Mirrors the CLASS_TIER-style numbering already used by
// TalentType (101-503): rogue 101+, warrior 201+, merchant 301+. A class item rolls
// one of its class's skills the moment it reaches Legendary (see itemSkillRoller.ts /
// ShopUpgradeUtils.applyRarityUpgrade); Mythic re-describes the same skill at its
// stronger tier (ItemSkillBehaviors.ts reads item.rarity to pick the value bracket).
export enum ItemSkillType {
  EXPLOIT_WEAKNESS = 101,
  FLUID_MOTION = 102,
  PLAGUE_BEARER = 103,
  COATED_EDGE = 104,
  SHADOWSTEP = 105,
  OPENING_ACT = 106,
  SMOKE_BOMB = 107,
  LIGHT_FINGERS = 108,

  BATTLE_FOCUS = 201,
  INTIMIDATING_PRESENCE = 202,
  TITANS_MIGHT = 203,
  IRON_HIDE = 204,
  BULWARK = 205,
  LAST_STAND = 206,
  WARLORDS_ROAR = 207,
  CRUSHING_BLOW = 208,

  HAGGLER = 301,
  STORE_CREDIT = 302,
  CASH_BACK = 303,
  COMPOUND_INTEREST = 304,
  MARKET_MANIPULATION = 305,
  BULK_DISCOUNT = 306,
  PROTECTION_MONEY = 307,
  WAR_CHEST = 308,

  // Shield-only skills (any shield, regardless of class) — see itemSkillRoller.ts's
  // type-based pool branch. Active from Common rarity, unlike class skills (Legendary+),
  // since they replace the old flat fight-start invulnerability which also worked at
  // every rarity.
  AEGIS = 401,
  RIPOSTE = 402,
  SHIELD_WALL = 403,
  SHIELD_BASH = 404,
  BRACE = 405,

  // Health Flask brews (itemType 'potion') — rolled per shop slot (see itemSkillRoller.ts's
  // ensurePotionEffect), banked on drink (DraftRoom.drinkItem), spent by the wearer's next fight
  // only (PlayerSchema.pendingPotionEffects). Not dispatched via ItemSkillBehaviors — potions are
  // never equipped, so nothing would ever call executeBehavior on them.
  REGENERATION = 501,
  ANTIDOTE = 502,
  EVASION = 503,
  STONESKIN = 504,
  FORTITUDE = 505,
  LIQUID_COURAGE = 506,
  SALVE = 507,
}

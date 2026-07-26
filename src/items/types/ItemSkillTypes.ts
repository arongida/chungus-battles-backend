// Class-item skill IDs. Mirrors the CLASS_TIER-style numbering already used by
// TalentType (101-503): rogue 101+, warrior 201+, merchant 301+. A class item rolls
// one of its class's skills the moment it reaches Legendary (see itemSkillRoller.ts /
// ShopUpgradeUtils.applyRarityUpgrade); Mythic re-describes the same skill at its
// stronger tier (ItemSkillBehaviors.ts reads item.rarity to pick the value bracket).
export enum ItemSkillType {
  EXPLOIT_WEAKNESS = 101,
  FLUID_MOTION = 102,
  CUTPURSE = 103,
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
  LIQUID_ASSETS = 308,
}

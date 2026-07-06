import { Item } from '../../items/schema/ItemSchema';

/** Server-only, per-item snapshot of a weapon's rarity/stats immediately before Weapon
 *  Whisperer's aura upgraded it to Mythic while equipped in MAIN_HAND (TalentBehaviors.ts
 *  WEAPON_WHISPERER). Keyed by object identity rather than a field on the Item schema itself —
 *  storing an Item inside Item would make its own `toJSON()`/`ToJSON<Item>` type circularly
 *  reference itself, which Colyseus schema's cloneItem() relies on. Consulted and cleared by
 *  PlayerSchema.setItemUnequipped when the weapon leaves MAIN_HAND, so cycling weapons through
 *  that slot can't permanently bank multiple Mythic weapons. */
export const weaponWhispererSnapshots = new WeakMap<Item, Item>();

/** Server-only, per-item cache of the *first* Mythic result Weapon Whisperer ever rolled for
 *  this exact weapon instance (its affixes are randomized per rarity step). Unlike
 *  weaponWhispererSnapshots, this is never cleared on unequip — so re-equipping the same weapon
 *  later reapplies the identical rolled result instead of rolling fresh random affixes each
 *  time. A different copy of the same itemId (e.g. bought again after selling) is a distinct
 *  Item object and gets its own independent first roll. */
export const weaponWhispererFinalRolls = new WeakMap<Item, Item>();

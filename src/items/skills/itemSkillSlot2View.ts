import { Item } from '../schema/ItemSchema';

/** All ~30 ItemSkillBehaviors (ItemSkillBehaviors.ts) are written against a single skill slot:
 *  they read `item.skillId`/`item.rarity` and write `item.skillAffectedStats`/
 *  `item.skillAffectedEnemyStats`. Weapon Whisperer's second skill slot (ItemSchema.ts's
 *  skillId2/skillAffectedStats2/skillAffectedEnemyStats2) needs those SAME behaviors to run
 *  unmodified against the "2" fields instead — rewriting every behavior to be slot-aware would
 *  duplicate ~450 lines for a feature only one talent grants.
 *
 *  This is a thin Proxy over the real Item that redirects just those three property names to
 *  their "2" counterparts and passes everything else straight through to the real object — so a
 *  behavior reading `item.skillId` or writing `item.skillAffectedStats.accuracy = x` transparently
 *  operates on skillId2/skillAffectedStats2, while `item.rarity`, `item.name`, `item.itemId`, etc.
 *  still resolve to the real shared values. Writes land on the real Item's actual @type() schema
 *  fields (the Proxy only renames properties, it never clones data), so Colyseus change
 *  detection still fires normally.
 *
 *  Cached per real item (not rebuilt every call) because several skill behaviors key WeakMaps
 *  (coatedEdgeCounters, openingActCounters, protectionMoneyLastProcMs, ...) off the exact `item`
 *  reference they're handed — a fresh Proxy every aura/attack tick would silently reset that
 *  per-item state every time. */
const slot2Views = new WeakMap<Item, Item>();

const SLOT2_REDIRECTS: Record<string, string> = {
  skillId: 'skillId2',
  skillAffectedStats: 'skillAffectedStats2',
  skillAffectedEnemyStats: 'skillAffectedEnemyStats2',
};

export function getSkillSlot2View(item: Item): Item {
  let view = slot2Views.get(item);
  if (!view) {
    view = new Proxy(item, {
      // No `receiver` passed to Reflect here (defaults to `target`) — a schema accessor's
      // internal `this` should stay bound to the real item, not this Proxy, so it isn't routed
      // back through these traps for unrelated field access.
      get(target, prop) {
        const redirect = typeof prop === 'string' && SLOT2_REDIRECTS[prop];
        return Reflect.get(target, redirect || prop);
      },
      set(target, prop, value) {
        const redirect = typeof prop === 'string' && SLOT2_REDIRECTS[prop];
        return Reflect.set(target, redirect || prop, value);
      },
    }) as Item;
    slot2Views.set(item, view);
  }
  return view;
}

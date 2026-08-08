// Refreshes item.skillStatus (ItemSchema.ts) — the live "what is this skill doing right now"
// line rendered under the static skillDescription on the item card (see itemSkillBalance.ts's
// `status()` for the per-skill text). Called once per tick from UpdateStatsCommand, right after
// stats are recalculated, so it always reflects the same tick's skillAffectedStats output.

import { Player } from '../../players/schema/PlayerSchema';
import { Item } from '../schema/ItemSchema';
import { ITEM_SKILLS } from '../behavior/itemSkillBalance';
import { ClockTimer } from '@colyseus/timer';

function statusFor(item: Item, player: Player, enemy: Player | undefined, inFight: boolean, clock: ClockTimer | undefined): string {
  if (!item?.skillId) return '';
  const def = ITEM_SKILLS[item.skillId];
  if (!def?.status) return '';
  try {
    return def.status({ item, player, enemy, clock, inFight });
  } catch (e) {
    console.error(`Failed to compute skill status for item ${item.itemId} (skill ${item.skillId}):`, e);
    return '';
  }
}

/** Rebuilds skillStatus for every equipped item on `player` (live text) and clears it on every
 *  inventory item (skills only ever describe an EQUIPPED item — see ItemSchema.ts's field
 *  comment). `enemy`/`clock` are only present in FightRoom; `inFight` gates skills whose status
 *  only makes sense mid-combat (see itemSkillBalance.ts's per-skill rules). Assignment is
 *  skipped when the text hasn't changed, so a 100ms fight tick doesn't emit a schema patch for
 *  every equipped item every tick. */
export function refreshItemSkillStatus(player: Player, enemy: Player | undefined, inFight: boolean, clock?: ClockTimer): void {
  player.equippedItems.forEach((item) => {
    const text = statusFor(item, player, enemy, inFight, clock);
    if (item.skillStatus !== text) item.skillStatus = text;
  });
  player.inventory.forEach((item) => {
    if (item.skillStatus !== '') item.skillStatus = '';
  });
}

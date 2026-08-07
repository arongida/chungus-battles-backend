import {Item} from '../../items/schema/ItemSchema';

/** Merchant_1 / "Flash Sale": how much gold was actually shaved off each shop Item's price the
 *  last time the talent's after-refresh discount ran (clamped at 0, so a cheap item's real
 *  reduction can be less than the nominal talent.base * level discount). Read by DraftRoom.buyItem
 *  to credit the talent's statGoldGained only for items actually bought — crediting the whole
 *  shop-wide discount at trigger time would count savings on items nobody purchased. Same
 *  module-level side-table pattern as weaponWhispererState.ts. Cleared implicitly: entries for
 *  items that leave the shop (sold, or the shop rebuilt) are simply never read again. */
export const merchantDiscounts = new WeakMap<Item, number>();

import { Schema, type, ArraySchema, SetSchema } from '@colyseus/schema';
import {AffectedStats} from "../../common/schema/AffectedStatsSchema";
import {ItemBehaviors} from '../behavior/ItemBehaviors';
import {ItemSkillBehaviors} from '../behavior/ItemSkillBehaviors';
import {BehaviorContext} from '../../common/BehaviorContext';
import {ItemBehaviorContext} from '../behavior/ItemBehaviorContext';
import {getSkillSlot2View} from '../skills/itemSkillSlot2View';


export class Item extends Schema {
  @type('number') itemId: number = 0;
  @type('string') name: string = 'Missing';
  @type('string') description: string;
  @type('number') price: number = 0;
  @type('number') sellPrice: number = 0;
  @type(AffectedStats) affectedStats: AffectedStats;
  @type('number') tier: number;
  @type('number') rarity: number = 1;
  @type('string') image: string;
  @type(['string']) tags: ArraySchema<string>;
  @type('boolean') sold: boolean = false;
  @type('boolean') equipped: boolean = false;
  @type(['number']) itemCollections: number[];
  @type('string') type: string;
  @type('string') class: string;
  @type(['string']) equipOptions: SetSchema<string>;
  @type('boolean') showDetails: boolean = false;
  @type('number') baseMinDamage: number = 0;
  @type('number') baseMaxDamage: number = 0;
  @type('number') baseAttackSpeed: number = 0;
  @type('number') strengthScaling: number = 1;
  @type(['string']) triggerTypes: ArraySchema<string> = new ArraySchema<string>();
  // Activations per second for TriggerType.ACTIVE items (Wand of Fire, Flowering Staff, Magic
  // Ring) — same meaning/formula as Talent.activationRate. 0 for every non-active item.
  @type('number') activationRate: number = 0;
  @type(AffectedStats) affectedEnemyStats: AffectedStats;
  // True only for shop slots that upgrade an item the player already owns.
  @type('boolean') upgradePreview: boolean = false;
  // True for shop slots that rolled a lucky-find rarity-up (see applyLuckyShopUpgrades).
  @type('boolean') luckyFind: boolean = false;
  // Rarity of the owned item this preview was built from — lets DraftRoom detect that the
  // owned copy has since changed (e.g. a loss-reward upgrade while the shop was locked) and
  // rebuild the slot. 0 when this slot isn't an upgrade preview.
  @type('number') previewBaseRarity: number = 0;
  // Free rarity steps this slot rolled via applyLuckyShopUpgrades — preserved across a
  // DraftRoom.rebuildShopSlot rebuild so a locked lucky find isn't downgraded.
  @type('number') luckyFindSteps: number = 0;
  // Class-item skill (see items/skills/itemSkillRoller.ts): rolled the moment a class item
  // reaches Legendary, re-described (same skillId, stronger numbers) on the Mythic step. 0/empty
  // when no skill has been granted (non-class items, or a class item below Legendary).
  @type('number') skillId: number = 0;
  @type('string') skillName: string = '';
  @type('string') skillDescription: string = '';
  // Dynamic skill output ONLY — never the item's own rolled/upgraded stats (those stay in
  // affectedStats/affectedEnemyStats above, merged by ShopUpgradeUtils.applyRarityUpgrade).
  // Deliberately NOT persisted to Mongo (items/db/Item.ts's ItemSchema has no field for these) —
  // aura-driven skills self-clear every tick, so a fresh AffectedStats() on load is always
  // immediately correct. Accumulated by statsUtils.recalculatePlayerStats alongside affectedStats.
  @type(AffectedStats) skillAffectedStats: AffectedStats = new AffectedStats();
  @type(AffectedStats) skillAffectedEnemyStats: AffectedStats = new AffectedStats();
  // Live, per-tick skill state as display text (e.g. "+42 / +100 defense") — rebuilt every tick
  // by items/skills/itemSkillStatus.ts for EQUIPPED items only, empty otherwise. Deliberately
  // NOT persisted to Mongo (items/db/Item.ts has no field for it), same reasoning as
  // skillAffectedStats above: it is recomputed from live state within one tick of any load.
  @type('string') skillStatus: string = '';
  // Second item skill — only ever granted by Weapon Whisperer (TalentBehaviors.ts). Same shape
  // and lifecycle as skillId/skillName/skillDescription/skillAffectedStats/skillAffectedEnemyStats/
  // skillStatus above; 0/empty for every other item. Dispatched via the slot-2 Proxy view (see
  // items/skills/itemSkillSlot2View.ts) so the same ItemSkillBehaviors run against it unmodified.
  @type('number') skillId2: number = 0;
  @type('string') skillName2: string = '';
  @type('string') skillDescription2: string = '';
  @type(AffectedStats) skillAffectedStats2: AffectedStats = new AffectedStats();
  @type(AffectedStats) skillAffectedEnemyStats2: AffectedStats = new AffectedStats();
  @type('string') skillStatus2: string = '';
  // The skill this class item WILL roll once it reaches Legendary — precomputed from the same
  // deterministic seed rollItemSkill uses (see items/skills/itemSkillRoller.ts's
  // refreshFutureItemSkill), so it's a promise, not a guess. 0/empty once a real skillId is
  // granted (the real skill supersedes the preview), for shields (which already roll from
  // Common), and for non-class items. Deliberately NOT persisted to Mongo (items/db/Item.ts has
  // no field for these) — recomputed every load/aura tick, same reasoning as skillAffectedStats.
  // Declared at the end of the @type block so existing field indices stay stable.
  @type('number') futureSkillId: number = 0;
  @type('string') futureSkillName: string = '';
  @type('string') futureSkillDescription: string = '';
  // Runtime-only max-damage bonus accumulated during a fight (Soulstealer's Scythe souls — see
  // ItemBehaviors.ts). Deliberately NOT persisted to Mongo (items/db/Item.ts has no field for it)
  // — same reasoning as skillAffectedStats above: FightRoom builds fresh Item instances every
  // fight, so a 0 default is always immediately correct and needs no explicit reset.
  @type('number') bonusMaxDamage: number = 0;
  // Shop-roll nonce mixed into the item-skill hash (itemSkillRoller.ts). Assigned fresh per slot
  // each time DraftRoom.updateShop rolls a shop, so rerolling can show a different skill on the
  // same item — then it travels with the object, so buying (or an upgrade preview cloned from an
  // owned item) freezes the roll. 0 for every item that never came from a shop roll, which
  // reproduces the pre-nonce hash exactly.
  @type('number') skillRollNonce: number = 0;
  // Server-only, not synced: Gold Genie (TalentBehaviors.ts) rolls its post-Legendary lucky-find
  // chance exactly once per shop slot — this latches that so repeat aura ticks don't re-roll it.
  goldGenieLuckyRolled: boolean = false;

  executeBehavior(context: BehaviorContext): void | Promise<void> {
    const itemContext: ItemBehaviorContext = { ...context, item: this };
    const results: (void | Promise<void>)[] = [];

    const behavior = ItemBehaviors[this.itemId] ?? ItemBehaviors[this.type];
    if (behavior) results.push(behavior(itemContext));

    const skillBehavior = this.skillId ? ItemSkillBehaviors[this.skillId] : undefined;
    if (skillBehavior) results.push(skillBehavior(itemContext));

    const skillBehavior2 = this.skillId2 ? ItemSkillBehaviors[this.skillId2] : undefined;
    if (skillBehavior2) results.push(skillBehavior2({ ...context, item: getSkillSlot2View(this) }));

    const pending = results.filter((r) => r instanceof Promise) as Promise<void>[];
    if (pending.length > 0) return Promise.all(pending).then(() => {});
  }
}
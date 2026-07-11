/** One season of Chungus Battles.  Seasons are named runs of the game while
 *  GAME_VERSION is held at a particular number.  Add a new entry here (prepend,
 *  so the list stays newest-first) every time GAME_VERSION is bumped in types.ts.
 *
 *  For any backend code change that looks like a balance change (stat/cost/scaling
 *  tuning, talent/item behaviour change) — append a one-line entry to the CURRENT
 *  season's `changes` array rather than waiting for the next bump. */
export interface SeasonInfo {
  /** Matches GAME_VERSION at the time this season was active. */
  number: number;
  /** Short human-readable season name shown in the encyclopedia Seasons tab. */
  name: string;
  /** List of notable balance/feature changes that happened during this season.
   *  Pure infra, UI-only, and bug-fix commits are omitted. */
  changes: string[];
}

/** All seasons, newest first.  The first entry must have number === GAME_VERSION. */
export const SEASONS: SeasonInfo[] = [
  {
    number: 17,
    name: 'Balance is Temporary',
    changes: [
      'Max HP: characters now gain +10 max HP every level (base 100), shown on the level-up screen',
      'Magic Ring: reworked — no longer a weapon and no longer attacks; now stacks its bonus stats via a once-per-second aura during fights (removes attack-speed scaling and Dual Wield interaction)',
      'Wand of Fire: no longer grants +20 max HP',
      'Health Flask: reworked and re-enabled in the shop — drinking it now grants a burst of HP regen for your next fight only, instead of a permanent extra life',
      'Band of Vigor: new ring — the first time you drop below 30% HP in a fight, heal a portion of your max HP and become briefly invulnerable (once per fight)',
    ],
  },
  {
    number: 16,
    name: 'Race to Twelve',
    changes: [
      'Fixed-length runs: reaching 12 wins now ends the run as a victory — the old beat-the-record win condition is gone',
      'Losses are now tracked per character',
      'Wall of Fame: finished 12-win characters ranked by fewest losses',
      'HP potion: disabled',
      'Dual Wield: removed attack speed bonus',
      'Comrade: reworked — claim one free item from each shop; reroll cost increased by your income',
      'Throw Money at the Problem: now deals 100% of your income as damage every 2s (was gold-scaled)',
      'Unstoppable Force: reworked — every 2s your next weapon attack deals double damage and can\'t be dodged',
      'Berserk: reworked — below 50% HP, gain +100% strength and +100% attack speed',
      'Hidden Vials: reworked — dodging now applies 1 burn and 1 poison stack to the enemy',
      'Gold Genie: reworked — merchant items in the shop are now Legendary (with a lucky-find chance to roll Mythic), and the first merchant item you buy each shop is free',
      'Income Inequality: increased income bonus to 10',
      'Weapon Whisperer: weapon only keeps upgrade permanently if you fight with it once',
      'Martial Artist: reworked — fights with two fists that learn 50% of the damage and stats of weapons stored in your inventory and punch at their average attack speed',
      'Black Market Contact: fixed — the free lucky-find buy is now a claim on whichever lucky item you choose, refreshed every shop (was auto-applied to the first lucky item, once per draft phase)',
      'Eye for an Eye: fixed — no longer reflects burn/poison ticks or reflected damage (only direct hits), and burn/poison ticks no longer misattribute the attacker'
    ],
  },
  {
    number: 15,
    name: 'New Beginnings',
    changes: [
      'Loss consolation reworked: losing players now choose between bonus gold (30/20/10 by lives left), bonus XP (20% more than the gold amount), or upgrading the rarity of a random owned item',
      'Overheal reporting fixed: healing at full HP no longer inflates healing-done stats, floating heal numbers, or replay HP bars',
      'Stats after fights: you can check out various stats like damage dealt or dodged after fights',
      'Fight speed controls: speed up or slow down fights at real time'
    ],
  },
  {
    number: 14,
    name: 'Magic Ring Nerf',
    changes: [
      'Magic Ring ability nerfed to reduce dominance in high-win runs',
    ],
  },
  {
    number: 13,
    name: 'Poison & Ring Rework',
    changes: [
      'Poison mechanic fully reworked: now applies stacks with scaling damage over time',
      'Ring of Immortality reworked alongside poison changes',
      'Invigorate talent interaction fixed',
    ],
  },
  {
    number: 12,
    name: 'Early Poison Changes',
    changes: [
      'Initial poison balance pass',
      'Invigorate talent behaviour corrected',
      'Various QoL adjustments',
    ],
  },
  {
    number: 11,
    name: 'Lucky Find System',
    changes: [
      'New: Lucky Find system — shop refreshes can now upgrade items you already own to higher rarity',
      'Small balance and quality-of-life adjustments',
      'Encyclopedia added to the draft toolbar',
    ],
  },
  {
    number: 10,
    name: 'Martial Artist Rework',
    changes: [
      'Martial Artist talent completely reworked',
      'Unique items system introduced',
      'Life (heart) price increased',
      'XP-until-next-level tracking improved',
      'Item and talent balance adjustments',
      'Some talent tuning',
    ],
  },
  {
    number: 9,
    name: 'Flowering Staff & Strength Scaling',
    changes: [
      'New item: Flowering Staff',
      'Strength now scales attack calculations more meaningfully',
      'Losing players receive bonus gold at round end',
      'Starting bonuses and talent tuning for new runs',
      'Abandon Run feature added',
      'Fight replay system introduced',
    ],
  },
  {
    number: 8,
    name: 'Major Gameplay Update',
    changes: [
      'Major gameplay overhaul (multiple simultaneous changes)',
      'Zealot talent now scales correctly with talent-bonus stats',
      'Attack speed stacking bug fixed',
    ],
  },
  {
    number: 7,
    name: 'Combat Logging',
    changes: [
      'Combat log introduced: live feed of fight events with talent/stat tracking',
    ],
  },
  {
    number: 6,
    name: 'Mercenary Buff',
    changes: [
      'Mercenary talent buffed',
    ],
  },
  {
    number: 5,
    name: 'Gold & Income Update',
    changes: [
      'Gold generation and income stats rebalanced',
      'Talent balance adjustments',
    ],
  },
  {
    number: 4,
    name: 'Leaderboard Update',
    changes: [
      'Leaderboard system introduced',
      'Reflect talent bug fixed',
    ],
  },
  {
    number: 3,
    name: 'Reconnection Improvements',
    changes: [
      'Reconnection flow overhauled for reliability',
      'Level-up detection edge cases fixed',
    ],
  },
  {
    number: 2,
    name: 'Reconnection System',
    changes: [
      'Initial reconnection system added (players can rejoin mid-fight)',
      'Fight room stability improvements',
    ],
  },
  {
    number: 1,
    name: 'Launch',
    changes: [
      'Initial game launch',
      'Core auto-battler loop: draft → shop → fight',
      'Items, talents, and combat system',
      'Classes: Warrior, Rogue, Merchant',
    ],
  },
];

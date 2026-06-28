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
    number: 15,
    name: 'New Beginnings',
    changes: [
      // Balance changes for season 15 go here as they are made.
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

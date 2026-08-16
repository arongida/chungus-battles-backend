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
    number: 24,
    name: 'Placeholder',
    changes: [
      'Increase tier 3 item minimum stat values',
      'Accuracy no longer decreases enemy dodge rating',
      'Burn is now double-edged: every source that ignites the enemy also burns you for 1/3 as many stacks (rounded up) — Hidden Vials is the exception',
      'The Bear reworked into Fire with Fire and moved to tier 4: every 4s, consumes up to 10 burn stacks on each player and heals 1% max HP per stack consumed',
      'Wand of Fire and Burning Blood now apply burn to you as well as the enemy',
      'Scam reworked into an economy talent: no longer tied to dodging — every activation cons 1 gold out of the enemy, but the mark wises up and permanently gains 1 strength for the rest of the fight',
      'Second Thoughts replaced by VIP Pass and moved to merchant: every shop is guaranteed to stock an item you already own, and you gain +10% lucky find — but rerolls cost 1 more gold',
    ]
  },
  {
    number: 23,
    name: 'Cooldown',
    changes: [
      'Gold Genie fixed: the free merchant item is now once per shop phase, not once per reroll',
      'Black Market Contact fixed: the free lucky-find item is now once per shop phase, not once per reroll',
      'Riposte: costs % defense to use',
      'Brace: hits needed to activate increased by 1',
      'Aegis: invuln duration slightly increased',
      'Shield wall: defense granted increased',
      'Chungi: slightly reduced max hp damage scaling',
      'Ring of Vigor: increased hp and hp regen',
      'Mercenary: decreased dmg to gold scaling by 1',
      'Just a scratch: added a 1 sec cooldown and reduced chance by 5%',
      'Martial Artist reworked: you can now equip weapons in all four slots',
      'New stat: Cooldown Reduction — shortens active-skill intervals (talents and items that activate periodically). Not rollable on normal gear; granted only by active talents and a few unique items',
      'Every active talent now grants cooldown reduction (10-25 rating by tier)',
      'Stab reworked into an active talent: stabs on a cooldown for 1 (+missing HP%) damage, paying a small amount of your own current HP each time',
      'Wand of Fire reworked: no attack of its own, ignites the enemy on a cooldown, grants cooldown reduction',
      'Flowering Staff reworked: no attack of its own, steals hp regen from the enemy on a cooldown (can push the enemy into negative regen), grants cooldown reduction and more defensive stats',
      'Magic Ring reworked: its stat growth now fires on the same active-skill cooldown (faster with cooldown reduction) instead of a fixed once-per-second aura, and it grants cooldown reduction',
      'Rogue weapons: increased base attack speed by ~10%',
      'Warlords Roar: does not scale from defense, simply reduce enemy strength by 20/40%',
      'Poison rework: healing reduction is now a flat 50% while poisoned at all, instead of scaling (and capping out) with stack count',
      'New tier 3 rogue talent: Festering Wounds — grants a free Dagger of Poison; while the enemy has 10+ poison stacks, your poison ticks twice as fast',
      'Dagger of Poison: applies one more poison stack per hit (rarity + 1)',
      'Poison duration standardized to 5s everywhere (Corroding Collection previously said 10s) — each stack deals exactly 1% max HP over its life',
      'Martial Artist: free weapon now granted once per level up, not once per shop round',
      'Starting gold to 8',
      'Pickpocket now grants 15 dodge rating, so it can actually trigger itself',
      'The Bear reworked and moved to rogue: your attacks apply 2 burn stacks to the enemy and 1 to yourself',
      'Scam reworked: grants dodge rating, and after you dodge your next scam steals health equal to your dodge rating',
      'Grand Robbery buffed: now also rerolls the shop for free and robs it a second time, and always upgrades every stolen item by a rarity',
      'Weapon Whisperer buffed: the Mythic weapon now also learns a second weapon skill',
    ]
  },
  {
    number: 22,
    name: 'Slower Better',
    changes: [
      'Martial Artist now finds a free random weapon of your tier each round (rolled like a shop item, Lucky Find included, sellable as normal)',
      'Unstoppable Force now flashes and logs on the empowered hit itself, and reports its bonus damage',
      'Guardian Angel now flashes on the saved fighter instead of the attacker',
      'Talents now report their own contribution: damage-over-time damage is credited to whoever applied the stacks, and extra attacks, saves and gold saved are tracked',
      'Weapon base attack speed reduced by ~10%',
      'Bonus attack speed granted by items reduced by ~10%',
      'All invulnerability windows reduced by ~1/3: shields, Flowering Staff, Band of Vigor, Bulwark and Guardian Angel',
      'Zealot reworked and moved to tier 2: your dodge rate is now set to 0, in exchange for +0.8% attack speed per defense (up from 0.6%)',
      'Robbery and Misconduct: stealing items reduces your income by 1',
      'Quickness replaced by Second Thoughts (tier 3): rerolling carries the most expensive unsold item into the new shop at half price, occupying a shop slot and surviving only one reroll',
      'Learn by doing replaced by Fortune\'s Fool and moved to tier 4: rerolls are free, but each reroll in a round makes you start the next fight with 5% less HP (max 25%)',
      'Draft-phase talents now flash their icon when they activate',
      'Lucky Find - Mythic bonus reduced from 3% to 2% permanent chance',
      'Item prices increased slightly (~20%) across all tiers',
      'Item skills can now roll a skill you already own - no duplicate restriction',
      'Item skills rebalanced numbers',
      'Infinite free buy from item skill bug fixed',
      'Shadowstep reworked: each dodge now heals 3% of your max HP (5% at Mythic) but permanently burns 1 dodge rate for the rest of the fight, instead of granting an undodgeable double-damage attack',
      'Liquid Assets replaced by War Chest: at fight start spend up to 10 gold (15 at Mythic) for +3 strength and +2 defense per gold spent for that fight (+4/+3 at Mythic)',
      'Shields no longer grant a flat fight-start invulnerability - every shield now rolls one of five shield-only skills (Aegis, Riposte, Shield Wall, Shield Bash, Brace), active from Common and stronger at every rarity',
      'Martial Artist buffed: each fist hit now attacks with every weapon in your inventory instead of a single random one',
      'Store Credit fixed: the free item is now once per shop phase, not once per reroll',
      'Riposte now permanently burns 1-3 of your defense per counter for the rest of the fight',
      'Unstoppable Force nerfed: empowered attacks deal 50% bonus damage instead of double damage',
      'Pickpocket (rogue collection): gold on dodge is now capped at once per second',
      'Item skills now show their live values on the item card - current stacks, bonuses, charges and cooldowns',
    ],
  },
  {
    number: 21,
    name: 'Lucky Legend',
    changes: [
      'Weapon base attack speed reduced by ~10%',
      'Rogue vol IV. replaced with Misconduct - grants one free-item claim per round (pick any item, like Comrade); all items stolen this way (Misconduct, Robbery, Grand Robbery) arrive one rarity higher and sell for 100%',
      'Accuracy now counters dodge: each point of attacker accuracy cancels 1 point of the defender\'s dodge rating (accuracy still adds to min damage roll)',
      'Legendary class items (rogue/warrior/merchant) now roll a class skill from a pool the moment they reach Legendary; upgrading to Mythic strengthens the same skill',
      'Bargain Hunter reworked: now halves the shop reroll cost (rounded down, minimum 1) instead of reducing it by 1, and no longer grants gold',
      'Ring of Immortality reverted to its transform effect: grants no bonuses while worn, but if it is still equipped when the next shop opens it is consumed and becomes a random Legendary item of your level',
    ],
  },
  {
    number: 20,
    name: 'Quick Reset',
    changes: [
      'Martial Artist - reduced fist base attack speed and damage',
      'Slightly reduce tier 5 item power',
      'Ring of Immortality reworked: now an equippable ring (no weapon damage) that grants +100% XP gained and +100% lucky find chance while equipped',
      'Zealot - remove dodge scaling, reduce defense scaling to 0.6%',
      'Scam - cooldown halved',
      'Guardigan Angel - moved to tier 4',
      'Bargain Hunter - moved to tier 3, gold grant reduced from 25 to 20',
      'Learn by doing - moved to tier 2',
      'Magic ring - slightly increased stats',
      'Gambler reworked: dice now grows in rarity as you level (up to Mythic), gaining base attack speed and damage; talent also grants scaling income',
      'Haste of Dagger - reduced dodge from 30 to 20',
      'Lucky Find - gain 3% permanent bonus when you upgrade or buy a mythic item',
      'Robbery & Grand Robbery - stolen items now sell for 100% of their price',
      'Mercenary reworked: at fight end grants 1 gold + your highest weapon hit ÷ 10 (rounded down), win or lose; tracks your all-time record hit in the talent description',
      'Increase tier 1-2 item power, slightly increase tier 3 as well',
    ],
  },
  {
    number: 19,
    name: 'Less Magical Ring',
    changes: [
      'Magic Ring base bonus stat halved, unequipping for a fight rerolls stats (you loose stacking bonuses)',
      'Small buff: Wits End',
      'Loss consolation buffed: bonus XP raised to 1.5x the gold amount, and the random item-upgrade now upgrades more items the lower your lives (3 on your last life, 2 on your second-to-last)',
      'Martial Artist reworked: fists no longer copy weapon stats — instead each fist hit unleashes an extra attack with a random weapon from your inventory, triggering that weapon\'s on-hit effects (poison, invulnerability, burn, etc.);',
      'Slightly increase tier 1-2 items power',
      'Slightly reduce tier 5 item power',
      'Ring of Immortality reworked: now an equippable ring (no weapon damage) that grants +50% XP gained and +50% lucky find chance while equipped'
    ],
  },
  {
    number: 18,
    name: 'Warrior and Rogue are stronger ;)',
    changes: [
      'Class-based level-up bonuses: every level still grants +10 max HP, plus a class bonus — Warrior +20 HP/+4 strength, Rogue +10% attack speed/+10 dodge, Merchant +2 income',
      'Removed the generic level 6+ stat scaling block (strength/accuracy/maxHp/defense/attackSpeed) — replaced by the class bonuses above',
      'XP curve reworked: early levels are unchanged or slightly faster, but reaching level 5 now requires significantly more XP (~2.3x total), making it a true late-game milestone',
      'Wall of Fame: added a season selector, defaulting to the current season',
      'Show runs ended by each character',
      'Increased rogues and warriors bonus stats on level-up',
      'Increased rolled stats on items for tier 1-4: Defense, Dodge, Attack speed by about 20%, hp regen by about 10%',
      'Renamed Merchant III. to Learn by doing and icnreased bonus xp from 2 to 3',
      'Replaced Poison talent with Wits End: Get reward when winning based on enemy class',
      'Small buff: Snitch, Burning Blood',
    ],
  },
  {
    number: 17,
    name: 'Balance is Temporary',
    changes: [
      'Max HP: characters now gain +10 max HP every level (base 100), shown on the level-up screen',
      'Magic Ring: reworked — no longer a weapon and no longer attacks; now stacks its bonus stats via a once-per-second aura during fights (removes attack-speed scaling and Dual Wield interaction)',
      'Wand of Fire: no longer grants max HP bonus stat',
      'Rogue V. replaced with Grand Robbery - steal all items from the shop',
      'Health Flask: reworked and re-enabled in the shop — flat gold price, drinking it now grants HP regen for your next fight only, instead of a permanent extra life',
      'Band of Vigor: new ring — the first time you drop below 30% HP in a fight, heal % of your max HP and become invulnerable (once per fight)',
      'Flat Damage Reduction: removed from the game — items, talents, and the end-of-fight stats no longer use it (defense/percentage reduction unchanged)',
      'Minor item changes: Chungi - increased damage, more hp+less defense bonus, Soulstealer Scythe - healing effect works for common rarity as well',
      'Minor talent changes: Snitch - cooldown reduced, Rogue III. - renamted to Poison II., poison stack increased to 2, Berserk - slightly buffed numbers, Hidden Vials - doubled poison and burn stacks'
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

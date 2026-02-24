## Project Overview

**Chungus Battles** is a real-time auto-battler / roguelike game server built with [Colyseus](https://colyseus.io/). Players alternate between a **draft phase** (buy items, equip gear, pick talents) and a **fight phase** (automated combat simulation). The server handles all game logic; the frontend connects via WebSocket rooms.

- **Language**: TypeScript (strict mode, `strictNullChecks: false`)
- **Runtime**: Node.js ≥ 16.13.0
- **Framework**: Colyseus 0.15 (real-time multiplayer game server)
- **Database**: MongoDB via Mongoose 8
- **HTTP layer**: Express (embedded in Colyseus)
- **Deployment**: fly.io (Warsaw region, port 2567)

---

## Repository Structure

```
chungus-battles-backend/
├── src/
│   ├── index.ts                    # Entry point: MongoDB connect + Colyseus listen
│   ├── app.config.ts               # Room registration + Express routes
│   ├── rooms/
│   │   ├── DraftRoom.ts            # Draft phase room (shop, inventory, talents)
│   │   ├── FightRoom.ts            # Fight phase room (combat simulation)
│   │   └── schema/
│   │       ├── DraftState.ts       # Colyseus state for draft room
│   │       └── FightState.ts       # Colyseus state for fight room
│   ├── players/
│   │   ├── db/Player.ts            # Mongoose model + DB query functions
│   │   ├── schema/PlayerSchema.ts  # Colyseus Schema class with game logic
│   │   └── types/PlayerTypes.ts    # PlayerAvatar enum
│   ├── items/
│   │   ├── db/Item.ts              # Mongoose model + DB query functions
│   │   ├── schema/ItemSchema.ts    # Colyseus Schema class
│   │   └── types/ItemTypes.ts      # ItemType, EquipSlot, ItemRarity, ItemSet enums
│   ├── talents/
│   │   ├── db/Talent.ts            # Mongoose model + DB query functions
│   │   ├── schema/TalentSchema.ts  # Colyseus Schema + executeBehavior dispatch
│   │   ├── behavior/
│   │   │   ├── TalentBehaviors.ts  # Map of TalentType → behavior function
│   │   │   └── TalentBehaviorContext.ts
│   │   └── types/TalentTypes.ts    # TalentType enum (IDs 1–503)
│   ├── commands/
│   │   ├── UpdateStatsCommand.ts   # Recalculates all player stats each tick
│   │   ├── UpdateItemRarityCommand.ts
│   │   ├── UpdateActiveSets.ts     # Detects active item set bonuses
│   │   └── triggers/               # One Command per TriggerType
│   │       ├── ActiveTriggerCommand.ts
│   │       ├── AfterShopRefreshTriggerCommand.ts
│   │       ├── DraftAuraTriggerCommand.ts
│   │       ├── FightAuraTriggerCommand.ts
│   │       ├── FightEndTriggerCommand.ts
│   │       ├── FightStartTriggerCommand.ts
│   │       ├── LevelUpTriggerCommand.ts
│   │       ├── OnAttackTriggerCommand.ts
│   │       ├── OnAttackedTriggerCommand.ts
│   │       ├── OnDamageTriggerCommand.ts
│   │       ├── OnDodgeTriggerCommand.ts
│   │       └── ShopStartTriggerCommand.ts
│   └── common/
│       ├── types.ts                # FightResultType, IStats, TriggerType enums
│       ├── MessageTypes.ts         # WS message payload types
│       ├── utils.ts                # delay(), rollTheDice()
│       ├── BehaviorContext.ts      # Context interface passed to talent behaviors
│       ├── schema/AffectedStatsSchema.ts  # Colyseus Schema for stat deltas
│       └── db/Stats.ts             # Mongoose sub-schema for stats
├── test/
│   └── room.test.ts                # Jest integration tests (requires live MongoDB)
├── scripts/
│   ├── linux/                      # DB seed/utility scripts for Linux
│   └── windows/                    # DB seed/utility scripts for Windows
├── loadtest/
│   └── example.ts                  # Colyseus load test client
├── jest.config.ts
├── tsconfig.json
├── ecosystem.config.js             # PM2 config for production
├── fly.toml                        # fly.io deployment config
└── package.json
```

---

## Development Commands

```bash
npm start          # Dev server with hot reload (tsx watch)
npm run build      # Compile TypeScript to build/ (runs clean first)
npm run clean      # Delete build/ directory
npm test           # Run Jest test suite
npm run loadtest   # Run load test against local server
```

### Environment Variables

| Variable              | Required | Description                             |
|-----------------------|----------|-----------------------------------------|
| `DB_CONNECTION_STRING` | Yes      | MongoDB connection URI                  |
| `NODE_ENV`            | No       | `production` changes starting gold to 6 |

In development, create a `.env` file or export these before running `npm start`.

### Port

The server listens on port `2567` by default (or the `PORT` env var).

---

## Architecture

### Two-Phase Game Loop

1. **DraftRoom** (`draft_room`) — Player buys items, manages inventory, equips gear, selects talents.
  - `maxClients = 1` (one player per room)
  - Simulation interval: 500ms (runs `UpdateStatsCommand`, `UpdateItemRarityCommand`, `UpdateActiveSets`)
  - Aura interval: 1000ms (runs `DraftAuraTriggerCommand`)
  - `autoDispose = false`

2. **FightRoom** (`fight_room`) — Automated combat between the player and a matched opponent from the DB.
  - `maxClients = 1`
  - Simulation interval: 100ms (stat updates + death/end-of-battle checks)
  - Combat begins 5.5 seconds after join
  - End-burn timer starts at 65 seconds (escalating AoE damage to force conclusion)
  - `autoDispose = false`

### Room Lifecycle

Both rooms follow the standard Colyseus lifecycle:
- `onCreate` → register message handlers, start clock
- `onJoin` → load player from DB, set up state
- `onLeave` → allow 20s reconnection; on final leave, save player to DB and schedule `disconnect()`
- `onDispose` → cleanup log

### Stat Calculation (UpdateStatsCommand)

Stats are **recalculated from scratch on every tick**:
1. Start from `player.baseStats` (set via `setStats`)
2. Add each equipped item's `affectedStats` (and `setBonusStats` if `setActive === true`)
3. Add each of the player's talent's `affectedStats`
4. Add each of the enemy's talent's `affectedEnemyStats` (debuffs)
5. Restore HP as `maxHp - damageTaken`

`attackSpeed` uses multiplicative scaling: `player.attackSpeed += (base * multiplier) - base`.

---

## Key Data Models

### Player Stats (`IStats` / `AffectedStats`)

| Field              | Notes                                        |
|--------------------|----------------------------------------------|
| `strength`         | Max damage roll                              |
| `accuracy`         | Min damage roll (`accuracy ≤ strength`)       |
| `defense`          | Damage reduction: `damage * (100 / (100 + defense))` |
| `flatDmgReduction` | Subtracted after percent reduction           |
| `attackSpeed`      | Attacks per second (min 0.1)                 |
| `maxHp` / `hp`     | HP capped at maxHp                           |
| `dodgeRate`        | Dodge chance: `1 - 100/(100 + dodgeRate)`    |
| `income`           | Bonus gold per round                         |
| `hpRegen`          | HP restored per second during fight          |

### Player Progression

- Start: level 1, 3 lives, 0 wins
- Max level: 5
- XP to level: `12 + level*4` (cumulative)
- Win condition: beat the current highest win record (tracked globally)
- Lose condition: `lives <= 0`
- Gold per round: `round + 3 + income`
- XP per round: `round * 2`

### Items

- **EquipSlots**: `mainHand`, `offHand`, `armor`, `helmet`
- **Rarity**: Common (1), Rare (2), Epic (3), Legendary (4) — rarity scales with player level
- **Sets**: `rogue`, `warrior`, `merchant` — equipping 2+ items of the same set activates `setBonusStats`
- Shop items are filtered by `tier ≤ player.level`
- Sell price: 70% of buy price (only unequipped items can be sold)
- Shop lock: `player.lockedShop` persists items across refresh; buying removes item from locked shop

### Talents

- **Tiers**: one per level (gained on level up, one point to spend)
- **Refresh cost**: `level * 2` gold, draws from a pool of 2 excluding already-shown talents
- **IDs 1–99**: regular talents; **IDs 101–503**: item-set collection bonuses (pattern: `CLASS_TIER`)
- Each talent carries `triggerTypes: ArraySchema<string>` — the talent fires when any listed `TriggerType` is dispatched

---

## Trigger & Command System

### Commands

All game logic mutations go through Colyseus `Command` objects dispatched via `this.dispatcher`:

```typescript
this.dispatcher.dispatch(new SomeTriggerCommand(), { optionalPayload });
```

Commands access room state via `this.state` and the room clock via `this.clock`.

### Trigger Flow

Each trigger command:
1. Filters relevant `TriggerType` talents from `player.talents` (and optionally `enemy.talents`)
2. Builds a `BehaviorContext`
3. Calls `talent.executeBehavior(context)` which looks up `TalentBehaviors[talentId]`

```typescript
// BehaviorContext shape
{
  client: Client,           // WebSocket client for sending messages
  attacker?: Player,
  defender?: Player,
  clock?: ClockTimer,
  damage?: number,
  shop?: ArraySchema<Item>,
  questItems?: ArraySchema<Item>,
  commandDispatcher?: Dispatcher,
  trigger: TriggerType
}
```

### Adding a New Talent

1. Add the ID to `TalentType` enum in `src/talents/types/TalentTypes.ts`
2. Add the behavior function to `TalentBehaviors` in `src/talents/behavior/TalentBehaviors.ts`
3. Insert the talent document into MongoDB with the correct `triggerTypes` array and `affectedStats`/`affectedEnemyStats`

### Adding a New Trigger Type

1. Add to `TriggerType` enum in `src/common/types.ts`
2. Create a new `Command` in `src/commands/triggers/`
3. Dispatch it from the appropriate room at the correct game event

---

## REST API Endpoints

All served over HTTP on the same port as the WebSocket server.

| Method | Path                              | Description                              |
|--------|-----------------------------------|------------------------------------------|
| GET    | `/playerid`                       | Returns next auto-incremented player ID  |
| GET    | `/topPlayers?numberOfPlayers=N`   | Top N players by wins (deduplicated by `originalPlayerId`) |
| GET    | `/playerBuild?playerId=N`         | Full player document                     |
| GET    | `/rank?playerId=N`                | Player rank, name, and win count         |
| GET    | `/colyseus`                       | Colyseus monitor dashboard               |
| GET    | `/`                               | Colyseus playground (non-production only)|

---

## WebSocket Message Reference

### DraftRoom — Client → Server

| Message          | Payload                    | Description                        |
|------------------|----------------------------|------------------------------------|
| `buy`            | `{ itemId: number }`       | Buy item from shop                 |
| `sell`           | `{ itemId: number }`       | Sell item from inventory           |
| `equip`          | `{ itemId, slot }`         | Equip item to slot                 |
| `unequip`        | `{ itemId, slot }`         | Unequip item from slot             |
| `refresh_shop`   | —                          | Refresh shop (costs `refreshShopCost` gold) |
| `buy_xp`         | —                          | +4 XP for 4 gold                   |
| `select_talent`  | `{ talentId: number }`     | Choose a talent                    |
| `refresh_talents`| —                          | Re-roll talent options             |
| `lock-shop`      | —                          | Lock current shop items            |
| `unlock-shop`    | —                          | Unlock shop                        |

### FightRoom — Server → Client

| Message           | Payload                          | Description                      |
|-------------------|----------------------------------|----------------------------------|
| `combat_log`      | `string`                         | Human-readable battle event      |
| `damage`          | `{ playerId, damage }`           | Damage taken event               |
| `healing`         | `{ playerId, healing }`          | Healing event                    |
| `attack`          | `playerId`                       | Attack animation trigger         |
| `trigger_talent`  | `{ playerId, talentId }`         | Talent activated                 |
| `trigger_collection` | `{ playerId, collectionId }`  | Item set bonus activated         |
| `end_battle`      | `string`                         | Fight ended, continue to draft   |
| `game_over`       | `string`                         | Player won or lost the run       |
| `draft_log`       | `string`                         | Draft-phase log message          |
| `error`           | `string`                         | Operation rejected               |

---

## Database Layer

### Pattern: DB → Colyseus Schema conversion

MongoDB documents cannot be used directly as Colyseus Schema objects. Every DB query manually reconstructs the object graph using `.assign()`:

```typescript
// Standard pattern in db/ files
const raw = await playerModel.findOne(...).lean();
const player = new Player().assign(raw);
player.baseStats = new AffectedStats().assign(raw.baseStats);
// ArraySchema and MapSchema must also be rebuilt manually
```

This is required because Colyseus Schema uses prototype-based change detection that plain objects bypass.

### Player Copy Mechanism

When a player finishes a fight and leaves DraftRoom, `copyPlayer()` creates a new DB document with a fresh `playerId` (but preserving `originalPlayerId`). This snapshot is used as the opponent in future fight matchmaking. The original player document is then updated with `updatePlayer()`.

### Enemy Matchmaking

`getSameRoundPlayer(round, playerId)` logic:
- Round 1: Returns a fixed bot ("Joe") with starter stats and a weapon
- `round < 1`: Returns the player's own previous copy (for testing/replay)
- Otherwise: Random player at the same round, excluding self; falls back to `round - 1` recursively

---

## Testing

Tests live in `test/room.test.ts` and use `@colyseus/testing`.

```bash
npm test
```

**Requirements**: A live MongoDB instance reachable via `DB_CONNECTION_STRING`. Tests boot the full app and connect real room clients.

**Test timeout**: 60 seconds (configured in `jest.config.ts`).

The single existing test covers:
1. Creating a new player and joining a draft room
2. Buying an item from the shop
3. Selecting a talent

When writing new tests, follow the `colyseus.createRoom` + `colyseus.connectTo` pattern and use `await new Promise(resolve => setTimeout(resolve, N))` for async message propagation.

---

## TypeScript Conventions

- **`strictNullChecks: false`** — null checks are not enforced by the compiler; be careful with optional DB results.
- **`experimentalDecorators: true`** — required for Colyseus `@type()` decorators on Schema classes.
- **`useDefineForClassFields: false`** — required for Colyseus Schema inheritance to work correctly. Do not change this.
- All Schema properties used over WebSocket must be decorated with `@type(...)`.
- Properties not decorated (e.g., `attackTimer`, `poisonTimer`) are server-only and not synced to clients.
- Getters/setters on Schema classes (e.g., `hp`, `gold`, `level`) enforce min/max clamping — always use the property, never `_hp` directly.

---

## Deployment

### fly.io

```bash
fly deploy   # Deploy to fly.io (Warsaw region)
```

Config in `fly.toml`:
- Internal port: 2567
- 1 CPU, 1 GB RAM
- Auto-start/stop machines enabled

### Production Build

```bash
npm run build     # Outputs to build/
npm run start-prod # Runs build/index.js directly
```

PM2 config in `ecosystem.config.js` runs `build/index.js` with one process per CPU core in fork mode.

---

## Common Gotchas

1. **MapSchema change detection**: After mutating an object stored in a `MapSchema`, you must re-set it to trigger Colyseus change detection:
   ```typescript
   // ALWAYS re-set after mutating
   attacker.equippedItems.set(EquipSlot.MAIN_HAND, item);
   ```

2. **`attackSpeed` is multiplicative**: The `increaseStats` function treats `attackSpeed` as a multiplier relative to `baseStats.attackSpeed`. An `affectedStats.attackSpeed` of `1.5` means +50% of base speed, not +1.5 flat.

3. **`AffectedStats.attackSpeed` default is `1`** (not `0`): This is intentional — a value of `1` means "no change". Check for `!== 0` before applying.

4. **`strictNullChecks: false`**: DB functions like `getPlayer()` return `null` when not found. Always check the return value before use.

5. **New players in production** start with 6 gold; in development they start with 1000 gold (controlled by `NODE_ENV`).

6. **Talent `affectedStats` are persistent across fights** for aura/accumulating talents (e.g., `RAGE`, `ASSASSIN_AMUSEMENT`). These are reset on `FIGHT_END` trigger. When designing talents that accumulate, add a reset case to `TalentBehaviors` for `TriggerType.FIGHT_END`.

7. **`copyPlayer`** is called in `DraftRoom.onLeave`, not `FightRoom.onLeave`. The fight room only calls `updatePlayer`. The draft room creates the persistent snapshot after each round.

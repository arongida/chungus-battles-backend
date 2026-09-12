import mongoose, {Schema, PipelineStage} from 'mongoose';
import {Player} from '../schema/PlayerSchema';
import {Item} from '../../items/schema/ItemSchema';
import {getItemById, ItemSchema, nextItemUid} from "../../items/db/Item";
import {TalentSchema} from "../../talents/db/Talent";
import {Talent} from "../../talents/schema/TalentSchema";
import {ArraySchema, MapSchema} from "@colyseus/schema";
import {StatsSchema} from "../../common/db/Stats";
import {affectedStatsFromRaw} from "../../common/schema/AffectedStatsSchema";
import {EquipSlot} from '../../items/types/ItemTypes';
import {rollItemStats} from "../../items/stats/itemStatRoller";
import {ensurePotionEffect, ensureShieldSkill, reconcileItemSkill, reconcileItemSkill2, refreshFutureItemSkill} from "../../items/skills/itemSkillRoller";
import {PlayerAvatar} from "../types/PlayerTypes";
import {GAME_VERSION, WINS_TO_WIN} from "../../common/types";
import {recalculatePlayerStats} from "../../common/statsUtils";
import {migrateLegacyItem, migrateLegacyTalent} from "../../common/reworkMigrations";
import {getNextSequence} from "../../common/db/Counter";


const PlayerSchema = new Schema({
    playerId: Number,
    originalPlayerId: Number,
    name: String,
    gold: {type: Number, alias: '_gold'},
    xp: Number,
    level: {type: Number, alias: '_level'},
    // Live-session claim (see claimPlayerSession/releasePlayerSession/touchPlayerSession below).
    // sessionId is the claim token (the Colyseus client.sessionId of the room that currently owns
    // this character) — set ONLY by those guarded, targeted updates, deliberately NOT part of
    // playerToPlainObject (see that function's comment), so a whole-document updatePlayer() from
    // any room — including a rejected join or an abandoned/zombie room — can never clobber a live
    // claim. sessionHeartbeatAt is what makes the claim safe: it's refreshed every
    // SESSION_HEARTBEAT_INTERVAL_MS by the owning room (BaseRoom.beginSession), and a claim whose
    // heartbeat is older than SESSION_CLAIM_TTL_MS is treated as abandoned (crashed room /
    // SIGKILLed process) and can be stolen — without this, a hard crash would soft-lock the
    // character forever, exactly as happened to a number of pre-existing characters before this
    // field existed. sessionRoomId/sessionPhase are diagnostics plus let getRunSummaries tell the
    // frontend which room type currently holds a busy run.
    sessionId: String,
    sessionClaimedAt: Date,
    sessionHeartbeatAt: Date,
    sessionRoomId: String,
    sessionPhase: String, // 'draft' | 'fight'
    maxXp: Number,
    round: Number,
    lives: Number,
    wins: Number,
    losses: {type: Number, default: 0},
    avatarUrl: String,
    gameVersion: Number,
    talents: [TalentSchema],
    inventory: [ItemSchema],
    lockedShop: [ItemSchema],
    baseStats: StatsSchema,
    equippedItems: {type: Map, of: ItemSchema},
    // Locked-in next-fight opponent (Next-Enemy Preview). Persisted via the targeted
    // setNextFightEnemy() $set only — deliberately NOT part of playerToPlainObject/
    // snapshotPlayer so matchmaking snapshots never carry a stale enemy pointer.
    nextFightEnemyId: Number,
    nextFightEnemyRound: Number,
    // Recently fought opponents (originalPlayerIds, oldest → newest, capped at
    // RECENT_OPPONENT_MEMORY). Written only by setNextFightEnemy's targeted $push/$slice —
    // deliberately NOT part of playerToPlainObject/snapshotPlayer, so a matchmaking snapshot
    // never carries the original character's fight history.
    recentOpponentIds: {type: [Number], default: []},
    // Health Flask brews banked in the draft for the wearer's next fight only — one skillId per
    // flask drunk (see PlayerSchema.pendingPotionEffects). Replaces the old flat pendingRegenBuff
    // field (removed — Mongoose documents aren't order-sensitive like the Colyseus wire schema).
    pendingPotionEffects: {type: [Number], default: []},
    pendingPotionSummary: {type: String, default: ''},
    // Permanent Lucky Find snowball bonus (see PlayerSchema.luckyFindMythicBonus) — persisted
    // normally, unlike pendingRegenBuff it is NOT reset in copyPlayer since it only affects the
    // owner's own future shop rolls, never an opponent-bot snapshot's fight stats.
    luckyFindMythicBonus: {type: Number, default: 0},
    // Fortune's Fool (talent 403): reroll count for the current shop phase. Unlike most derived
    // combat stats (dodgeRate, maxHp, ...) which are deliberately left out of this schema because
    // they're recomputed from scratch every tick, this one has to survive the DraftRoom → DB →
    // FightRoom round trip (FightRoom.onJoin's getPlayer) so FIGHT_START can still read it.
    rerollsThisRound: {type: Number, default: 0},
    // "Runs ended" leaderboard stat: how many other characters' final loss this character
    // delivered. Mutated ONLY via incrementRunsEnded's targeted $inc on the killer's original
    // doc — deliberately excluded from playerToPlainObject so a concurrent live save from the
    // killer's own session can never clobber it.
    runsEnded: {type: Number, default: 0},
    // This character's nemesis — the enemy that dealt their final game-over hit. Set once in
    // FightRoom.handleLoose, persisted normally via playerToPlainObject/updatePlayer.
    killedByPlayerId: Number,
    killedByOriginalPlayerId: Number,
    killedByName: String,
    // Bot-played characters (src/bot/) — set once at creation and carried through every
    // copyPlayer() snapshot via playerToPlainObject below, so a matchmaking opponent's origin is
    // always knowable. Bots stay on leaderboards/Wall of Fame (visible, not hidden) — this flag
    // exists purely so bot-vs-human data can be told apart in analysis, not to exclude bots.
    isBot: {type: Boolean, default: false},
});

// Backs the wall-of-fame aggregation sorts ({$sort: {wins:-1, originalPlayerId:-1, playerId:1}})
// so they run index-backed instead of blocking-sorting the whole collection in memory.
PlayerSchema.index({ wins: -1, originalPlayerId: -1, playerId: 1 });
// Backs the "All Characters" leaderboard recency sort ({$sort: {playerId:-1}}) and getNextPlayerId's
// findOne().sort({playerId:-1}) — without it those blocking-sort the whole collection and exceed the 32MB sort limit.
PlayerSchema.index({ playerId: -1 });
// Backs matchmaking's candidate scan in getSameRoundPlayer — the {playerId, originalPlayerId}
// projection is fully covered by this index, so the per-round pool is read straight from the
// index instead of scanning and materializing every player document in the collection.
PlayerSchema.index({ round: 1, gameVersion: 1, originalPlayerId: 1, playerId: 1 });
// Backs getLeaderboard's per-user rank lookup ({$match:{originalPlayerId}}, sorted by playerId)
// — previously had no supporting index (none of the above start with originalPlayerId), so every
// post-fight leaderboard fetch (the game's single highest-frequency /leaderboard call pattern —
// see end.component.ts, which always passes rankForOriginalPlayerId) full-scanned the collection.
PlayerSchema.index({ originalPlayerId: 1, playerId: -1 });

export const playerModel = mongoose.model('Player', PlayerSchema);

export async function getPlayer(playerId: number): Promise<Player> {
    const playerSchema = await playerModel.findOne({playerId: playerId}).lean().select({_id: 0, __v: 0});

    return playerSchema ? getPlayerSchemaObject(playerSchema) : null;
}

function buildItemSchema(itemFromDb: any): Item {
    // skillAffectedStats/skillAffectedEnemyStats excluded for the same reason as Item.ts's
    // getItemSchemaObject: they're pure runtime aura output (ItemSchema.ts), and leaving them in
    // `primitives` would let a stale plain-object snapshot clobber the Item constructor's real
    // AffectedStats instance via .assign().
    // futureSkillName/Description excluded — always re-derived from futureSkillId against the
    // current ITEM_SKILLS table (see items/db/Item.ts's getItemSchemaObject and
    // itemSkillRoller.ts's refreshFutureItemSkill). futureSkillId itself IS kept in `primitives`
    // — it's the latch that makes an owned item's Legendary-skill preview a promise instead of a
    // re-rolled guess, so it must survive the DB round-trip like skillId does.
    // uid excluded from `primitives` (like _id/__v) — a loaded item always gets a fresh
    // process-lifetime uid rather than trusting whatever (if anything) was saved, same reasoning
    // as items/db/Item.ts's getItemSchemaObject.
    const { affectedStats, affectedEnemyStats, skillAffectedStats, skillAffectedEnemyStats, skillAffectedStats2, skillAffectedEnemyStats2, futureSkillName, futureSkillDescription, tags, equipOptions, itemCollections, triggerTypes, uid, _id, __v, ...primitives } = itemFromDb;
    const item = new Item().assign(primitives);
    item.uid = nextItemUid();
    if (!item.sellPrice) item.sellPrice = Math.floor(item.price * item.rarity * 0.7);
    item.affectedStats = affectedStatsFromRaw(affectedStats);
    item.affectedEnemyStats = affectedStatsFromRaw(affectedEnemyStats);
    item.skillAffectedStats = affectedStatsFromRaw(undefined);
    item.skillAffectedEnemyStats = affectedStatsFromRaw(undefined);
    // Weapon Whisperer's second skill slot — same treatment as slot 1.
    item.skillAffectedStats2 = affectedStatsFromRaw(undefined);
    item.skillAffectedEnemyStats2 = affectedStatsFromRaw(undefined);
    const tagsArr = new ArraySchema<string>();
    if (tags?.length) (tags as string[]).forEach(t => tagsArr.push(t));
    item.tags = tagsArr;
    const equipOptionsArr = new ArraySchema<string>();
    let equipOptionsList: string[] = [];
    if (typeof equipOptions === 'string') {
        try { equipOptionsList = JSON.parse(equipOptions); } catch {}
    } else if (Array.isArray(equipOptions)) {
        equipOptionsList = equipOptions;
    }
    equipOptionsList.forEach(e => equipOptionsArr.push(e));
    (item as any).equipOptions = equipOptionsArr;
    const itemCollectionsArr = new ArraySchema<number>();
    if (itemCollections?.length) (itemCollections as number[]).forEach(c => itemCollectionsArr.push(c));
    (item as any).itemCollections = itemCollectionsArr;
    const triggerTypesArr = new ArraySchema<string>();
    if (triggerTypes?.length) (triggerTypes as string[]).forEach(t => triggerTypesArr.push(t));
    item.triggerTypes = triggerTypesArr;

    // Re-sync skillName/skillDescription/triggerTypes against the current ITEM_SKILLS table —
    // this is what makes an already-granted skill (equipped, inventory, locked shop) pick up a
    // rebalance/rename instead of keeping whatever text/triggers were live when it was granted.
    reconcileItemSkill(item);
    reconcileItemSkill2(item);
    // Cooldown-reduction rework (Season 24): converts an old embedded Wand of Fire/Flowering
    // Staff/Magic Ring copy to its new active-skill shape — see common/reworkMigrations.ts.
    migrateLegacyItem(item);

    return item;
}

// Exported so out-of-room code (TournamentFightRoom) can turn a stored/frozen player snapshot
// into a fighting Player with no DB round trip — the same pure conversion getPlayer() itself
// wraps around a live findOne(). See snapshotPlayer() below: its output round-trips through here.
export function getPlayerSchemaObject(playerFromDb: any): Player {
    const { baseStats, equippedItems, talents, inventory, lockedShop, pendingPotionEffects, ...primitives } = playerFromDb;

    const newPlayerSchemaObject = new Player().assign(primitives);
    newPlayerSchemaObject.baseStats = affectedStatsFromRaw(baseStats);

    // Rebuilt manually rather than left in `primitives` — same "ArraySchema must be rebuilt
    // manually" reasoning as talents/inventory/lockedShop below (see CLAUDE.md's DB->Schema
    // pattern), even though this is a plain-number array rather than a Schema-object array.
    const newPlayerPendingPotionEffectsArraySchema = new ArraySchema<number>();
    (pendingPotionEffects || []).forEach((skillId: number) => newPlayerPendingPotionEffectsArraySchema.push(skillId));
    newPlayerSchemaObject.pendingPotionEffects = newPlayerPendingPotionEffectsArraySchema;

    const newPlayerEquippedItemsMapSchema = new MapSchema();
    if (equippedItems) {
        const entries = equippedItems instanceof Map ? equippedItems.entries() : Object.entries(equippedItems);
        for (const [key, rawItem] of entries) {
            newPlayerEquippedItemsMapSchema.set(key, buildItemSchema(rawItem as any));
        }
    }
    newPlayerSchemaObject.equippedItems = newPlayerEquippedItemsMapSchema;

    const newPlayerTalentArraySchema = new ArraySchema();
    (talents || []).forEach((talent: any) => {
        const { affectedStats: tAs, affectedEnemyStats: tAes, ...talentPrimitives } = talent;
        const talentSchemaObject = new Talent().assign(talentPrimitives);
        talentSchemaObject.affectedStats = affectedStatsFromRaw(tAs);
        talentSchemaObject.affectedEnemyStats = affectedStatsFromRaw(tAes);
        // Cooldown-reduction rework (Season 24): converts an old embedded Stab copy (and
        // backfills cooldownReduction on any other pre-rework active talent) — see
        // common/reworkMigrations.ts.
        migrateLegacyTalent(talentSchemaObject);
        newPlayerTalentArraySchema.push(talentSchemaObject);
    });
    newPlayerSchemaObject.talents = newPlayerTalentArraySchema;

    const newPlayerInventoryArraySchema = new ArraySchema();
    (inventory || []).forEach((item: any) => {
        newPlayerInventoryArraySchema.push(buildItemSchema(item));
    });
    newPlayerSchemaObject.inventory = newPlayerInventoryArraySchema;

    const newPlayerLockedShopArraySchema = new ArraySchema();
    (lockedShop || []).forEach((item: any) => {
        newPlayerLockedShopArraySchema.push(buildItemSchema(item));
    });
    newPlayerSchemaObject.lockedShop = newPlayerLockedShopArraySchema;

    // Back-fill: shields saved before item skills existed (or a shield granted outside the
    // normal shop-roll path) get their skill on load, same as reconcileItemSkill re-syncs an
    // already-skilled item's display text above (buildItemSchema). Covers every shield this
    // player object can carry — equipped, inventory and locked shop.
    newPlayerSchemaObject.equippedItems.forEach((item) => ensureShieldSkill(item, newPlayerSchemaObject));
    newPlayerSchemaObject.inventory.forEach((item) => ensureShieldSkill(item, newPlayerSchemaObject));
    newPlayerSchemaObject.lockedShop.forEach((item) => ensureShieldSkill(item, newPlayerSchemaObject));

    // Health Flask brews — same load-time back-fill as ensureShieldSkill above, for a flask
    // saved before this rework (or otherwise granted with no skillId yet). Never equippedItems:
    // potions are consumed straight out of inventory (DraftRoom.drinkItem) and can never be
    // equipped.
    newPlayerSchemaObject.inventory.forEach((item) => ensurePotionEffect(item, newPlayerSchemaObject));
    newPlayerSchemaObject.lockedShop.forEach((item) => ensurePotionEffect(item, newPlayerSchemaObject));

    // Legendary skill preview (item.futureSkill*) — same load-time sweep as ensureShieldSkill above.
    newPlayerSchemaObject.equippedItems.forEach((item) => refreshFutureItemSkill(item, newPlayerSchemaObject));
    newPlayerSchemaObject.inventory.forEach((item) => refreshFutureItemSkill(item, newPlayerSchemaObject));
    newPlayerSchemaObject.lockedShop.forEach((item) => refreshFutureItemSkill(item, newPlayerSchemaObject));

    return newPlayerSchemaObject;
}

function getNewPlayer(playerId: number,
                      name: string,
                      sessionId: string,
                      avatarUrl: string,
                      startingGold: number,
                      roomId: string,
                      isBot = false) {
    const startingLevel = avatarUrl === PlayerAvatar.THIEF ? 2 : 1;
    const now = new Date();
    return new playerModel({
        playerId: playerId,
        originalPlayerId: playerId,
        name: name,
        gold: startingGold,
        isBot: isBot,
        xp: 0,
        level: startingLevel,
        sessionId: sessionId,
        // Stamped at insert for the same reason claimPlayerSession stamps them: without a
        // heartbeat, a brand-new character's claim would have no expiry, and a crash before the
        // first onLeave would lock it permanently.
        sessionClaimedAt: now,
        sessionHeartbeatAt: now,
        sessionRoomId: roomId,
        sessionPhase: 'draft',
        maxXp: avatarUrl === PlayerAvatar.THIEF ? 15 : 10,
        round: 1,
        lives: avatarUrl === PlayerAvatar.WARRIOR ? 5 : 4,
        wins: 0,
        losses: 0,
        avatarUrl: avatarUrl,
        gameVersion: GAME_VERSION,
        talents: [],
        inventory: [],
        activeItemCollections: [],
        equippedItems: {},
        baseStats: {
            strength: 5,
            accuracy: 2,
            // +20 max HP per level, matching DraftRoom.levelUp (Season 17, doubled Season 25)
            maxHp: 200 + (startingLevel - 1) * 20,
            defense: 0,
            // Thief starts at level 2, so it must already have its free level's class bonus baked in (Season 18)
            attackSpeed: avatarUrl === PlayerAvatar.THIEF ? 1.2 : 1,
            dodgeRate: avatarUrl === PlayerAvatar.THIEF ? 10 : 0,
            income: avatarUrl === PlayerAvatar.MERCHANT ? 7 : 4,
            hpRegen: 0,
            cooldownReduction: 0,
        }
    });
}

function getDefaultWeaponId(avatarUrl: string): number {
    if (avatarUrl === PlayerAvatar.WARRIOR) return 1;
    if (avatarUrl === PlayerAvatar.THIEF) return 2;
    return 68;
}

export async function createNewPlayer(
    playerId: number,
    name: string,
    sessionId: string,
    avatarUrl: string,
    roomId: string,
    // Additive, both optional — every existing 5-arg call site (DraftRoom.onJoin) is unchanged.
    // `startingGold` lets src/bot/BotRunner.ts force the production value (8) even when running
    // against a dev server (whose default is 1000 — see the NODE_ENV branch below), since a bot
    // with 1000 starting gold buys out the entire shop every round and produces useless telemetry.
    opts?: { isBot?: boolean; startingGold?: number }
): Promise<Player> {
    const startingGold = opts?.startingGold ?? (process.env.NODE_ENV === 'production' ? 8 : 1000);
    const newPlayer = getNewPlayer(playerId, name, sessionId, avatarUrl, startingGold, roomId, opts?.isBot ?? false);
    await newPlayer.save().catch((err) => console.error(err));
    const playerSchema = getPlayerSchemaObject(newPlayer.toObject());
    const defaultWeapon = await getItemById(getDefaultWeaponId(avatarUrl));
    if (defaultWeapon) {
        rollItemStats(defaultWeapon);
        playerSchema.inventory.push(defaultWeapon);
        playerSchema.setItemEquipped(defaultWeapon, EquipSlot.MAIN_HAND);
        if (defaultWeapon.itemId === 68) playerSchema.gold += 3;
        await updatePlayer(playerSchema);
    } else {
        console.warn(`Default weapon for avatar ${avatarUrl} not found in DB`);
    }
    return playerSchema;
}

export async function copyPlayer(player: Player): Promise<Player> {
    const newPlayerObject = {
        ...playerToPlainObject(player),
        playerId: await getNextPlayerId(),
        // This snapshot is only ever read back as a future opponent bot — it never plays through
        // its own FightRoom.handleFightEnd, so a banked Health Flask brew would otherwise leak in
        // permanently and grant its effect every time this snapshot is drawn as an enemy.
        pendingPotionEffects: [] as number[],
        pendingPotionSummary: '',
    };

    const newPlayer = new playerModel(newPlayerObject);
    await newPlayer.save().catch((err) => console.error(err));
    return getPlayerSchemaObject(newPlayer.toObject());
}

/** @param expectSessionId When provided, the write only lands if the character's live session
 *  claim still belongs to this session (see claimPlayerSession below). A zombie room — e.g. a
 *  FightRoom left running headless after a back-button/reload exploit, or one whose claim was
 *  TTL-stolen after a crash — can therefore never clobber the current owner's progress with its
 *  own stale snapshot. Callers that legitimately hold no claim (createNewPlayer's post-insert
 *  save) omit it. Note this narrows the race window to the save itself rather than eliminating
 *  it (findOne + save is still read-modify-write) — full optimistic concurrency is a follow-up. */
export async function updatePlayer(player: Player, expectSessionId?: string): Promise<Player> {
    const playerObject = playerToPlainObject(player);

    const filter: Record<string, any> = {playerId: player.playerId};
    if (expectSessionId !== undefined) filter.sessionId = expectSessionId;

    const foundPlayerModel = await playerModel.findOne(filter);
    if (!foundPlayerModel) {
        if (expectSessionId !== undefined) {
            console.warn(`[updatePlayer] skipped stale write for playerId=${player.playerId} — session no longer owns this character`);
        }
        return player;
    }
    foundPlayerModel.set(playerObject);

    await foundPlayerModel.save().catch((err) => console.error(err));
    return player;
}

export const SESSION_HEARTBEAT_INTERVAL_MS = 20_000;
// 40s is the worst-case legitimate gap between heartbeats: FightRoom scales clock deltaTime by
// state.timeScale, so at the minimum allowed 0.5x fight speed a 20s clock interval fires every
// 40s of wall time. 120s leaves 3 missed beats of slack for event-loop stalls/slow Mongo
// round-trips, and is well above the ~35s (30s allowReconnection + 5s onLeave disconnect delay)
// teardown window, so a room mid-teardown is never robbed of its claim. It's also exactly how
// long a character stays locked out after a hard crash with no clean onLeave — a "try again
// shortly" experience rather than the permanent lockout every crashed-mid-creation character
// suffered before this field existed.
export const SESSION_CLAIM_TTL_MS = 120_000;

export type SessionClaimResult = 'claimed' | 'busy' | 'not-found';

/**
 * Atomic compare-and-set claim of a character's live session — a single updateOne, so MongoDB
 * serializes concurrent callers under the document write lock; two callers can never both match.
 *
 * The claim is granted when ANY of these hold:
 *   - sessionId is '' / null / missing        -> the character is free
 *   - sessionId === this same sessionId       -> idempotent re-claim (retries, edge cases)
 *   - sessionHeartbeatAt is missing or stale  -> the previous owner crashed, or the document
 *                                                predates this feature entirely
 */
export async function claimPlayerSession(
    playerId: number,
    sessionId: string,
    roomId: string,
    phase: 'draft' | 'fight',
): Promise<SessionClaimResult> {
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - SESSION_CLAIM_TTL_MS);

    const res = await playerModel.updateOne(
        {
            playerId,
            $or: [
                // $in with null also matches a missing field, so this one clause covers ''/null/absent.
                {sessionId: {$in: ['', null]}},
                {sessionId},
                // $not matches missing/null too — "no heartbeat at all, or an old one".
                {sessionHeartbeatAt: {$not: {$gte: staleCutoff}}},
            ],
        },
        {
            $set: {
                sessionId,
                sessionRoomId: roomId,
                sessionPhase: phase,
                sessionClaimedAt: now,
                sessionHeartbeatAt: now,
            },
        },
    );

    if (res.matchedCount === 1) return 'claimed';
    // Only on the (rare) failure path do we pay a second round-trip to distinguish
    // "someone else holds it" from "this character doesn't exist yet".
    const exists = await playerModel.exists({playerId});
    return exists ? 'busy' : 'not-found';
}

/** Bounded retry, only on 'busy' — absorbs the legitimate hand-off race in the normal
 *  shop -> fight -> shop loop: the outgoing room's onLeave (save + release) can take a few
 *  hundred ms, and the incoming room's onJoin already burned its own 1s delay(1000) before
 *  getting here. A genuinely live session never releases, so every retry still fails and a real
 *  duplicate join is still rejected — just ~2s later. */
export async function claimPlayerSessionWithRetry(
    playerId: number,
    sessionId: string,
    roomId: string,
    phase: 'draft' | 'fight',
    attempts = 8,
    delayMs = 250,
): Promise<SessionClaimResult> {
    for (let i = 0; ; i++) {
        const result = await claimPlayerSession(playerId, sessionId, roomId, phase);
        if (result !== 'busy' || i >= attempts - 1) return result;
        await new Promise((r) => setTimeout(r, delayMs));
    }
}

/** Keeps a live claim from going stale. Guarded on sessionId so a room whose claim was already
 *  stolen (post-crash TTL takeover, followed by the "crashed" process turning out to still be
 *  alive) cannot resurrect it. Returns false when the claim is no longer ours. */
export async function touchPlayerSession(playerId: number, sessionId: string): Promise<boolean> {
    const res = await playerModel.updateOne(
        {playerId, sessionId},
        {$set: {sessionHeartbeatAt: new Date()}},
    );
    return res.matchedCount === 1;
}

/** Releases a claim — guarded on sessionId, so a rejected join or a zombie room can only ever
 *  release ITS OWN claim, never the live holder's. Returns false if it wasn't ours to release. */
export async function releasePlayerSession(playerId: number, sessionId: string): Promise<boolean> {
    const res = await playerModel.updateOne(
        {playerId, sessionId},
        {
            $set: {sessionId: ''},
            $unset: {sessionClaimedAt: '', sessionHeartbeatAt: '', sessionRoomId: '', sessionPhase: ''},
        },
    );
    return res.matchedCount === 1;
}

/** Every session claim in the DB is stale the instant this process starts: this deployment is
 *  single-process (no Redis/shared presence — see claimPlayerSession above), so a fresh process
 *  has zero rooms by definition, and nothing it does could legitimately still hold one of these
 *  claims. Called once from app.config.ts's beforeListen, which runs before the server accepts
 *  any connection, so there's no race with a real join claiming first. This is what makes "in
 *  progress elsewhere" recover in seconds after a deploy/crash instead of waiting out
 *  SESSION_CLAIM_TTL_MS.
 *
 *  SAFETY: this is only correct because the deployment is single-process. If this ever became
 *  horizontally scaled (multiple machines/processes sharing this Mongo), an unconditional sweep
 *  on one process's boot could steal a claim a sibling process still genuinely holds — at that
 *  point this must be replaced with something process-aware (e.g. only clearing claims whose
 *  sessionRoomId isn't known to any live process).
 *
 *  @param extraFilter Narrows which documents are affected, ANDed with the sessionId filter —
 *  production (app.config.ts's beforeListen) always calls this with no argument, meaning "every
 *  claim, no exceptions." It exists purely so tests can scope a call to their own seeded
 *  documents instead of exercising the genuinely-global default against a shared database. */
export async function clearAllSessionClaims(extraFilter: Record<string, any> = {}): Promise<number> {
    const res = await playerModel.updateMany(
        {...extraFilter, sessionId: {$nin: ['', null]}},
        {
            $set: {sessionId: ''},
            $unset: {sessionClaimedAt: '', sessionHeartbeatAt: '', sessionRoomId: '', sessionPhase: ''},
        },
    );
    return res.modifiedCount;
}

/** Writes the run-ending win straight to the character's live document so the Wall of Fame
 *  reflects it before the client can navigate to /end. Deliberately a targeted $set (not
 *  updatePlayer) — FightRoom.handleWin runs mid-handleFightEnd, before the round's gold/xp/income
 *  block and FightEndTriggerCommand, so a whole-document write here would persist a half-finished
 *  round. onLeave's updatePlayer still writes the complete final state afterwards. */
export async function persistGameWin(player: Player): Promise<void> {
    await playerModel.updateOne(
        {playerId: player.playerId},
        {$set: {wins: player.wins, losses: player.losses, lives: player.lives}},
    ).catch(err => console.error('[persistGameWin]', err));
    invalidateRankedListCache();
}

// Credits the killer's canonical (original) document. runsEnded lives ONLY here + is read via
// $max in the leaderboard aggregation; it is deliberately never written through
// playerToPlainObject, so a concurrent updatePlayer() from the killer's own live session can't
// clobber this increment.
export async function incrementRunsEnded(killerOriginalPlayerId: number): Promise<void> {
    if (killerOriginalPlayerId === undefined || killerOriginalPlayerId === null) return;
    if (killerOriginalPlayerId === JOE_PLAYER_ID) return; // round-1 bot isn't persisted
    await playerModel.updateOne({playerId: killerOriginalPlayerId}, {$inc: {runsEnded: 1}})
        .catch(err => console.error('[incrementRunsEnded]', err));
}

export async function getNextPlayerId(): Promise<number> {
    // Atomic ($inc via findOneAndUpdate) — the previous read-then-return-plus-one had no write
    // component at all, so two concurrent callers (two /playerid requests, or two overlapping
    // copyPlayer() snapshot inserts on round transitions) could return the same id. Seeded from
    // the historical max(playerId) on first use so it picks up exactly where that scheme left off.
    return getNextSequence('playerId', async () => {
        const lastPlayer = await playerModel.findOne().sort({playerId: -1}).limit(1).lean();
        return lastPlayer?.playerId ?? 0;
    });
}

function cleanRawObj(obj: any): Record<string, any> {
    if (!obj) return {};
    const { _id, __v, ...rest } = obj;
    return rest;
}

function cleanRawItem(item: any): Record<string, any> | null {
    if (!item) return null;
    const { _id, __v, affectedStats, affectedEnemyStats, ...rest } = item;
    return {
        ...rest,
        affectedStats: cleanRawObj(affectedStats),
        affectedEnemyStats: cleanRawObj(affectedEnemyStats),
    };
}

function cleanRawTalent(talent: any): Record<string, any> | null {
    if (!talent) return null;
    const { _id, __v, affectedStats, affectedEnemyStats, ...rest } = talent;
    return {
        ...rest,
        affectedStats: cleanRawObj(affectedStats),
        affectedEnemyStats: cleanRawObj(affectedEnemyStats),
    };
}

function cleanRawPlayerDoc(doc: any): Record<string, any> {
    const { _id, __v, latestPlayerId, equippedItems, inventory, talents, lockedShop, baseStats, ...rest } = doc;
    const cleanEquippedItems: Record<string, any> = {};
    if (equippedItems) {
        for (const [slot, item] of Object.entries(equippedItems)) {
            cleanEquippedItems[slot] = cleanRawItem(item as any);
        }
    }
    return {
        ...rest,
        baseStats: cleanRawObj(baseStats),
        equippedItems: cleanEquippedItems,
        inventory: (inventory || []).map(cleanRawItem),
        talents: (talents || []).map(cleanRawTalent),
        lockedShop: (lockedShop || []).map(cleanRawItem),
    };
}

// NOTE: sessionId is deliberately absent from the returned object below — see the
// sessionClaimedAt/sessionHeartbeatAt/sessionRoomId/sessionPhase block on PlayerSchema above. It
// is owned exclusively by claimPlayerSession/releasePlayerSession/touchPlayerSession. Including
// it here would let any whole-document updatePlayer() — including one from a rejected join or a
// zombie room — silently clear or corrupt a live claim, which is exactly the last-writer-wins
// hole that made the mid-fight save-scumming exploit possible.
export function playerToPlainObject(player: Player): Record<string, any> {
    const equippedItems: Record<string, any> = {};
    player.equippedItems.forEach((item, slot) => {
        equippedItems[slot] = item.toJSON();
    });
    return {
        playerId: player.playerId,
        originalPlayerId: player.originalPlayerId,
        name: player.name,
        gold: player.gold,
        xp: player.xp,
        level: player.level,
        maxXp: player.maxXp,
        round: player.round,
        lives: player.lives,
        wins: player.wins,
        losses: player.losses,
        avatarUrl: player.avatarUrl,
        gameVersion: player.gameVersion,
        income: player.income,
        hpRegen: player.hpRegen,
        cooldownReduction: player.cooldownReduction,
        dodgeRate: player.dodgeRate,
        refreshShopCost: player.refreshShopCost,
        maxHp: player.maxHp,
        hp: player.hp,
        strength: player.strength,
        accuracy: player.accuracy,
        defense: player.defense,
        attackSpeed: player.attackSpeed,
        pendingPotionEffects: Array.from(player.pendingPotionEffects),
        pendingPotionSummary: player.pendingPotionSummary,
        luckyFindMythicBonus: player.luckyFindMythicBonus,
        rerollsThisRound: player.rerollsThisRound,
        killedByPlayerId: player.killedByPlayerId,
        killedByOriginalPlayerId: player.killedByOriginalPlayerId,
        killedByName: player.killedByName,
        isBot: player.isBot ?? false,
        baseStats: player.baseStats?.toJSON() || {},
        equippedItems,
        inventory: player.inventory.map(item => item.toJSON()),
        talents: player.talents.map(talent => talent.toJSON()),
        lockedShop: player.lockedShop.map(item => item.toJSON()),
    };
}

export function snapshotPlayer(player: Player): Record<string, any> {
    const equippedItems: Record<string, any> = {};
    player.equippedItems.forEach((item, slot) => {
        equippedItems[slot] = item.toJSON();
    });
    return {
        playerId: player.playerId,
        originalPlayerId: player.originalPlayerId,
        name: player.name,
        avatarUrl: player.avatarUrl,
        gold: player.gold,
        level: player.level,
        xp: player.xp,
        maxXp: player.maxXp,
        round: player.round,
        lives: player.lives,
        wins: player.wins,
        losses: player.losses,
        hp: player.hp,
        maxHp: player.maxHp,
        strength: player.strength,
        accuracy: player.accuracy,
        defense: player.defense,
        attackSpeed: player.attackSpeed,
        dodgeRate: player.dodgeRate,
        hpRegen: player.hpRegen,
        cooldownReduction: player.cooldownReduction,
        income: player.income,
        refreshShopCost: player.refreshShopCost,
        gameVersion: player.gameVersion,
        isBot: player.isBot ?? false,
        baseStats: player.baseStats?.toJSON() || {},
        equippedItems,
        inventory: player.inventory.map(item => item.toJSON()),
        talents: player.talents.map(talent => talent.toJSON()),
        lockedShop: player.lockedShop.map(item => item.toJSON()),
    };
}

// The leaderboard/Wall of Fame only ever render a handful of summary fields (see
// end.component.html) — the rest of a player doc (inventory, equippedItems, talents,
// lockedShop, baseStats, ...) is multi-KB of embedded arrays that made the default
// /leaderboard page ~170KB and a limit=100 page ~890KB. The full build is available on demand
// via /playerBuild (see end.component.ts's row-expand fetch), so leaderboard rows don't need it.
const LEADERBOARD_PROJECTION = {
    playerId: 1, originalPlayerId: 1, name: 1, avatarUrl: 1, level: 1, round: 1,
    wins: 1, losses: 1, gameVersion: 1, runsEnded: 1, lastPlayedAt: 1, latestPlayerId: 1,
    isBot: 1,
} as const;

export interface RunSummary {
    playerId: number; name: string; avatarUrl: string; level: number; round: number;
    lives: number; wins: number; losses: number; gameVersion: number; busy: boolean;
    /** Which room type currently holds the claim — only meaningful when busy. */
    busyPhase?: 'draft' | 'fight';
}

// Batch fetch for the frontend's run-list (see RunSummariesService) — the same lean fields as
// LEADERBOARD_PROJECTION plus `lives` and the session-claim fields, reduced to a `busy` boolean
// (never returning sessionId itself — it's a live Colyseus session id, not something a client
// should see). `busy` is staleness-aware: a claim whose heartbeat is older than
// SESSION_CLAIM_TTL_MS is abandoned (crashed room) and must NOT be reported as busy, or every
// pre-claim-fix crash-locked character (and any post-crash document still inside the TTL window)
// would show as permanently "in progress elsewhere".
export async function getRunSummaries(playerIds: number[]): Promise<RunSummary[]> {
    if (!playerIds.length) return [];
    const docs = await playerModel.find(
        { playerId: { $in: playerIds } },
        { ...LEADERBOARD_PROJECTION, lives: 1, sessionId: 1, sessionHeartbeatAt: 1, sessionPhase: 1 },
    ).lean();
    const liveCutoff = Date.now() - SESSION_CLAIM_TTL_MS;
    return docs.map(d => {
        const busy = !!d.sessionId && !!d.sessionHeartbeatAt && d.sessionHeartbeatAt.getTime() > liveCutoff;
        return {
            playerId: d.playerId, name: d.name, avatarUrl: d.avatarUrl, level: d.level, round: d.round,
            lives: d.lives, wins: d.wins, losses: d.losses, gameVersion: d.gameVersion,
            busy, busyPhase: busy ? (d.sessionPhase as 'draft' | 'fight' | undefined) : undefined,
        };
    });
}

// Short-TTL cache for the leaderboard/Wall-of-Fame ranked lists — see cachedAggregate below.
// Keyed by a JSON fingerprint of the pipeline's own $match conditions, so every distinct filter
// combination (including a name search) gets its own cached entry rather than sharing one.
const rankedListCache = new Map<string, { docs: Record<string, any>[]; expiresAt: number }>();
const RANKED_LIST_CACHE_TTL_MS = 15_000;

/** Drops every cached ranked list. Called when a write happens that a player is expected to see
 *  reflected immediately (a run-ending win landing on the Wall of Fame) — rare enough that the
 *  cost is one re-aggregation, unlike per-round writes which should keep riding the TTL. */
export function invalidateRankedListCache(): void {
    rankedListCache.clear();
}

/** Runs `buildPipeline()`'s aggregation and caches the full result array (unpaginated — the
 *  pipeline should do its own $skip/$limit-free dedupe+sort+project) for RANKED_LIST_CACHE_TTL_MS,
 *  keyed by `cacheKey`. getLeaderboard/getWallOfFame then slice/search this in memory instead of
 *  re-querying Mongo for every page turn or per-user rank lookup — collapsing what used to be up
 *  to 3 full-collection aggregations per request (see getLeaderboard's rankForOriginalPlayerId
 *  path) into at most 1 per cacheKey per TTL window, shared across every concurrent requester.
 *  Trades up to RANKED_LIST_CACHE_TTL_MS of staleness (a just-finished run's new rank may not
 *  show up immediately) for that — acceptable for a leaderboard display. */
async function cachedRankedList(cacheKey: string, buildPipeline: () => PipelineStage[]): Promise<Record<string, any>[]> {
    const now = Date.now();
    const cached = rankedListCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.docs;

    const docs = await playerModel.aggregate(buildPipeline()).allowDiskUse(true).exec();
    rankedListCache.set(cacheKey, { docs, expiresAt: now + RANKED_LIST_CACHE_TTL_MS });
    // Self-bounding under normal traffic (one entry per distinct filter combo actually
    // requested within a TTL window) — this is just a backstop against a scripted caller
    // varying e.g. `name` on every request to grow the cache unbounded.
    if (rankedListCache.size > 500) rankedListCache.clear();

    return docs;
}

// $top instead of $sort + $first: a pre-group sort has no supporting index, and the
// prod Atlas shared tier caps in-memory sorts at 32MB and ignores allowDiskUse.
const TOP_PLAYERS_AGGREGATION: PipelineStage[] = [
    {$group: {
        _id: '$originalPlayerId',
        // each character's best/final snapshot (wins never decrease, so this is the live/original doc)
        doc: {$top: {sortBy: {wins: -1, round: -1, playerId: -1}, output: '$$ROOT'}},
        latestPlayerId: {$max: '$playerId'},
        // ObjectId embeds its creation time, and a fresh snapshot doc is written each round,
        // so the newest snapshot's _id timestamp is this character's "last played" time.
        lastPlayedAt: {$max: {$toDate: '$_id'}},
        // runsEnded is only ever incremented on the character's original doc (see
        // incrementRunsEnded), but $top above may have picked a different round's snapshot as
        // `doc` — take the max across every snapshot so the count always shows up.
        runsEnded: {$max: '$runsEnded'},
    }},
    {$addFields: {
        'doc.latestPlayerId': '$latestPlayerId',
        'doc.lastPlayedAt': '$lastPlayedAt',
        'doc.runsEnded': {$ifNull: ['$runsEnded', 0]},
    }},
    {$replaceRoot: {newRoot: '$doc'}},
    {$sort: {latestPlayerId: -1}},                             // final order: most-recently-active character first
];

export interface LeaderboardFilters {
    limit?: number;
    skip?: number;
    gameVersion?: number;
    name?: string;
    avatar?: string;
    minRound?: number;
    level?: number;
    minWins?: number;
    rankForOriginalPlayerId?: number;
    // undefined = unfiltered (default, today's behavior); true = bots only; false = humans only.
    // Humans-only must use $ne rather than an exact {isBot:false} match — every player doc that
    // predates this field has no `isBot` key at all, so an exact-false match would wrongly
    // exclude every one of them.
    isBot?: boolean;
}

function buildMatchConditions(filters: LeaderboardFilters): Record<string, any> {
    const match: Record<string, any> = {};
    if (filters.gameVersion !== undefined) match.gameVersion = filters.gameVersion;
    if (filters.name) match.name = { $regex: filters.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    if (filters.avatar) match.avatarUrl = filters.avatar;
    if (filters.minRound !== undefined) match.round = { $gte: filters.minRound };
    if (filters.level !== undefined) match.level = filters.level;
    if (filters.minWins !== undefined) match.wins = { $gte: filters.minWins };
    if (filters.isBot !== undefined) match.isBot = filters.isBot ? true : { $ne: true };
    return match;
}

export async function getLeaderboard(filters: LeaderboardFilters = {}): Promise<{ players: Record<string, any>[]; total: number; userRank: number | null }> {
    const { limit = 20, skip = 0, rankForOriginalPlayerId } = filters;
    const clampedLimit = Math.min(Math.max(1, limit), 100);

    const matchConditions = buildMatchConditions(filters);
    const matchStage = Object.keys(matchConditions).length ? [{ $match: matchConditions }] : [];

    // The full deduped, sorted (most-recently-active first — same order the old $facet.players
    // page returned) list for this exact filter combination. Cached — see cachedRankedList.
    const docs = await cachedRankedList(`leaderboard:${JSON.stringify(matchConditions)}`, () => [
        ...matchStage,
        ...TOP_PLAYERS_AGGREGATION,
        { $project: LEADERBOARD_PROJECTION },
    ]);

    let userRank: number | null = null;
    if (rankForOriginalPlayerId) {
        // docs is sorted by latestPlayerId desc with unique values (playerId is a unique,
        // monotonic sequence — see PlayerToken.ts/getNextSequence), so a character's index in
        // this array is exactly "how many characters have a strictly greater latestPlayerId",
        // i.e. the same rank the old two-extra-aggregations version computed by re-querying Mongo.
        const idx = docs.findIndex((d) => d.originalPlayerId === rankForOriginalPlayerId);
        if (idx !== -1) userRank = idx + 1;
    }

    return {
        players: docs.slice(skip, skip + clampedLimit).map(cleanRawPlayerDoc),
        total: docs.length,
        userRank,
    };
}

export async function getPlayerRank(playerId: number): Promise<number> {
    const player = await playerModel.findOne({playerId: playerId}).lean();
    const rank = await playerModel.countDocuments({wins: {$gt: player.wins}});
    return rank + 1;
}

/** "Wall of Fame": finished (12-win) characters ranked by most runs ended, most recent first.
 *  gameVersion >= 16 + losses field presence excludes pre-Season-16 record-chasing
 *  snapshots that could otherwise have wins >= WINS_TO_WIN from an old, different win condition.
 *  Pass `season` to scope the wall to one specific season (exact gameVersion match); omit it
 *  (or pass undefined) to show all seasons since Wall of Fame was introduced. */
export async function getWallOfFame({ limit = 20, skip = 0, season }: { limit?: number; skip?: number; season?: number } = {}):
    Promise<{ players: Record<string, any>[]; total: number }> {
    const clampedLimit = Math.min(Math.max(1, limit), 100);
    const gameVersionMatch = season !== undefined ? season : { $gte: 16 };

    const docs = await cachedRankedList(`wallOfFame:${JSON.stringify(gameVersionMatch)}`, () => [
        { $match: { gameVersion: gameVersionMatch, wins: { $gte: WINS_TO_WIN }, losses: { $exists: true } } },
        // Dedupe insurance: exactly one >=12-win doc per character is expected, but keep
        // the best (fewest-losses) doc per originalPlayerId in case of a double-save.
        { $sort: { losses: 1, wins: -1, playerId: 1 } },
        { $group: {
            _id: '$originalPlayerId',
            doc: { $first: '$$ROOT' },
            // Same reasoning as TOP_PLAYERS_AGGREGATION: runsEnded is only incremented on the
            // character's original doc, which may not be the $first-picked doc here.
            runsEnded: { $max: '$runsEnded' },
            // ObjectId embeds its creation time; take the max across every snapshot so
            // this reflects the character's most recent activity, not just the $first-picked doc.
            lastPlayedAt: { $max: { $toDate: '$_id' } },
        } },
        { $addFields: { 'doc.runsEnded': { $ifNull: ['$runsEnded', 0] }, 'doc.lastPlayedAt': '$lastPlayedAt' } },
        { $replaceRoot: { newRoot: '$doc' } },
        { $sort: { runsEnded: -1, lastPlayedAt: -1, originalPlayerId: -1 } },
        { $project: LEADERBOARD_PROJECTION },
    ]);

    return {
        players: docs.slice(skip, skip + clampedLimit).map(cleanRawPlayerDoc),
        total: docs.length,
    };
}

export const JOE_PLAYER_ID = 0;
// How many of the most recent opponents (by originalPlayerId) getSameRoundPlayer will avoid
// re-drawing, as long as the round's in-season pool has a fresher candidate available.
export const RECENT_OPPONENT_MEMORY = 3;

export async function buildJoe(forPlayerId: number): Promise<Player> {
    const avatarArray = Array.from(Object.values(PlayerAvatar));
    // Deterministic (not random) so the draft preview and the fight show the same portrait —
    // the live player's playerId is stable across the whole run.
    // Never persisted (no .save() call below) — roomId is irrelevant, passed empty.
    const joeModel = getNewPlayer(JOE_PLAYER_ID, 'Joe', '', avatarArray[Math.abs(forPlayerId) % 3], 10, '');
    const joe = getPlayerSchemaObject(joeModel.toObject());
    joe.baseStats.maxHp = 100;
    joe.baseStats.strength = 2;
    const weapon = await getItemById(81);
    joe.setItemEquipped(weapon, EquipSlot.MAIN_HAND);
    // Rooms recompute synced stats every tick (UpdateStatsCommand), but the draft preview is a
    // plain copy — compute Joe's final stats here (100/100 HP incl. weapon bonuses) the same way
    // the fight room later will, so preview and fight always agree.
    recalculatePlayerStats(joe);
    return joe;
}

export async function setNextFightEnemy(playerId: number, enemyId: number, round: number, enemyOriginalId?: number) {
    const update: any = { $set: { nextFightEnemyId: enemyId, nextFightEnemyRound: round } };
    // Joe (round 1) is synthetic and never persisted, so he never occupies a history slot.
    if (enemyOriginalId != null && enemyOriginalId !== JOE_PLAYER_ID) {
        update.$push = { recentOpponentIds: { $each: [enemyOriginalId], $slice: -RECENT_OPPONENT_MEMORY } };
    }
    await playerModel.updateOne({ playerId }, update);
}

interface OpponentCandidate {
    playerId: number;
    originalPlayerId: number;
}

/** Picks one snapshot playerId out of `candidates`, preferring characters not in `recentIds`.
 *  Dedupes by originalPlayerId first, so a character with several snapshots at this round isn't
 *  drawn more often than one with a single snapshot. Falls back to the LEAST recently fought
 *  character (earliest position in `recentIds`, which is stored oldest → newest) when every
 *  candidate has been fought recently. Returns null when `candidates` is empty. */
export function pickVariedOpponent(candidates: OpponentCandidate[], recentIds: number[] = []): number | null {
    if (!candidates.length) return null;

    // Dedupe by originalPlayerId, keeping one representative snapshot playerId per character.
    const byOriginal = new Map<number, number>();
    for (const c of candidates) byOriginal.set(c.originalPlayerId, c.playerId);

    const fresh = [...byOriginal.entries()].filter(([originalId]) => !recentIds.includes(originalId));
    if (fresh.length) {
        const [, playerId] = fresh[Math.floor(Math.random() * fresh.length)];
        return playerId;
    }

    // Everyone available has been fought recently — pick whoever is earliest in recentIds
    // (i.e. fought longest ago). Every candidate here is guaranteed to be in recentIds.
    let leastRecentOriginalId: number | null = null;
    let leastRecentIndex = Infinity;
    for (const originalId of byOriginal.keys()) {
        const idx = recentIds.indexOf(originalId);
        if (idx !== -1 && idx < leastRecentIndex) {
            leastRecentIndex = idx;
            leastRecentOriginalId = originalId;
        }
    }
    return leastRecentOriginalId !== null ? byOriginal.get(leastRecentOriginalId) : null;
}

export async function getSameRoundPlayer(round: number, playerId: number, recentOpponentIds: number[] = []): Promise<Player> {
    if (round < 1) {
        const defaultPlayerClone = await playerModel
            .findOne({originalPlayerId: playerId, playerId: {$ne: playerId}})
            .lean();
        return defaultPlayerClone ? getPlayerSchemaObject(defaultPlayerClone) : null;
    }

    if (round === 1) {
        return buildJoe(playerId);
    }

    const baseMatch = {round, originalPlayerId: {$ne: playerId}};
    const projection = {playerId: 1, originalPlayerId: 1, _id: 0};

    const sameVersion = await playerModel
        .find({...baseMatch, gameVersion: GAME_VERSION}, projection)
        .lean();
    let pickedId = pickVariedOpponent(sameVersion as OpponentCandidate[], recentOpponentIds);

    if (pickedId === null) {
        const anyVersion = await playerModel.find(baseMatch, projection).lean();
        pickedId = pickVariedOpponent(anyVersion as OpponentCandidate[], recentOpponentIds);
    }
    if (pickedId !== null) return getPlayer(pickedId);

    console.log('No player found for round', round, '— trying round', round - 1);
    return getSameRoundPlayer(round - 1, playerId, recentOpponentIds);
}

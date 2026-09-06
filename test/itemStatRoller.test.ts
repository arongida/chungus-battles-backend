import { Item } from '../src/items/schema/ItemSchema';
import { AffectedStats } from '../src/common/schema/AffectedStatsSchema';
import { ItemClass, ItemType } from '../src/items/types/ItemTypes';
import { getEligiblePool, RollableStat, STAT_RANGES } from '../src/items/stats/itemStatPool';
import { rollItemStats } from '../src/items/stats/itemStatRoller';

// Fixed seed makes this distribution regression reproducible, with no flaky random trials.
afterEach(() => jest.restoreAllMocks());
test.each(Object.values(ItemClass).flatMap(cls => Object.values(ItemType).map(type => [cls, type])))('%s %s rolls every eligible stat equally', (cls, type) => {
    let seed = 12345;
    jest.spyOn(Math, 'random').mockImplementation(() => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    });
    const item = new Item();
    item.itemId = 99999;
    item.class = cls;
    item.type = type;
    item.tier = 1;
    const pool = getEligiblePool(type as ItemType, cls);
    const counts = Object.fromEntries(pool.map(stat => [stat, 0]));
    const neutral = new AffectedStats();
    const trials = 12000;
    for (let i = 0; i < trials; i++) {
        rollItemStats(item);
        const rolled = (Object.keys(STAT_RANGES) as RollableStat[]).filter(stat => item.affectedStats[stat] !== neutral[stat]);
        expect(rolled).toHaveLength(1);
        expect(pool).toContain(rolled[0]);
        counts[rolled[0]]++;
    }
    for (const count of Object.values(counts)) expect(Math.abs(count / trials - 1 / pool.length)).toBeLessThan(0.02);
});

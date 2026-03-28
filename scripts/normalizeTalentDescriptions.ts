import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config();

const TalentSchema = new mongoose.Schema({
  talentId: Number,
  name: String,
  description: String,
  tier: Number,
  activationRate: Number,
  base: Number,
  scaling: Number,
  tags: [String],
  triggerTypes: [String],
});

const Talent = mongoose.model('Talent', TalentSchema);

const deletions = [
  9, // Evasion — replaced by in-game dodge stat, no longer a talent
];

const updates: { talentId: number; description: string }[] = [
  {
    talentId: 5,
    // was: "Once every 2 seconds: steal 1/level health from your enemy."
    // code: amount = attacker.level (e.g. 3 at level 3)
    description: 'Once every 2 seconds: steal health equal to your level from the enemy.',
  },
  {
    talentId: 10,
    // was: "Once every 2 seconds: restore 2 (+1/level) health."
    // "+1/level" reads as "1 divided by level" — clarify to "per level"
    description: 'Once every 2 seconds: restore 2 (+1 per level) health.',
  },
  {
    talentId: 16,
    // was: "Steal 2%/income attack speed from your opponent."
    // code: bonus = income * 0.02; player +bonus, enemy -bonus
    description: 'Gain 2% attack speed per income. Reduce enemy attack speed by the same amount.',
  },
  {
    talentId: 21,
    // was: "You consume your main hand weapon and get it's stats permanently."
    // fix grammar: "it's" -> "its"
    description: 'At fight start: consume your main hand weapon and permanently gain its stats.',
  },
  {
    talentId: 26,
    // was: "Reflect 5% defense damage to the attacker."
    // code: reflectDamage = defender.defense * 0.05
    description: 'When hit: reflect damage equal to 5% of your defense back to the attacker.',
  },
  {
    talentId: 28,
    // was: "Gain 100% of your defense as attack speed."
    // code: attackSpeed = 1 + (defense * activationRate * 0.01) = 1 + defense * 0.01
    // so 1 defense = 1% bonus attack speed
    description: 'Gain 1% bonus attack speed per defense.',
  },
  {
    talentId: 31,
    // was: "Deal 2% max HP damage on-hit."
    // code: bearDamage = attacker.maxHp * 0.02 — clarify it's YOUR max HP
    description: 'On-hit: deal bonus damage equal to 2% of your max HP.',
  },
  {
    talentId: 38,
    // was: "You can't use money anymore, but get xp faster and can get an item/shop free."
    // code: gold set to 0, xp += level*2, first (level+1) shop items free, inventory items free
    description: 'At shop start: lose all gold, gain (level × 2) XP, and make your inventory and the first (level + 1) shop items free.',
  },
  {
    talentId: 39,
    // was: "You can't equip anything in offHand but get a lucky dice to deal damage between 1-6 and your income."
    // code: unequip off-hand, deal rollTheDice(1,6) + income damage every 2s
    description: 'Cannot equip an off-hand item. Every 2 seconds: roll 1d6 and deal (result + income) damage.',
  },
  {
    talentId: 303,
    // was: "Your combat stats scale with income."
    // code: bonus = (income * scaling + base) / 100 = (income + 1)%; applied to all combat stats
    description: 'All your combat stats gain a (income + 1)% bonus.',
  },
  {
    talentId: 502,
    // was: "On attack: deal damage proportional to your gold."
    // code: damage = gold * 0.25 + 2.5
    description: 'On attack: deal 2.5 + 25% of your gold as bonus damage.',
  },
];

async function main() {
  await mongoose.connect(process.env.DB_CONNECTION_STRING!);
  console.log('Connected to dev DB\n');

  for (const id of deletions) {
    const result = await Talent.deleteOne({ talentId: id });
    console.log(`Deleted talentId=${id}: ${result.deletedCount} document(s) removed`);
  }

  console.log();

  for (const { talentId, description } of updates) {
    const result = await Talent.updateOne({ talentId }, { $set: { description } });
    if (result.matchedCount === 0) {
      console.warn(`WARNING: talentId=${talentId} not found`);
    } else {
      console.log(`Updated talentId=${talentId}: "${description}"`);
    }
  }

  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch(console.error);

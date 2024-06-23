import { Schema, type, ArraySchema } from '@colyseus/schema';
import { Talent } from './TalentSchema';
import { Item } from './ItemSchema';
import { Stats } from '../../utils/utils';

export class Player extends Schema {
  @type('number') playerId: number;
  @type('string') name: string;
  @type('number') hp: number;
  @type('number') attack: number;
  @type('number') gold: number;
  @type('number') xp: number;
  @type('number') level: number;
  @type('string') sessionId: string;
  @type('number') private _defense: number;
  @type('number') attackSpeed: number;
  @type('number') maxXp: number;
  @type('number') round: number;
  @type('number') lives: number;
  @type('number') wins: number;
  @type('string') avatarUrl: string;
  @type([Talent]) talents: ArraySchema<Talent> = new ArraySchema<Talent>();
  @type([Item]) inventory: ArraySchema<Item> = new ArraySchema<Item>();
  initialStats: Stats = { hp: 0, attack: 0, defense: 0, attackSpeed: 0 };

  get defense(): number {
    return this._defense;
  }

  set defense(value: number) {
    this._defense = value;
  }

  getNumberOfMeleeWeapons(): number {
    return this.inventory.reduce((count, item) => {
      if (item.tags.includes('weapon') && item.tags.includes('melee')) {
        return count + 1;
      }
      return count;
    }, 0);
  }

  getNumberOfWeapons(): number {
    return this.inventory.reduce((count, item) => {
      if (item.tags.includes('weapon')) {
        return count + 1;
      }
      return count;
    }, 0);
  }
}

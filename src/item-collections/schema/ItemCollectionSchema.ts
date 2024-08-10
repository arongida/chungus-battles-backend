import { Schema, type, ArraySchema } from '@colyseus/schema';

export class ItemCollection extends Schema {
  @type('number') itemCollectionId: number;
  @type('string') name: string;
  @type('string') requirements: string;
  @type('string') effect: string;
  @type('string') image: string;
  @type(['string']) tags: ArraySchema<string>;
}

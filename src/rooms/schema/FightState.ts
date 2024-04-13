import { Schema, Context, type } from "@colyseus/schema";

export class FightState extends Schema {

  @type("string") mySynchronizedProperty: string = "Hello world";

}

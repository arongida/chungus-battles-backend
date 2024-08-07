// TalentBehaviorContext.ts
import { Client } from 'colyseus';
import { Player } from '../PlayerSchema'; 
import ClockTimer from '@gamestdio/timer';
import { Talent } from './TalentSchema';

export interface TalentBehaviorContext {
  client: Client;
  talent?: Talent;
  clock?: ClockTimer;
  attacker?: Player;
  defender?: Player; 
  damage?: number;
}
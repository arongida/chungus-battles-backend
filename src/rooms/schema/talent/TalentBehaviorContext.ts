// TalentBehaviorContext.ts
import { Client } from 'colyseus';
import { Player } from '../PlayerSchema'; 
import ClockTimer from '@gamestdio/timer';

export interface TalentBehaviorContext {
  client: Client;
  clock?: ClockTimer;
  attacker?: Player;
  defender?: Player; 
  damage?: number;
}
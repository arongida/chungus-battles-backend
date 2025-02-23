import { Clock } from 'colyseus';

export function delay(ms: number, clock: Clock): Promise<void> {
	return new Promise((resolve) => clock.setTimeout(resolve, ms));
}

export function rollTheDice(min: number, max: number) {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

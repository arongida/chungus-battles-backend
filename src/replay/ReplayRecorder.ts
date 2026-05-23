export interface ReplayEvent {
    t: number;
    kind: 'broadcast' | 'send';
    type: string;
    payload: any;
}

export interface ReplayInitialState {
    player: Record<string, any>;
    enemy: Record<string, any>;
    round: number;
    gameVersion: number;
}

export class ReplayRecorder {
    private startedAt = 0;
    private recording = false;
    private finalized = false;
    private static readonly MAX_EVENTS = 50_000;

    initialState: ReplayInitialState | null = null;
    events: ReplayEvent[] = [];
    truncated = false;

    start(initial: ReplayInitialState): void {
        this.startedAt = Date.now();
        this.initialState = initial;
        this.recording = true;
    }

    finalize(): void {
        this.finalized = true;
        this.recording = false;
    }

    isFinalized(): boolean {
        return this.finalized;
    }

    record(kind: 'broadcast' | 'send', type: string, payload: any): void {
        if (!this.recording) return;
        if (this.events.length >= ReplayRecorder.MAX_EVENTS) {
            this.truncated = true;
            return;
        }
        this.events.push({
            t: Date.now() - this.startedAt,
            kind,
            type,
            // structuredClone so mutable payloads don't get mutated after recording
            payload: structuredClone(payload),
        });
    }

    durationMs(): number {
        return this.events.length ? this.events[this.events.length - 1].t : 0;
    }
}

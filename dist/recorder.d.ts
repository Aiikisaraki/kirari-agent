import type { EventStore } from "./store";
import type { EventInput } from "./types";
export interface RecorderOptions {
    batchSize?: number;
    onWarn?: (message: string, error?: unknown) => void;
    now?: () => number;
    newEventId?: () => string;
    schemaVersion?: number;
}
export interface EventRecorder {
    enqueue(event: EventInput): void;
    flush(): Promise<void>;
    flushSync(): void;
    setEnabled(on: boolean): void;
    isEnabled(): boolean;
    readonly pending: number;
}
export declare function createRecorder(store: EventStore, opts?: RecorderOptions): EventRecorder;

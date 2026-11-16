// 旁路事件队列。
//
// 「不阻塞回复」靠四件事，而不是靠「better-sqlite3 是异步的」这种错觉
// （它是同步 API，单条 INSERT 确实占一个事件循环 tick）：
//   1) 批量：一轮几十条事件合成一次 append；
//   2) 不在 onDelta 里逐字写库，流式增量只入队；
//   3) 写失败只 warn、绝不 rethrow、事件留在队列靠幂等键重试；
//   4) 每轮 finally 只等这一次亚毫秒级写。
//
// 选「finally 同步 flush」而不是 setImmediate 分片，是因为阶段 A 的验收
// 硬指标是「杀进程重启后能逐字重建」——确定性优先于再省一点延迟。
// 进程退出兜底（beforeExit → flushSync）由两端各自注册，包不装全局钩子。

import { SCHEMA_VERSION } from "./schema";
import type { EventStore } from "./store";
import type { AgentEvent, EventInput } from "./types";

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

export function createRecorder(store: EventStore, opts: RecorderOptions = {}): EventRecorder {
    const batchSize = Math.max(1, opts.batchSize ?? 32);
    const onWarn = opts.onWarn ?? ((message: string, error?: unknown) => console.warn(message, error ?? ""));
    const now = opts.now ?? (() => Date.now());
    const schemaVersion = opts.schemaVersion ?? SCHEMA_VERSION;

    let counter = 0;
    const newEventId =
        opts.newEventId ??
        (() => {
            counter += 1;
            return `${now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        });

    const queue: AgentEvent[] = [];
    let enabled = true;

    function writeBatch(): void {
        if (queue.length === 0) return;
        const batch = queue.splice(0, queue.length);
        try {
            store.append(batch);
        } catch (err) {
            // 红线：事件写失败只警告，绝不冒泡到用户。
            // 事件放回队首，下一轮 flush 重试；靠 UNIQUE(origin,event_id) 幂等，重试不会重复。
            onWarn("[kirari-agent] 本批事件落库失败（已忽略，事件保留待重试）", err);
            queue.unshift(...batch);
        }
    }

    async function flush(): Promise<void> {
        if (!enabled) {
            queue.length = 0;
            return;
        }
        writeBatch();
    }

    function flushSync(): void {
        if (!enabled) {
            queue.length = 0;
            return;
        }
        writeBatch();
    }

    function enqueue(input: EventInput): void {
        if (!enabled) return;
        const event: AgentEvent = {
            schemaVersion: input.schemaVersion ?? schemaVersion,
            origin: input.origin,
            eventId: input.eventId ?? newEventId(),
            sessionId: input.sessionId,
            turnId: input.turnId,
            ts: input.ts ?? now(),
            type: input.type,
            payload: input.payload,
        };
        queue.push(event);

        if (queue.length >= batchSize) {
            void flush();
        }
        // 用户消息在 getReply 之前就写库，先落库才能保证
        // 「用户说过这句话」不因模型调用中途被杀而丢。
        if (input.type === "user_message") {
            void flush();
        }
    }

    function setEnabled(on: boolean): void {
        enabled = on;
        if (!on) queue.length = 0;
    }

    return {
        enqueue,
        flush,
        flushSync,
        setEnabled,
        isEnabled: () => enabled,
        get pending() {
            return queue.length;
        },
    };
}

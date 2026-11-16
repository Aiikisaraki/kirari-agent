import { describe, expect, it } from "vitest";
import { createRecorder } from "./recorder";
import { SCHEMA_VERSION } from "./schema";
import type { AgentEvent, EventInput, EventStore } from "./types";

class CollectingStore implements EventStore {
    rows: AgentEvent[] = [];
    failNext = false;

    append(events: readonly AgentEvent[]): void {
        if (this.failNext) {
            this.failNext = false;
            throw new Error("模拟 SQLITE_BUSY");
        }
        this.rows.push(...events);
    }

    query(): AgentEvent[] {
        return this.rows;
    }

    maxSeq(): number {
        return this.rows.length;
    }
}

function draft(type: EventInput["type"], payload: Record<string, unknown> = {}): EventInput {
    return { origin: "core", sessionId: "s1", turnId: "t1", type, payload };
}

describe("EventRecorder 旁路队列", () => {
    it("⑦ append 抛错时 flush 不 throw、只 warn、事件留在队列可重试", async () => {
        const store = new CollectingStore();
        const warns: string[] = [];
        const recorder = createRecorder(store, {
            batchSize: 100,
            onWarn: (msg) => warns.push(msg),
        });

        store.failNext = true;
        recorder.enqueue(draft("turn_start"));

        await expect(recorder.flush()).resolves.toBeUndefined();
        expect(warns).toHaveLength(1);
        expect(warns[0]).toContain("已忽略");
        expect(recorder.pending).toBe(1);

        // 下一次 flush 重试成功，且不会因为重试产生重复事件
        await recorder.flush();
        expect(store.rows).toHaveLength(1);
        expect(recorder.pending).toBe(0);
    });

    it("阈值批量：达到 batchSize 自动落库一次", () => {
        const store = new CollectingStore();
        const recorder = createRecorder(store, { batchSize: 2 });

        recorder.enqueue(draft("context_inject"));
        expect(store.rows).toHaveLength(0);
        recorder.enqueue(draft("request"));
        expect(store.rows).toHaveLength(2);
        expect(recorder.pending).toBe(0);
    });

    it("user_message 即时 flush（不等 finally，模型调用中途被杀也不丢）", () => {
        const store = new CollectingStore();
        const recorder = createRecorder(store, { batchSize: 100 });

        recorder.enqueue(draft("user_message", { content: "你好" }));
        expect(store.rows).toHaveLength(1);
        expect(store.rows[0].type).toBe("user_message");
    });

    it("自动补全 eventId / ts / schemaVersion，保留调用方显式给的值", () => {
        const store = new CollectingStore();
        const recorder = createRecorder(store, {
            batchSize: 100,
            now: () => 123456,
            newEventId: () => "fixed-id",
        });

        recorder.enqueue(draft("turn_start"));
        recorder.enqueue({
            ...draft("turn_end"),
            eventId: "explicit",
            ts: 999,
            schemaVersion: 7,
        });
        recorder.flushSync();

        expect(store.rows[0].eventId).toBe("fixed-id");
        expect(store.rows[0].ts).toBe(123456);
        expect(store.rows[0].schemaVersion).toBe(SCHEMA_VERSION);
        expect(store.rows[1].eventId).toBe("explicit");
        expect(store.rows[1].ts).toBe(999);
        expect(store.rows[1].schemaVersion).toBe(7);
    });

    it("setEnabled(false) 后不写库、flush 为空操作、队列清空", async () => {
        const store = new CollectingStore();
        const recorder = createRecorder(store, { batchSize: 100 });

        recorder.enqueue(draft("turn_start"));
        recorder.setEnabled(false);
        expect(recorder.isEnabled()).toBe(false);
        expect(recorder.pending).toBe(0);

        recorder.enqueue(draft("request"));
        await recorder.flush();
        expect(store.rows).toHaveLength(0);
    });

    it("flushSync 供进程退出兜底，落库后 pending 归零", () => {
        const store = new CollectingStore();
        const recorder = createRecorder(store, { batchSize: 100 });

        recorder.enqueue(draft("assistant_message", { content: "好" }));
        recorder.flushSync();
        expect(store.rows).toHaveLength(1);
        expect(recorder.pending).toBe(0);
    });
});

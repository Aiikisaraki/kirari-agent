import { describe, expect, it } from "vitest";
import {
    deriveModelMessages,
    deriveSystemContentFromInjects,
    deriveUiMessages,
    UI_HISTORY_LIMIT,
} from "./projector";
import { SCHEMA_VERSION } from "./schema";
import type { AgentEvent, EventQuery, EventStore } from "./types";

let idCounter = 0;

/** 内存 EventStore 替身：模拟 AUTOINCREMENT seq 与 UNIQUE(origin,event_id) 幂等。 */
class InMemoryEventStore implements EventStore {
    private rows: AgentEvent[] = [];
    private seq = 0;
    private seen = new Set<string>();

    append(events: readonly AgentEvent[]): void {
        for (const e of events) {
            const key = `${e.origin}:${e.eventId}`;
            if (this.seen.has(key)) continue;
            this.seen.add(key);
            this.seq += 1;
            this.rows.push({ ...e, seq: this.seq });
        }
    }

    query(q: EventQuery): AgentEvent[] {
        return this.rows
            .filter((e) => {
                if (e.sessionId !== q.sessionId) return false;
                if (q.fromSeq !== undefined && (e.seq ?? 0) <= q.fromSeq) return false;
                if (q.toSeq !== undefined && (e.seq ?? 0) > q.toSeq) return false;
                if (q.turnId && e.turnId !== q.turnId) return false;
                if (q.types && !q.types.includes(e.type)) return false;
                return true;
            })
            .slice(0, q.limit ?? 500);
    }

    maxSeq(sessionId?: string): number {
        if (!sessionId) return this.seq;
        return this.rows
            .filter((e) => e.sessionId === sessionId)
            .reduce((max, e) => Math.max(max, e.seq ?? 0), 0);
    }

    all(): AgentEvent[] {
        return [...this.rows];
    }
}

function ev(partial: Partial<AgentEvent> & Pick<AgentEvent, "type" | "payload">): AgentEvent {
    idCounter += 1;
    return {
        schemaVersion: SCHEMA_VERSION,
        origin: "core",
        eventId: `e-${idCounter}`,
        sessionId: "s1",
        turnId: "t1",
        ts: 1700000000000 + idCounter,
        ...partial,
    };
}

describe("deriveMessages 投影", () => {
    it("② 投影幂等；同一 eventId 重复 append 不产生重复消息", () => {
        const store = new InMemoryEventStore();
        const a = ev({ type: "user_message", payload: { content: "你好" } });
        store.append([a, { ...a }]);

        const events = store.all();
        expect(events).toHaveLength(1);
        const first = deriveUiMessages(events, { sessionId: "s1" });
        const second = deriveUiMessages(events, { sessionId: "s1" });
        expect(second).toEqual(first);
        expect(first).toHaveLength(1);
    });

    it("③ 杀进程重启后从事件流逐字重建当时发给模型的 messages", () => {
        const messages = [
            { role: "system", content: "A\n\nB" },
            {
                role: "user",
                content: [
                    { type: "text", text: "看图" },
                    { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
                ],
            },
            { role: "assistant", content: "好" },
        ];
        const store = new InMemoryEventStore();
        store.append([
            ev({
                type: "context_inject",
                payload: { source: "system.base", content: "A", order: 0, meta: {} },
            }),
            ev({
                type: "context_inject",
                payload: { source: "daily_brief", content: "\n\nB", order: 1, meta: {} },
            }),
            ev({
                type: "request",
                payload: { round: 0, callSite: "main", params: { max_tokens: 1500 }, messages },
            }),
        ]);

        // 模拟重启：序列化落盘 → 新进程重新载入事件
        const serialized = JSON.stringify(store.all());
        const restarted = new InMemoryEventStore();
        restarted.append(JSON.parse(serialized) as AgentEvent[]);
        const events = restarted.all();

        expect(JSON.stringify(deriveModelMessages(events))).toBe(JSON.stringify(messages));
        // 校验路径：注入段拼回来必须等于 request 的 system content
        expect(deriveSystemContentFromInjects(events)).toBe(messages[0].content);
    });

    it("④ 500 条裁剪：messages_pruned 之后只保留最近 500 条且顺序不变", () => {
        const store = new InMemoryEventStore();
        const batch: AgentEvent[] = [];
        for (let i = 0; i < 501; i += 1) {
            batch.push(ev({ type: "user_message", payload: { content: `msg-${i}` } }));
        }
        store.append(batch);
        const droppedId = store.all()[0].eventId;
        store.append([
            ev({ type: "messages_pruned", payload: { droppedEventIds: [droppedId] } }),
        ]);

        const ui = deriveUiMessages(store.all(), { sessionId: "s1" });
        expect(ui).toHaveLength(UI_HISTORY_LIMIT);
        expect(ui[0].content).toBe("msg-1");
        expect(ui[ui.length - 1].content).toBe("msg-500");
    });

    it("⑤ session_cleared 清空 UI 投影，但 request 快照仍可重建（事件不删）", () => {
        const messages = [
            { role: "system", content: "S" },
            { role: "user", content: "U" },
        ];
        const store = new InMemoryEventStore();
        store.append([
            ev({ type: "user_message", payload: { content: "U" } }),
            ev({ type: "request", payload: { callSite: "main", messages } }),
            ev({ type: "session_cleared", payload: { clearedThroughSeq: 9999 } }),
        ]);

        const events = store.all();
        expect(deriveUiMessages(events, { sessionId: "s1" })).toHaveLength(0);
        expect(deriveModelMessages(events)).toEqual(messages);
    });

    it("⑥ messages_merged 后 from 会话的事件归属 into，且按 seq 有序", () => {
        const store = new InMemoryEventStore();
        store.append([
            ev({ type: "user_message", sessionId: "from-a", payload: { content: "A" } }),
            ev({ type: "user_message", sessionId: "from-b", payload: { content: "B" } }),
            ev({
                type: "messages_merged",
                payload: { fromSessionIds: ["from-a", "from-b"], intoSessionId: "into" },
            }),
            ev({ type: "user_message", sessionId: "into", payload: { content: "C" } }),
        ]);

        const ui = deriveUiMessages(store.all(), { sessionId: "into" });
        expect(ui.map((m) => m.content)).toEqual(["A", "B", "C"]);
        const ids = ui.map((m) => m.id);
        expect(ids).toEqual([...ids].sort((a, b) => a - b));
    });

    it("⑧ seq 严格递增，query 按 seq 升序", () => {
        const store = new InMemoryEventStore();
        store.append(
            Array.from({ length: 100 }, (_, i) =>
                ev({ type: "user_message", payload: { content: `m${i}` } }),
            ),
        );
        const events = store.query({ sessionId: "s1", limit: 100 });
        expect(events).toHaveLength(100);
        const seqs = events.map((e) => e.seq ?? 0);
        expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
        expect(new Set(seqs).size).toBe(100);
    });

    it("⑨ 投影不截断模型 messages；内核事件不进 UI 历史", () => {
        const messages = [
            { role: "system", content: "S" },
            ...Array.from({ length: 6 }, (_, i) => ({ role: "user", content: `h${i}` })),
            { role: "user", content: "current" },
        ];
        const store = new InMemoryEventStore();
        store.append([
            ev({ type: "request", payload: { callSite: "main", messages } }),
            ev({ type: "tool_call", payload: { name: "get_weather" } }),
            ev({ type: "tool_result", payload: { content: "晴" } }),
            ev({ type: "turn_end", payload: { outcome: "model" } }),
        ]);

        expect(deriveModelMessages(store.all())).toEqual(messages);
        expect(deriveUiMessages(store.all(), { sessionId: "s1" })).toHaveLength(0);
    });

    it("非主链路 request（polish / salvage）不进模型历史", () => {
        const store = new InMemoryEventStore();
        store.append([
            ev({ type: "request", payload: { callSite: "main", messages: [{ role: "user", content: "主" }] } }),
            ev({ type: "request", payload: { callSite: "polish", messages: [{ role: "user", content: "润色" }] } }),
        ]);
        expect(deriveModelMessages(store.all())).toEqual([{ role: "user", content: "主" }]);
    });
});

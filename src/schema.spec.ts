import { describe, expect, it } from "vitest";
import {
    SCHEMA_VERSION,
    SESSION_EVENTS_COLUMNS,
    SESSION_EVENTS_DDL,
    SESSION_EVENTS_TABLE,
} from "./schema";
import { DEFAULT_EVENT_QUERY_LIMIT, MAX_EVENT_QUERY_LIMIT } from "./store";
import { EVENT_TYPES, INJECT_SOURCES } from "./types";

describe("事件 schema", () => {
    it("SCHEMA_VERSION 锁定为 1", () => {
        expect(SCHEMA_VERSION).toBe(1);
    });

    it("DDL 含跨进程安全的 seq 与幂等唯一约束", () => {
        expect(SESSION_EVENTS_DDL).toContain("INTEGER PRIMARY KEY AUTOINCREMENT");
        expect(SESSION_EVENTS_DDL).toContain("UNIQUE (origin, event_id)");
        expect(SESSION_EVENTS_DDL).toContain(`CREATE TABLE IF NOT EXISTS ${SESSION_EVENTS_TABLE}`);
    });

    it("DDL 建齐三个索引", () => {
        expect(SESSION_EVENTS_DDL).toContain("idx_session_events_session_seq");
        expect(SESSION_EVENTS_DDL).toContain("idx_session_events_turn");
        expect(SESSION_EVENTS_DDL).toContain("idx_session_events_type");
    });

    it("列清单与 DDL 一致且无重复", () => {
        for (const col of SESSION_EVENTS_COLUMNS) {
            expect(SESSION_EVENTS_DDL).toContain(`${col.name} `);
        }
        const names = SESSION_EVENTS_COLUMNS.map((c) => c.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it("事件类型穷举无重复，关键类型齐全", () => {
        expect(new Set(EVENT_TYPES).size).toBe(EVENT_TYPES.length);
        for (const t of [
            "request",
            "context_inject",
            "tool_call",
            "tool_result",
            "session_cleared",
            "messages_merged",
        ] as const) {
            expect(EVENT_TYPES).toContain(t);
        }
    });

    it("四个注入源顺序固定（顺序即 order）", () => {
        expect([...INJECT_SOURCES]).toEqual([
            "system.base",
            "daily_brief",
            "knowledge",
            "skills",
        ]);
    });

    it("查询上限合理", () => {
        expect(DEFAULT_EVENT_QUERY_LIMIT).toBeLessThanOrEqual(MAX_EVENT_QUERY_LIMIT);
        expect(MAX_EVENT_QUERY_LIMIT).toBe(2000);
    });
});

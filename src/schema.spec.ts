import { describe, expect, it } from "vitest";
import {
    SCHEMA_VERSION,
    SESSION_EVENTS_COLUMNS,
    SESSION_EVENTS_DDL,
    SESSION_EVENTS_TABLE,
    TASKS_DDL,
    TASKS_TABLE,
    TASKS_COLUMNS,
    SCHEDULED_JOBS_DDL,
    SCHEDULED_JOBS_TABLE,
    SCHEDULED_JOBS_COLUMNS,
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
            "task_created",
            "task_updated",
            "task_completed",
            "task_failed",
            "job_created",
            "job_fired",
            "job_cancelled",
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

describe("阶段 C 业务表 DDL", () => {
    it("tasks 表主键 + 索引 + 列清单一致", () => {
        expect(TASKS_DDL).toContain(`CREATE TABLE IF NOT EXISTS ${TASKS_TABLE}`);
        expect(TASKS_DDL).toContain("task_id       TEXT PRIMARY KEY");
        expect(TASKS_DDL).toContain("idx_tasks_session_status");
        expect(TASKS_DDL).toContain("idx_tasks_active");
        for (const col of TASKS_COLUMNS) expect(TASKS_DDL).toContain(`${col.name} `);
        const names = TASKS_COLUMNS.map((c) => c.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it("scheduled_jobs 表主键 + 到期索引 + 列清单一致", () => {
        expect(SCHEDULED_JOBS_DDL).toContain(`CREATE TABLE IF NOT EXISTS ${SCHEDULED_JOBS_TABLE}`);
        expect(SCHEDULED_JOBS_DDL).toContain("job_id        TEXT PRIMARY KEY");
        expect(SCHEDULED_JOBS_DDL).toContain("idx_jobs_due");
        expect(SCHEDULED_JOBS_DDL).toContain("idx_jobs_session");
        for (const col of SCHEDULED_JOBS_COLUMNS) expect(SCHEDULED_JOBS_DDL).toContain(`${col.name} `);
        const names = SCHEDULED_JOBS_COLUMNS.map((c) => c.name);
        expect(new Set(names).size).toBe(names.length);
    });
});

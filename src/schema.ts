// session_events 的 DDL 与列清单。
//
// 为什么把 DDL 文本放在共享包里：核心版与桌面端是**两个进程直写同一个
// pet_sessions.db**，两端各自执行同一份 DDL 才能保证 schema 不分叉；
// 但本包仍然不 require better-sqlite3 —— 这里只是导出字符串常量，
// 由两端拿自己已有的 db.exec() 去执行。
//
// 为什么 seq 用 AUTOINCREMENT 而不是应用层计数器：两个进程各自维护
// seq++ 必然冲突；SQLite 对同一文件的写由文件锁串行化，rowid 天然
// 全局唯一且单调递增，ORDER BY seq 就是跨进程的因果序。

export const SCHEMA_VERSION = 1;

export const SESSION_EVENTS_TABLE = "session_events";

export const SESSION_EVENTS_DDL = `
CREATE TABLE IF NOT EXISTS session_events (
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,
    origin      TEXT NOT NULL,
    event_id    TEXT NOT NULL,
    session_id  TEXT NOT NULL,
    turn_id     TEXT NOT NULL,
    ts          INTEGER NOT NULL,
    schema_ver  INTEGER NOT NULL DEFAULT 1,
    type        TEXT NOT NULL,
    payload     TEXT NOT NULL,
    UNIQUE (origin, event_id)
);
CREATE INDEX IF NOT EXISTS idx_session_events_session_seq ON session_events(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_session_events_turn ON session_events(turn_id, seq);
CREATE INDEX IF NOT EXISTS idx_session_events_type ON session_events(type, seq);
`;

/** 供两端 PRAGMA table_info 幂等补列用；ddl 必须是 ALTER TABLE ADD COLUMN 能接受的形式。 */
export interface EventColumn {
    name: string;
    ddl: string;
}

/**
 * 全部列的清单。前 9 列由 CREATE TABLE 保证存在，正常情况下补列循环不会执行；
 * 这个清单的真正用途是**未来新增列**：只改包里这一处，两端自动跟上，不用各写一份。
 */
export const SESSION_EVENTS_COLUMNS: readonly EventColumn[] = [
    { name: "seq", ddl: "seq INTEGER" },
    { name: "origin", ddl: "origin TEXT" },
    { name: "event_id", ddl: "event_id TEXT" },
    { name: "session_id", ddl: "session_id TEXT" },
    { name: "turn_id", ddl: "turn_id TEXT" },
    { name: "ts", ddl: "ts INTEGER" },
    { name: "schema_ver", ddl: "schema_ver INTEGER DEFAULT 1" },
    { name: "type", ddl: "type TEXT" },
    { name: "payload", ddl: "payload TEXT" },
] as const;

// ── 阶段 C：tasks 与 scheduled_jobs ────────────────────────────────
// 这两张表同样由核心版与桌宠版直写同一个 pet_sessions.db，DDL 集中在共享包，
// 避免两端各写一份导致 schema 分叉。与 session_events 一样，本包不 require DB 库，
// 只导出字符串常量由两端 db.exec() 执行。SCHEMA_VERSION 是「事件信封」版本，
// 与这两张业务表无关，故不升级。

export const TASKS_TABLE = "tasks";
export const TASKS_DDL = `
CREATE TABLE IF NOT EXISTS tasks (
    task_id       TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL,
    turn_id       TEXT NOT NULL,
    origin        TEXT NOT NULL,
    uid           INTEGER NOT NULL DEFAULT 1,
    title         TEXT NOT NULL,
    status        TEXT NOT NULL,
    steps_json    TEXT NOT NULL,
    current_step  INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    completed_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tasks_session_status ON tasks(session_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_active ON tasks(status, created_at);
`;
export const TASKS_COLUMNS: readonly EventColumn[] = [
    { name: "task_id", ddl: "task_id TEXT" },
    { name: "session_id", ddl: "session_id TEXT" },
    { name: "turn_id", ddl: "turn_id TEXT" },
    { name: "origin", ddl: "origin TEXT" },
    { name: "uid", ddl: "uid INTEGER DEFAULT 1" },
    { name: "title", ddl: "title TEXT" },
    { name: "status", ddl: "status TEXT" },
    { name: "steps_json", ddl: "steps_json TEXT" },
    { name: "current_step", ddl: "current_step INTEGER DEFAULT 0" },
    { name: "created_at", ddl: "created_at INTEGER" },
    { name: "updated_at", ddl: "updated_at INTEGER" },
    { name: "completed_at", ddl: "completed_at INTEGER" },
] as const;

export const SCHEDULED_JOBS_TABLE = "scheduled_jobs";
export const SCHEDULED_JOBS_DDL = `
CREATE TABLE IF NOT EXISTS scheduled_jobs (
    job_id        TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL,
    origin        TEXT NOT NULL,
    uid           INTEGER NOT NULL DEFAULT 1,
    kind          TEXT NOT NULL,
    title         TEXT NOT NULL,
    payload       TEXT NOT NULL,
    due_at        INTEGER NOT NULL,
    recurrence    TEXT NOT NULL DEFAULT 'once',
    status        TEXT NOT NULL DEFAULT 'pending',
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    last_fired_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON scheduled_jobs(status, due_at);
CREATE INDEX IF NOT EXISTS idx_jobs_session ON scheduled_jobs(session_id, status);
`;
export const SCHEDULED_JOBS_COLUMNS: readonly EventColumn[] = [
    { name: "job_id", ddl: "job_id TEXT" },
    { name: "session_id", ddl: "session_id TEXT" },
    { name: "origin", ddl: "origin TEXT" },
    { name: "uid", ddl: "uid INTEGER DEFAULT 1" },
    { name: "kind", ddl: "kind TEXT" },
    { name: "title", ddl: "title TEXT" },
    { name: "payload", ddl: "payload TEXT" },
    { name: "due_at", ddl: "due_at INTEGER" },
    { name: "recurrence", ddl: "recurrence TEXT DEFAULT 'once'" },
    { name: "status", ddl: "status TEXT DEFAULT 'pending'" },
    { name: "created_at", ddl: "created_at INTEGER" },
    { name: "updated_at", ddl: "updated_at INTEGER" },
    { name: "last_fired_at", ddl: "last_fired_at INTEGER" },
] as const;

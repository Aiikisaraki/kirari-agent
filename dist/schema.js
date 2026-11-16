"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SESSION_EVENTS_COLUMNS = exports.SESSION_EVENTS_DDL = exports.SESSION_EVENTS_TABLE = exports.SCHEMA_VERSION = void 0;
exports.SCHEMA_VERSION = 1;
exports.SESSION_EVENTS_TABLE = "session_events";
exports.SESSION_EVENTS_DDL = `
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
/**
 * 全部列的清单。前 9 列由 CREATE TABLE 保证存在，正常情况下补列循环不会执行；
 * 这个清单的真正用途是**未来新增列**：只改包里这一处，两端自动跟上，不用各写一份。
 */
exports.SESSION_EVENTS_COLUMNS = [
    { name: "seq", ddl: "seq INTEGER" },
    { name: "origin", ddl: "origin TEXT" },
    { name: "event_id", ddl: "event_id TEXT" },
    { name: "session_id", ddl: "session_id TEXT" },
    { name: "turn_id", ddl: "turn_id TEXT" },
    { name: "ts", ddl: "ts INTEGER" },
    { name: "schema_ver", ddl: "schema_ver INTEGER DEFAULT 1" },
    { name: "type", ddl: "type TEXT" },
    { name: "payload", ddl: "payload TEXT" },
];
//# sourceMappingURL=schema.js.map
export declare const SCHEMA_VERSION = 1;
export declare const SESSION_EVENTS_TABLE = "session_events";
export declare const SESSION_EVENTS_DDL = "\nCREATE TABLE IF NOT EXISTS session_events (\n    seq         INTEGER PRIMARY KEY AUTOINCREMENT,\n    origin      TEXT NOT NULL,\n    event_id    TEXT NOT NULL,\n    session_id  TEXT NOT NULL,\n    turn_id     TEXT NOT NULL,\n    ts          INTEGER NOT NULL,\n    schema_ver  INTEGER NOT NULL DEFAULT 1,\n    type        TEXT NOT NULL,\n    payload     TEXT NOT NULL,\n    UNIQUE (origin, event_id)\n);\nCREATE INDEX IF NOT EXISTS idx_session_events_session_seq ON session_events(session_id, seq);\nCREATE INDEX IF NOT EXISTS idx_session_events_turn ON session_events(turn_id, seq);\nCREATE INDEX IF NOT EXISTS idx_session_events_type ON session_events(type, seq);\n";
/** 供两端 PRAGMA table_info 幂等补列用；ddl 必须是 ALTER TABLE ADD COLUMN 能接受的形式。 */
export interface EventColumn {
    name: string;
    ddl: string;
}
/**
 * 全部列的清单。前 9 列由 CREATE TABLE 保证存在，正常情况下补列循环不会执行；
 * 这个清单的真正用途是**未来新增列**：只改包里这一处，两端自动跟上，不用各写一份。
 */
export declare const SESSION_EVENTS_COLUMNS: readonly EventColumn[];

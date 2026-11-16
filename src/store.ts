// EventStore 是**纯契约**，不含任何数据库类型或依赖。
//
// 为什么这样切：核心版与桌面端各自持有已存在的 better-sqlite3 连接，
// 各自实现一个适配器注入进来。共享包因此不需要碰原生模块，
// 也就不会有「Electron 主进程要单独 rebuild」的问题（两端能力对等）。

import type { AgentEvent, EventType } from "./types";

export interface EventQuery {
    sessionId: string;
    fromSeq?: number;
    toSeq?: number;
    turnId?: string;
    types?: readonly EventType[];
    limit?: number;
}

export const DEFAULT_EVENT_QUERY_LIMIT = 500;
export const MAX_EVENT_QUERY_LIMIT = 2000;

export interface EventStore {
    /** 批量写；必须对 (origin, eventId) 幂等。失败由调用方（recorder）兜住，不冒泡。 */
    append(events: readonly AgentEvent[]): void;
    /** 按 seq 升序返回；投影与轨迹查询共用这一条路径。 */
    query(q: EventQuery): AgentEvent[];
    /** 当前最大 seq，供增量消费与 baseline 计算。 */
    maxSeq(sessionId?: string): number;
}

import type { AgentEvent, EventType } from "./types";
export interface EventQuery {
    sessionId: string;
    fromSeq?: number;
    toSeq?: number;
    turnId?: string;
    types?: readonly EventType[];
    limit?: number;
}
export declare const DEFAULT_EVENT_QUERY_LIMIT = 500;
export declare const MAX_EVENT_QUERY_LIMIT = 2000;
export interface EventStore {
    /** 批量写；必须对 (origin, eventId) 幂等。失败由调用方（recorder）兜住，不冒泡。 */
    append(events: readonly AgentEvent[]): void;
    /** 按 seq 升序返回；投影与轨迹查询共用这一条路径。 */
    query(q: EventQuery): AgentEvent[];
    /** 当前最大 seq，供增量消费与 baseline 计算。 */
    maxSeq(sessionId?: string): number;
}

/** 产生事件的进程。两端各自写同一个 pet_sessions.db，靠 origin 区分来源。 */
export type EventOrigin = "core" | "desktop";
/** 事件类型穷举。新增类型只能追加，不要插入中间改变已有顺序语义。 */
export type EventType = "turn_start" | "turn_end" | "session_cleared" | "messages_merged" | "session_baseline" | "messages_pruned" | "user_message" | "assistant_message" | "external_message" | "context_inject" | "context" | "request" | "assistant_delta" | "assistant_attempt" | "tool_call" | "tool_result" | "context_compact" | "task_created" | "task_updated" | "task_completed" | "task_failed" | "goal_set" | "job_created" | "job_fired" | "job_cancelled";
export declare const EVENT_TYPES: readonly EventType[];
/** 上下文注入来源。顺序即 order，Trajectory 按它追溯每条注入。 */
export type InjectSource = "system.base" | "daily_brief" | "knowledge" | "skills";
export declare const INJECT_SOURCES: readonly InjectSource[];
/** 与 messages.content 的存储形状一致：纯文本或多模态数组。 */
export interface ContentPart {
    type: "text" | "image_url";
    text?: string;
    image_url?: {
        url: string;
    };
}
export type MessageContent = string | ContentPart[];
export interface MessageExtras {
    emotion?: string;
    images?: string[];
}
/**
 * 一条事件。seq 由 DB 的 AUTOINCREMENT 分配（写入端不指定），
 * eventId 由写入端生成，配合 UNIQUE(origin, event_id) 做批量 flush 重试幂等。
 */
export interface AgentEvent {
    schemaVersion: number;
    origin: EventOrigin;
    eventId: string;
    sessionId: string;
    turnId: string;
    seq?: number;
    ts: number;
    type: EventType;
    payload: Record<string, unknown>;
}
/**
 * 写入端提交的事件草稿。seq 由 DB 分配，eventId / ts / schemaVersion 由 recorder 补全，
 * 这样两端调用点只需给出「发生了什么」，不必各自重复生成幂等键与时间。
 */
export type EventInput = Omit<AgentEvent, "seq" | "eventId" | "ts" | "schemaVersion"> & {
    eventId?: string;
    ts?: number;
    schemaVersion?: number;
};

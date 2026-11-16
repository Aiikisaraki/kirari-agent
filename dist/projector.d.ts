import type { AgentEvent, MessageContent } from "./types";
export declare const UI_HISTORY_LIMIT = 500;
export interface ModelMessage {
    role: string;
    content: MessageContent | null;
    tool_calls?: unknown[];
    tool_call_id?: string;
    name?: string;
}
/** 与 getSessionMessages 返回形状同形（id / role / content / emotion / images / timestamp）。 */
export interface UiMessage {
    id: number;
    role: string;
    content: MessageContent;
    emotion?: string;
    images?: string[];
    timestamp: number;
}
export interface DeriveModelOptions {
    turnId?: string;
    upToSeq?: number;
    round?: number;
}
/** 取最后一条主链路 request，逐字还原当时发给模型的 messages。 */
export declare function deriveModelMessages(events: readonly AgentEvent[], opts?: DeriveModelOptions): ModelMessage[];
/** 结构化校验路径：按 order 把注入段拼回 system content。 */
export declare function deriveSystemContentFromInjects(events: readonly AgentEvent[], turnId?: string): string;
export interface DeriveUiOptions {
    sessionId: string;
}
/**
 * 折叠出 UI 历史。session_cleared / messages_merged / messages_pruned 分别表达
 * messages 表的 DELETE / UPDATE / 500 条裁剪语义——事件流自身不删不改，只记
 * tombstone，这正是「事件流为真源」的所在。
 */
export declare function deriveUiMessages(events: readonly AgentEvent[], opts: DeriveUiOptions): UiMessage[];

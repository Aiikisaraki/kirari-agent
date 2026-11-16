"use strict";
// 事件类型与信封。
//
// 设计来源：Harness 的「模型可见即已记录」——每个模型请求都必须能从日志重建。
// 这里的事件流是 kirari 会话的**唯一真源**；`messages` 表降级为 UI 投影缓存，
// 但表结构与读写接口保持原样，两端读历史的代码一行都不用改。
//
// ⚠️ preset 锁定：一旦有内容落库，已有类型的字段含义即只读。
//    后续演进只能「新增类型 + 可选字段」，不得改写已有类型的 payload 语义；
//    新行为靠 schemaVersion 分支读，这样才能回放老事件。
Object.defineProperty(exports, "__esModule", { value: true });
exports.INJECT_SOURCES = exports.EVENT_TYPES = void 0;
exports.EVENT_TYPES = [
    "turn_start",
    "turn_end",
    "session_cleared",
    "messages_merged",
    "session_baseline",
    "messages_pruned",
    "user_message",
    "assistant_message",
    "external_message",
    "context_inject",
    "context",
    "request",
    "assistant_delta",
    "assistant_attempt",
    "tool_call",
    "tool_result",
    "context_compact",
    "task_created",
    "task_updated",
    "task_completed",
    "task_failed",
    "goal_set",
    "job_created",
    "job_fired",
    "job_cancelled",
];
exports.INJECT_SOURCES = [
    "system.base",
    "daily_brief",
    "knowledge",
    "skills",
];
//# sourceMappingURL=types.js.map
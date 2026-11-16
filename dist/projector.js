"use strict";
// 从事件流投影出「模型可见 messages」与「UI 可见历史」。
//
// 两条路径的权威性不同，写清楚免得后来人误用：
//   - 权威路径：request 事件里存的是调用模型前 messages 数组的**逐字深拷贝**，
//     deriveModelMessages 直接 JSON.parse 回来。这是 Harness「杀进程重启后逐字重建」
//     的落点，不是事后拼出来的。
//   - 校验路径：deriveSystemContentFromInjects 按 order 把 context_inject 拼回
//     system content，单测断言它 === request.messages[0].content，
//     用来证明「注入确实是模型可见内容的来源」，而不只是存了一份快照。
//
// 阶段 A 的过渡语义：messages 表仍由各产生点直接写，事件流旁路记录真源；
// 本投影用于验收与灾难恢复（rebuildProjection 由两端适配器执行），
// 平时不常驻回写，避免双写。「messages 由投影写入」的完全收敛放在 B/C 阶段。
Object.defineProperty(exports, "__esModule", { value: true });
exports.UI_HISTORY_LIMIT = void 0;
exports.deriveModelMessages = deriveModelMessages;
exports.deriveSystemContentFromInjects = deriveSystemContentFromInjects;
exports.deriveUiMessages = deriveUiMessages;
const inject_1 = require("./inject");
exports.UI_HISTORY_LIMIT = 500;
function isMainRequest(e, opts) {
    if (e.type !== "request")
        return false;
    if (opts.turnId && e.turnId !== opts.turnId)
        return false;
    if (opts.upToSeq !== undefined && (e.seq ?? Number.POSITIVE_INFINITY) > opts.upToSeq)
        return false;
    const p = e.payload;
    if (p.callSite && p.callSite !== "main")
        return false;
    if (opts.round !== undefined && p.round !== opts.round)
        return false;
    return true;
}
/** 取最后一条主链路 request，逐字还原当时发给模型的 messages。 */
function deriveModelMessages(events, opts = {}) {
    const candidates = events.filter((e) => isMainRequest(e, opts));
    const last = candidates[candidates.length - 1];
    if (!last)
        return [];
    const messages = last.payload.messages;
    return Array.isArray(messages) ? messages : [];
}
/** 结构化校验路径：按 order 把注入段拼回 system content。 */
function deriveSystemContentFromInjects(events, turnId) {
    const segments = [];
    for (const e of events) {
        if (e.type !== "context_inject")
            continue;
        if (turnId && e.turnId !== turnId)
            continue;
        const p = e.payload;
        if (typeof p.source === "string" && typeof p.content === "string") {
            segments.push(p);
        }
    }
    return (0, inject_1.concatInjects)(segments);
}
/** 把 from 会话沿 alias 链解析到最终会话（mergeSessions 可链式合并）。 */
function resolveSession(id, alias) {
    let current = id;
    const seen = new Set();
    while (alias.has(current) && !seen.has(current)) {
        seen.add(current);
        current = alias.get(current);
    }
    return current;
}
/**
 * 折叠出 UI 历史。session_cleared / messages_merged / messages_pruned 分别表达
 * messages 表的 DELETE / UPDATE / 500 条裁剪语义——事件流自身不删不改，只记
 * tombstone，这正是「事件流为真源」的所在。
 */
function deriveUiMessages(events, opts) {
    const alias = new Map();
    const eventIdBySeq = new Map();
    let messages = [];
    const belongs = (e) => e.sessionId === opts.sessionId || resolveSession(e.sessionId, alias) === opts.sessionId;
    // mergeSessions 是事后发生的：旧消息事件里的 session_id 仍是 from。
    // 先整遍扫一遍建立完整映射，折叠时才能把历史消息归到 into 会话。
    for (const e of events) {
        if (e.type !== "messages_merged")
            continue;
        const p = e.payload;
        if (p.intoSessionId && Array.isArray(p.fromSessionIds)) {
            for (const from of p.fromSessionIds)
                alias.set(from, p.intoSessionId);
        }
    }
    for (const e of events) {
        switch (e.type) {
            case "messages_merged": {
                // 映射已在上面的预扫描里建立完毕，这里只需保持事件顺序语义。
                break;
            }
            case "session_cleared": {
                if (!belongs(e))
                    break;
                const p = e.payload;
                const through = p.clearedThroughSeq ?? e.seq ?? 0;
                messages = messages.filter((m) => m.id > through);
                break;
            }
            case "messages_pruned": {
                if (!belongs(e))
                    break;
                const p = e.payload;
                const dropped = new Set(p.droppedEventIds ?? []);
                if (dropped.size > 0) {
                    messages = messages.filter((m) => !dropped.has(eventIdBySeq.get(m.id) ?? ""));
                }
                else if (p.keptFromSeq !== undefined) {
                    messages = messages.filter((m) => m.id >= p.keptFromSeq);
                }
                break;
            }
            case "user_message":
            case "assistant_message":
            case "external_message": {
                if (!belongs(e))
                    break;
                const p = e.payload;
                const seq = e.seq ?? 0;
                if (e.eventId)
                    eventIdBySeq.set(seq, e.eventId);
                messages.push({
                    id: seq,
                    role: p.role ?? (e.type === "user_message" ? "user" : "assistant"),
                    content: (p.content ?? ""),
                    emotion: p.extras?.emotion,
                    images: p.extras?.images,
                    timestamp: e.ts,
                });
                break;
            }
            default:
                break;
        }
    }
    return messages.slice(-exports.UI_HISTORY_LIMIT);
}
//# sourceMappingURL=projector.js.map
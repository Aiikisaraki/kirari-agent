"use strict";
// src/jobs.ts
// 阶段 C：scheduled_jobs 的纯逻辑（用户拍板：提醒同时落库成定时任务，重启不丢）。
//
// 与 tasks.ts 同纪律：只放类型 + 时间计算 + 严格解析；DB 由两端注入 JobStore。
// 调度器（每端一个，扫表到点触发）不进共享包——它是 IO，不是纯逻辑。
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseReminder = parseReminder;
exports.createJob = createJob;
exports.isDue = isDue;
exports.computeNextRun = computeNextRun;
exports.fireJob = fireJob;
exports.cancelJob = cancelJob;
const MAX_PAYLOAD = 4000;
function isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
/**
 * 严格解析 schedule_reminder 工具参数。
 * 接受两种时间写法（二选一）：
 *   - dueAt:   绝对 epoch ms
 *   - delayMs: 相对当前时间的毫秒数（模型更自然）
 * 必须给出且仅一种，否则报错——避免「0 毫秒后提醒」这类静默错误。
 */
function parseReminder(raw, now, where = "schedule_reminder") {
    if (!isPlainObject(raw))
        throw new Error(`[${where}] 参数必须是对象`);
    if (typeof raw.title !== "string" || raw.title.trim().length === 0) {
        throw new Error(`[${where}] title 必须是非空字符串`);
    }
    if (typeof raw.text !== "string" || raw.text.trim().length === 0) {
        throw new Error(`[${where}] text 必须是非空字符串`);
    }
    if (raw.text.length > MAX_PAYLOAD) {
        throw new Error(`[${where}] text 超过 ${MAX_PAYLOAD} 字符`);
    }
    const hasDueAt = typeof raw.dueAt === "number" && Number.isFinite(raw.dueAt);
    const hasDelay = typeof raw.delayMs === "number" && Number.isFinite(raw.delayMs);
    if (hasDueAt === hasDelay) {
        throw new Error(`[${where}] 必须且只能提供 dueAt 或 delayMs 之一`);
    }
    const dueAt = hasDueAt ? raw.dueAt : now + raw.delayMs;
    if (!Number.isFinite(dueAt) || dueAt < 0) {
        throw new Error(`[${where}] 计算出的 dueAt 非法`);
    }
    return { title: raw.title.trim(), payload: raw.text, dueAt };
}
function createJob(input) {
    return {
        jobId: input.jobId,
        sessionId: input.sessionId,
        origin: input.origin,
        uid: input.uid,
        kind: input.kind,
        title: input.title,
        payload: input.payload,
        dueAt: input.dueAt,
        recurrence: input.recurrence ?? "once",
        status: "pending",
        createdAt: input.now,
        updatedAt: input.now,
    };
}
/** 到点判定：pending 且 dueAt 已过。 */
function isDue(job, now) {
    return job.status === "pending" && job.dueAt <= now;
}
/**
 * 计算下一次触发时间。once 返回 null（触发即结束）；daily 顺延 24h 直到
 * 严格大于 now（避免重启后补跑一堆过期任务，只跑最近一次）。
 */
function computeNextRun(job, now) {
    if (job.recurrence !== "daily")
        return null;
    const DAY = 24 * 60 * 60 * 1000;
    let next = job.dueAt + DAY;
    while (next <= now)
        next += DAY;
    return next;
}
/**
 * 触发一条 job：标记 fired 并记录 lastFiredAt；daily 任务顺延 dueAt 并回到 pending，
 * once 任务置 fired 终态。返回新对象。
 */
function fireJob(job, now) {
    const next = computeNextRun(job, now);
    return {
        ...job,
        status: next === null ? "fired" : "pending",
        dueAt: next ?? job.dueAt,
        lastFiredAt: now,
        updatedAt: now,
    };
}
function cancelJob(job, now) {
    return { ...job, status: "cancelled", updatedAt: now };
}
//# sourceMappingURL=jobs.js.map
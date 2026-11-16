// src/jobs.ts
// 阶段 C：scheduled_jobs 的纯逻辑（用户拍板：提醒同时落库成定时任务，重启不丢）。
//
// 与 tasks.ts 同纪律：只放类型 + 时间计算 + 严格解析；DB 由两端注入 JobStore。
// 调度器（每端一个，扫表到点触发）不进共享包——它是 IO，不是纯逻辑。

import type { EventOrigin } from "./types";

/** 任务种类。reminder=一次性提醒；daily_brief=每日简报（供现有 setTimeout 递归迁移）。 */
export type JobKind = "reminder" | "daily_brief";

/** 周期。once=触发一次即 fired；daily=触发后按 computeNextRun 顺延到次日同一时刻。 */
export type JobRecurrence = "once" | "daily";

export type JobStatus = "pending" | "fired" | "cancelled";

/** 一条持久化定时任务。 */
export interface ScheduledJob {
    jobId: string;
    sessionId: string;
    origin: EventOrigin;
    uid: number;
    kind: JobKind;
    title: string;
    /** 触发时送给模型 / 直接播报的文本。 */
    payload: string;
    /** 下次触发时间（epoch ms）。 */
    dueAt: number;
    recurrence: JobRecurrence;
    status: JobStatus;
    createdAt: number;
    updatedAt: number;
    lastFiredAt?: number;
}

/** JobStore 契约。两端实现；save 为按 jobId 的 upsert 且幂等。 */
export interface JobStore {
    get(jobId: string): ScheduledJob | undefined;
    /** 取所有到点且未处理（status=pending 且 dueAt<=now），按 dueAt 升序。 */
    due(now: number, limit?: number): ScheduledJob[];
    save(job: ScheduledJob): void;
    list(sessionId: string, limit?: number): ScheduledJob[];
}

export interface ReminderSpec {
    title: string;
    payload: string;
    dueAt: number;
}

const MAX_PAYLOAD = 4000;

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 严格解析 schedule_reminder 工具参数。
 * 接受两种时间写法（二选一）：
 *   - dueAt:   绝对 epoch ms
 *   - delayMs: 相对当前时间的毫秒数（模型更自然）
 * 必须给出且仅一种，否则报错——避免「0 毫秒后提醒」这类静默错误。
 */
export function parseReminder(raw: unknown, now: number, where = "schedule_reminder"): ReminderSpec {
    if (!isPlainObject(raw)) throw new Error(`[${where}] 参数必须是对象`);
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
    const dueAt = hasDueAt ? (raw.dueAt as number) : now + (raw.delayMs as number);
    if (!Number.isFinite(dueAt) || dueAt < 0) {
        throw new Error(`[${where}] 计算出的 dueAt 非法`);
    }
    return { title: raw.title.trim(), payload: raw.text, dueAt };
}

export interface CreateJobInput {
    jobId: string;
    sessionId: string;
    origin: EventOrigin;
    uid: number;
    kind: JobKind;
    title: string;
    payload: string;
    dueAt: number;
    recurrence?: JobRecurrence;
    now: number;
}

export function createJob(input: CreateJobInput): ScheduledJob {
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
export function isDue(job: ScheduledJob, now: number): boolean {
    return job.status === "pending" && job.dueAt <= now;
}

/**
 * 计算下一次触发时间。once 返回 null（触发即结束）；daily 顺延 24h 直到
 * 严格大于 now（避免重启后补跑一堆过期任务，只跑最近一次）。
 */
export function computeNextRun(job: ScheduledJob, now: number): number | null {
    if (job.recurrence !== "daily") return null;
    const DAY = 24 * 60 * 60 * 1000;
    let next = job.dueAt + DAY;
    while (next <= now) next += DAY;
    return next;
}

/**
 * 触发一条 job：标记 fired 并记录 lastFiredAt；daily 任务顺延 dueAt 并回到 pending，
 * once 任务置 fired 终态。返回新对象。
 */
export function fireJob(job: ScheduledJob, now: number): ScheduledJob {
    const next = computeNextRun(job, now);
    return {
        ...job,
        status: next === null ? "fired" : "pending",
        dueAt: next ?? job.dueAt,
        lastFiredAt: now,
        updatedAt: now,
    };
}

export function cancelJob(job: ScheduledJob, now: number): ScheduledJob {
    return { ...job, status: "cancelled", updatedAt: now };
}

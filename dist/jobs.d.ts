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
/**
 * 严格解析 schedule_reminder 工具参数。
 * 接受两种时间写法（二选一）：
 *   - dueAt:   绝对 epoch ms
 *   - delayMs: 相对当前时间的毫秒数（模型更自然）
 * 必须给出且仅一种，否则报错——避免「0 毫秒后提醒」这类静默错误。
 */
export declare function parseReminder(raw: unknown, now: number, where?: string): ReminderSpec;
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
export declare function createJob(input: CreateJobInput): ScheduledJob;
/** 到点判定：pending 且 dueAt 已过。 */
export declare function isDue(job: ScheduledJob, now: number): boolean;
/**
 * 计算下一次触发时间。once 返回 null（触发即结束）；daily 顺延 24h 直到
 * 严格大于 now（避免重启后补跑一堆过期任务，只跑最近一次）。
 */
export declare function computeNextRun(job: ScheduledJob, now: number): number | null;
/**
 * 触发一条 job：标记 fired 并记录 lastFiredAt；daily 任务顺延 dueAt 并回到 pending，
 * once 任务置 fired 终态。返回新对象。
 */
export declare function fireJob(job: ScheduledJob, now: number): ScheduledJob;
export declare function cancelJob(job: ScheduledJob, now: number): ScheduledJob;

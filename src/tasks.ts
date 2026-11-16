// src/tasks.ts
// 阶段 C：线性任务（plan）的纯逻辑。
//
// 边界（用户拍板）：本模块只放「类型 + 状态机 + 严格解析」，不碰 DB。
// 落库由两端注入 TaskStore 实现（与 EventStore 同构），保证核心版与桌宠版
// 写同一份 pet_sessions.db 时 schema 不分叉。
//
// 不引入 DAG，只做线性 steps（设计文档 §3）：一个任务是一串有序列步骤，
// 逐步推进直到全部 done。跨轮继续靠「未完成任务 = 未清偿欠账」实现。

import type { EventOrigin } from "./types";

/** 任务整体状态。cancelled/failed 为终态，不再推进。 */
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

/** 单步状态。skipped 用于错误后跳过，仍视为「已处理」。 */
export type TaskStepStatus = "pending" | "running" | "done" | "failed" | "skipped";

/**
 * 步骤种类：
 *   - tool     调一个已有工具（toolName + toolArgs），结果回灌
 *   - reminder 落一条定时提醒（text + dueAt），走 scheduled_jobs
 *   - text     仅需模型输出一段文字确认，无外部副作用
 */
export type TaskStepKind = "tool" | "reminder" | "text";

/** 模型 plan 工具声明的一步（解析后、落库前，不含运行期状态）。 */
export interface TaskStepSpec {
    kind: TaskStepKind;
    label: string;
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    text?: string;
    dueAt?: number;
}

/** 落库后的一步，带运行期状态与结果。 */
export interface TaskStep extends TaskStepSpec {
    id: string;
    status: TaskStepStatus;
    result?: string;
}

/** 一条持久化任务。 */
export interface Task {
    taskId: string;
    sessionId: string;
    turnId: string;
    origin: EventOrigin;
    uid: number;
    title: string;
    status: TaskStatus;
    steps: TaskStep[];
    currentStep: number;
    createdAt: number;
    updatedAt: number;
    completedAt?: number;
}

/**
 * TaskStore 契约。两端各自实现（sqlite / 内存），本包不 require 任何 DB 库。
 * save 必须是 upsert（按 taskId），并幂等——批量重试不会插出重复任务。
 */
export interface TaskStore {
    get(taskId: string): Task | undefined;
    /** 取某会话仍在推进中的任务（status pending/running），按 createdAt 升序。 */
    active(sessionId: string): Task[];
    save(task: Task): void;
    list(sessionId: string, limit?: number): Task[];
}

export interface CreateTaskInput {
    taskId: string;
    sessionId: string;
    turnId: string;
    origin: EventOrigin;
    uid: number;
    title: string;
    steps: TaskStepSpec[];
    now: number;
}

const MAX_STEPS = 20;
const KINDS: readonly TaskStepKind[] = ["tool", "reminder", "text"];

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 严格解析模型 plan 工具的参数。缺字段 / 坏值显式报错，绝不静默兜底
 * （与 profile.ts 同纪律：模型输出是外部输入，必须在边界校验）。
 */
export function parsePlan(raw: unknown, where = "plan"): { title: string; steps: TaskStepSpec[] } {
    if (!isPlainObject(raw)) throw new Error(`[${where}] 参数必须是对象`);
    const title = raw.title;
    if (typeof title !== "string" || title.trim().length === 0) {
        throw new Error(`[${where}] title 必须是非空字符串`);
    }
    if (!Array.isArray(raw.steps) || raw.steps.length === 0 || raw.steps.length > MAX_STEPS) {
        throw new Error(`[${where}] steps 必须是 1~${MAX_STEPS} 的数组`);
    }
    const steps: TaskStepSpec[] = raw.steps.map((s, i) => {
        const tag = `${where}.steps[${i}]`;
        if (!isPlainObject(s)) throw new Error(`[${tag}] 必须是对象`);
        const kind = s.kind;
        if (typeof kind !== "string" || !KINDS.includes(kind as TaskStepKind)) {
            throw new Error(`[${tag}] kind 必须是 tool/reminder/text`);
        }
        if (typeof s.label !== "string" || s.label.trim().length === 0) {
            throw new Error(`[${tag}] label 必须是非空字符串`);
        }
        const spec: TaskStepSpec = { kind: kind as TaskStepKind, label: s.label };
        if (kind === "tool") {
            if (typeof s.toolName !== "string" || s.toolName.trim().length === 0) {
                throw new Error(`[${tag}] tool 步骤必须有 toolName`);
            }
            spec.toolName = s.toolName;
            spec.toolArgs = isPlainObject(s.toolArgs) ? s.toolArgs : {};
        } else if (kind === "reminder") {
            if (typeof s.text !== "string" || s.text.trim().length === 0) {
                throw new Error(`[${tag}] reminder 步骤必须有 text`);
            }
            spec.text = s.text;
            if (typeof s.dueAt === "number" && Number.isFinite(s.dueAt)) spec.dueAt = s.dueAt;
        }
        return spec;
    });
    return { title: title.trim(), steps };
}

/** 从解析后的 plan 生成一条 pending 任务。step id 稳定为 `${taskId}:s${序号}`。 */
export function createTask(input: CreateTaskInput): Task {
    const steps: TaskStep[] = input.steps.map((spec, i) => ({
        ...spec,
        id: `${input.taskId}:s${i + 1}`,
        status: "pending",
    }));
    return {
        taskId: input.taskId,
        sessionId: input.sessionId,
        turnId: input.turnId,
        origin: input.origin,
        uid: input.uid,
        title: input.title,
        status: steps.length ? "pending" : "completed",
        steps,
        currentStep: 0,
        createdAt: input.now,
        updatedAt: input.now,
    };
}

/** 任务是否仍在推进中。 */
export function isTaskActive(task: Task): boolean {
    return task.status === "pending" || task.status === "running";
}

/** 任务是否全部步骤处理完毕。 */
export function isTaskComplete(task: Task): boolean {
    return task.status === "completed" || task.steps.every((s) => s.status === "done" || s.status === "skipped");
}

/** 返回下一个尚未处理的步骤（线性顺序）。 */
export function nextPendingStep(task: Task): TaskStep | undefined {
    return task.steps.find((s) => s.status === "pending" || s.status === "running");
}

/** 当前所有「欠账」步骤 id，供 runner.note() 记账保持 turn 打开。 */
export function pendingStepIds(task: Task): string[] {
    return task.steps.filter((s) => s.status === "pending" || s.status === "running").map((s) => s.id);
}

/**
 * 推进指定的一步。成功 ok=true 记 done，否则 failed；自动推进 currentStep
 * 到下一个未处理步骤，全部完成时把任务置 completed 并记 completedAt。
 * 返回新对象，不原地修改（便于测试断言与事件回放）。
 */
export function advanceTask(
    task: Task,
    stepId: string,
    ok: boolean,
    result: string | undefined,
    now: number,
): Task {
    const idx = task.steps.findIndex((s) => s.id === stepId);
    if (idx < 0) throw new Error(`[advanceTask] 未知步骤 ${stepId}`);
    const steps = task.steps.map((s, i) =>
        i === idx ? { ...s, status: (ok ? "done" : "failed") as TaskStepStatus, result } : { ...s },
    );
    const next = steps.findIndex((s) => s.status === "pending" || s.status === "running");
    const complete = next < 0;
    return {
        ...task,
        steps,
        status: complete ? "completed" : "running",
        currentStep: complete ? steps.length : next,
        updatedAt: now,
        completedAt: complete ? now : task.completedAt,
    };
}

/** 取消任务（用户改主意 / 进程收尾）。 */
export function cancelTask(task: Task, now: number): Task {
    return { ...task, status: "cancelled", updatedAt: now };
}

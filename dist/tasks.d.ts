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
/**
 * 严格解析模型 plan 工具的参数。缺字段 / 坏值显式报错，绝不静默兜底
 * （与 profile.ts 同纪律：模型输出是外部输入，必须在边界校验）。
 */
export declare function parsePlan(raw: unknown, where?: string): {
    title: string;
    steps: TaskStepSpec[];
};
/** 从解析后的 plan 生成一条 pending 任务。step id 稳定为 `${taskId}:s${序号}`。 */
export declare function createTask(input: CreateTaskInput): Task;
/** 任务是否仍在推进中。 */
export declare function isTaskActive(task: Task): boolean;
/** 任务是否全部步骤处理完毕。 */
export declare function isTaskComplete(task: Task): boolean;
/** 返回下一个尚未处理的步骤（线性顺序）。 */
export declare function nextPendingStep(task: Task): TaskStep | undefined;
/** 当前所有「欠账」步骤 id，供 runner.note() 记账保持 turn 打开。 */
export declare function pendingStepIds(task: Task): string[];
/**
 * 推进指定的一步。成功 ok=true 记 done，否则 failed；自动推进 currentStep
 * 到下一个未处理步骤，全部完成时把任务置 completed 并记 completedAt。
 * 返回新对象，不原地修改（便于测试断言与事件回放）。
 */
export declare function advanceTask(task: Task, stepId: string, ok: boolean, result: string | undefined, now: number): Task;
/** 取消任务（用户改主意 / 进程收尾）。 */
export declare function cancelTask(task: Task, now: number): Task;

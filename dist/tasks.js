"use strict";
// src/tasks.ts
// 阶段 C：线性任务（plan）的纯逻辑。
//
// 边界（用户拍板）：本模块只放「类型 + 状态机 + 严格解析」，不碰 DB。
// 落库由两端注入 TaskStore 实现（与 EventStore 同构），保证核心版与桌宠版
// 写同一份 pet_sessions.db 时 schema 不分叉。
//
// 不引入 DAG，只做线性 steps（设计文档 §3）：一个任务是一串有序列步骤，
// 逐步推进直到全部 done。跨轮继续靠「未完成任务 = 未清偿欠账」实现。
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePlan = parsePlan;
exports.createTask = createTask;
exports.isTaskActive = isTaskActive;
exports.isTaskComplete = isTaskComplete;
exports.nextPendingStep = nextPendingStep;
exports.pendingStepIds = pendingStepIds;
exports.advanceTask = advanceTask;
exports.cancelTask = cancelTask;
const MAX_STEPS = 20;
const KINDS = ["tool", "reminder", "text"];
function isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
/**
 * 严格解析模型 plan 工具的参数。缺字段 / 坏值显式报错，绝不静默兜底
 * （与 profile.ts 同纪律：模型输出是外部输入，必须在边界校验）。
 */
function parsePlan(raw, where = "plan") {
    if (!isPlainObject(raw))
        throw new Error(`[${where}] 参数必须是对象`);
    const title = raw.title;
    if (typeof title !== "string" || title.trim().length === 0) {
        throw new Error(`[${where}] title 必须是非空字符串`);
    }
    if (!Array.isArray(raw.steps) || raw.steps.length === 0 || raw.steps.length > MAX_STEPS) {
        throw new Error(`[${where}] steps 必须是 1~${MAX_STEPS} 的数组`);
    }
    const steps = raw.steps.map((s, i) => {
        const tag = `${where}.steps[${i}]`;
        if (!isPlainObject(s))
            throw new Error(`[${tag}] 必须是对象`);
        const kind = s.kind;
        if (typeof kind !== "string" || !KINDS.includes(kind)) {
            throw new Error(`[${tag}] kind 必须是 tool/reminder/text`);
        }
        if (typeof s.label !== "string" || s.label.trim().length === 0) {
            throw new Error(`[${tag}] label 必须是非空字符串`);
        }
        const spec = { kind: kind, label: s.label };
        if (kind === "tool") {
            if (typeof s.toolName !== "string" || s.toolName.trim().length === 0) {
                throw new Error(`[${tag}] tool 步骤必须有 toolName`);
            }
            spec.toolName = s.toolName;
            spec.toolArgs = isPlainObject(s.toolArgs) ? s.toolArgs : {};
        }
        else if (kind === "reminder") {
            if (typeof s.text !== "string" || s.text.trim().length === 0) {
                throw new Error(`[${tag}] reminder 步骤必须有 text`);
            }
            spec.text = s.text;
            if (typeof s.dueAt === "number" && Number.isFinite(s.dueAt))
                spec.dueAt = s.dueAt;
        }
        return spec;
    });
    return { title: title.trim(), steps };
}
/** 从解析后的 plan 生成一条 pending 任务。step id 稳定为 `${taskId}:s${序号}`。 */
function createTask(input) {
    const steps = input.steps.map((spec, i) => ({
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
function isTaskActive(task) {
    return task.status === "pending" || task.status === "running";
}
/** 任务是否全部步骤处理完毕。 */
function isTaskComplete(task) {
    return task.status === "completed" || task.steps.every((s) => s.status === "done" || s.status === "skipped");
}
/** 返回下一个尚未处理的步骤（线性顺序）。 */
function nextPendingStep(task) {
    return task.steps.find((s) => s.status === "pending" || s.status === "running");
}
/** 当前所有「欠账」步骤 id，供 runner.note() 记账保持 turn 打开。 */
function pendingStepIds(task) {
    return task.steps.filter((s) => s.status === "pending" || s.status === "running").map((s) => s.id);
}
/**
 * 推进指定的一步。成功 ok=true 记 done，否则 failed；自动推进 currentStep
 * 到下一个未处理步骤，全部完成时把任务置 completed 并记 completedAt。
 * 返回新对象，不原地修改（便于测试断言与事件回放）。
 */
function advanceTask(task, stepId, ok, result, now) {
    const idx = task.steps.findIndex((s) => s.id === stepId);
    if (idx < 0)
        throw new Error(`[advanceTask] 未知步骤 ${stepId}`);
    const steps = task.steps.map((s, i) => i === idx ? { ...s, status: (ok ? "done" : "failed"), result } : { ...s });
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
function cancelTask(task, now) {
    return { ...task, status: "cancelled", updatedAt: now };
}
//# sourceMappingURL=tasks.js.map
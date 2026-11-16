import { describe, it, expect } from "vitest";
import {
    parsePlan,
    createTask,
    advanceTask,
    nextPendingStep,
    isTaskActive,
    isTaskComplete,
    cancelTask,
    type TaskStore,
    type Task,
} from "./tasks";

const NOW = 1_700_000_000_000;

function makeTask(): Task {
    const plan = parsePlan({
        title: "查天气再提醒带伞",
        steps: [
            { kind: "tool", label: "查询天气", toolName: "get_weather", toolArgs: { city: "上海" } },
            { kind: "reminder", label: "提醒带伞", text: "要下雨了，记得带伞", delayMs: 60000 },
        ],
    });
    return createTask({
        taskId: "t-1",
        sessionId: "s-1",
        turnId: "turn-1",
        origin: "core",
        uid: 1,
        title: plan.title,
        steps: plan.steps,
        now: NOW,
    });
}

describe("parsePlan 严格校验（外部输入边界）", () => {
    it("合法 plan 解析出保真的 steps", () => {
        const p = parsePlan({
            title: "  多步任务  ",
            steps: [
                { kind: "tool", label: "查", toolName: "get_weather" },
                { kind: "reminder", label: "提醒", text: "带伞", dueAt: 123 },
                { kind: "text", label: "说明" },
            ],
        });
        expect(p.title).toBe("多步任务");
        expect(p.steps).toHaveLength(3);
        expect(p.steps[0].toolName).toBe("get_weather");
        expect(p.steps[0].toolArgs).toEqual({});
        expect(p.steps[1].dueAt).toBe(123);
    });

    it("非对象 / 空标题 / 空 steps 均报错", () => {
        expect(() => parsePlan(null)).toThrow(/必须是对象/);
        expect(() => parsePlan({ title: "", steps: [] })).toThrow(/title/);
        expect(() => parsePlan({ title: "x", steps: [] })).toThrow(/steps/);
    });

    it("tool 步骤缺 toolName、reminder 缺 text 均报错", () => {
        expect(() => parsePlan({ title: "x", steps: [{ kind: "tool", label: "a" }] })).toThrow(/toolName/);
        expect(() => parsePlan({ title: "x", steps: [{ kind: "reminder", label: "a" }] })).toThrow(/text/);
    });

    it("非法 kind / 超过上限报错", () => {
        expect(() => parsePlan({ title: "x", steps: [{ kind: "bogus", label: "a" }] })).toThrow(/kind/);
        const many = Array.from({ length: 21 }, () => ({ kind: "text", label: "a" }));
        expect(() => parsePlan({ title: "x", steps: many })).toThrow(/1~20/);
    });
});

describe("任务状态机（线性 plan）", () => {
    it("createTask 生成稳定 step id 且初始 pending", () => {
        const t = makeTask();
        expect(t.status).toBe("pending");
        expect(t.steps.map((s) => s.id)).toEqual(["t-1:s1", "t-1:s2"]);
        expect(isTaskActive(t)).toBe(true);
        expect(isTaskComplete(t)).toBe(false);
        expect(nextPendingStep(t)?.id).toBe("t-1:s1");
    });

    it("advanceTask 逐步推进，全部 done 后任务 completed", () => {
        let t = makeTask();
        t = advanceTask(t, "t-1:s1", true, "晴", NOW + 1);
        expect(t.status).toBe("running");
        expect(nextPendingStep(t)?.id).toBe("t-1:s2");
        t = advanceTask(t, "t-1:s2", true, "已提醒", NOW + 2);
        expect(t.status).toBe("completed");
        expect(isTaskComplete(t)).toBe(true);
        expect(isTaskActive(t)).toBe(false);
        expect(t.completedAt).toBe(NOW + 2);
    });

    it("某步 failed 仍推进 currentStep（不阻塞后续）", () => {
        let t = makeTask();
        t = advanceTask(t, "t-1:s1", false, "工具失败", NOW + 1);
        expect(t.steps[0].status).toBe("failed");
        expect(nextPendingStep(t)?.id).toBe("t-1:s2");
    });

    it("advanceTask 不原地修改入参", () => {
        const t = makeTask();
        const snapshot = JSON.stringify(t);
        advanceTask(t, "t-1:s1", true, "ok", NOW + 1);
        expect(JSON.stringify(t)).toBe(snapshot);
    });

    it("cancelTask 置终态 cancelled", () => {
        const t = cancelTask(makeTask(), NOW + 1);
        expect(t.status).toBe("cancelled");
        expect(isTaskActive(t)).toBe(false);
    });

    it("未知 step id 报错", () => {
        expect(() => advanceTask(makeTask(), "nope", true, "", NOW)).toThrow(/未知步骤/);
    });
});

describe("TaskStore 契约（内存实现，验证两端注入形状可用）", () => {
    it("active 只返回 pending/running 且按 createdAt 升序", () => {
        const store = new InMemoryTaskStore();
        const done = advanceTask(advanceTask(makeTask(), "t-1:s1", true, "", NOW + 1), "t-1:s2", true, "", NOW + 2);
        store.save({ ...done, taskId: "done-1" });
        store.save({ ...makeTask(), taskId: "late-1", createdAt: NOW + 100 });
        store.save({ ...makeTask(), taskId: "early-1", createdAt: NOW - 100 });
        const active = store.active("s-1");
        expect(active.map((t) => t.taskId)).toEqual(["early-1", "late-1"]);
    });
});

class InMemoryTaskStore implements TaskStore {
    private map = new Map<string, Task>();
    get(id: string) { return this.map.get(id); }
    active(sessionId: string): Task[] {
        return [...this.map.values()]
            .filter((t) => t.sessionId === sessionId && isTaskActive(t))
            .sort((a, b) => a.createdAt - b.createdAt);
    }
    save(task: Task) { this.map.set(task.taskId, task); } // upsert 幂等
    list(sessionId: string, limit = 100): Task[] {
        return [...this.map.values()].filter((t) => t.sessionId === sessionId).slice(0, limit);
    }
}

import { describe, it, expect } from "vitest";
import {
    parseReminder,
    createJob,
    isDue,
    computeNextRun,
    fireJob,
    cancelJob,
    type ScheduledJob,
    type JobStore,
} from "./jobs";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function makeJob(over: Partial<Parameters<typeof createJob>[0]> = {}): ScheduledJob {
    return createJob({
        jobId: "j-1",
        sessionId: "s-1",
        origin: "core",
        uid: 1,
        kind: "reminder",
        title: "带伞提醒",
        payload: "要下雨了",
        dueAt: NOW + 1000,
        now: NOW,
        ...over,
    });
}

describe("parseReminder 严格校验", () => {
    it("绝对 dueAt 解析", () => {
        expect(parseReminder({ title: " t ", text: "正文", dueAt: 999 }, NOW)).toEqual({
            title: "t", payload: "正文", dueAt: 999,
        });
    });

    it("相对 delayMs 解析为 now + delay", () => {
        expect(parseReminder({ title: "t", text: "正文", delayMs: 5000 }, NOW).dueAt).toBe(NOW + 5000);
    });

    it("两种时间都给 / 都不给 → 报错", () => {
        expect(() => parseReminder({ title: "t", text: "x", dueAt: 1, delayMs: 2 }, NOW)).toThrow(/只能提供/);
        expect(() => parseReminder({ title: "t", text: "x" }, NOW)).toThrow(/只能提供/);
    });

    it("缺标题 / 空正文 / 超长 → 报错", () => {
        expect(() => parseReminder({ title: "", text: "x", delayMs: 1 }, NOW)).toThrow(/title/);
        expect(() => parseReminder({ title: "t", text: "", delayMs: 1 }, NOW)).toThrow(/text/);
        expect(() => parseReminder({ title: "t", text: "x".repeat(4001), delayMs: 1 }, NOW)).toThrow(/4000/);
    });
});

describe("定时任务状态机", () => {
    it("isDue：pending 且到点", () => {
        expect(isDue(makeJob(), NOW)).toBe(false);
        expect(isDue(makeJob(), NOW + 1000)).toBe(true);
        expect(isDue({ ...makeJob(), status: "fired" }, NOW + 5000)).toBe(false);
    });

    it("once 任务触发后置 fired 终态", () => {
        const fired = fireJob(makeJob(), NOW + 1000);
        expect(fired.status).toBe("fired");
        expect(fired.lastFiredAt).toBe(NOW + 1000);
        expect(computeNextRun(makeJob(), NOW)).toBeNull();
    });

    it("daily 任务触发后顺延到次日且严格大于 now（不补跑过期）", () => {
        const daily = makeJob({ recurrence: "daily", dueAt: NOW - 10 * DAY });
        const next = computeNextRun(daily, NOW);
        expect(next).not.toBeNull();
        expect(next! > NOW).toBe(true);
        const fired = fireJob(daily, NOW);
        expect(fired.status).toBe("pending");
        expect(fired.dueAt).toBe(next);
    });

    it("cancelJob 置 cancelled", () => {
        expect(cancelJob(makeJob(), NOW).status).toBe("cancelled");
    });
});

describe("JobStore 契约", () => {
    it("due 只返回到点 pending，按 dueAt 升序，受 limit 约束", () => {
        const store = new InMemoryJobStore();
        store.save(makeJob({ jobId: "late", dueAt: NOW + 5000 }));
        store.save(makeJob({ jobId: "early", dueAt: NOW + 10 }));
        store.save(makeJob({ jobId: "future", dueAt: NOW + DAY }));
        expect(store.due(NOW + 10000).map((j) => j.jobId)).toEqual(["early", "late"]);
        expect(store.due(NOW + 10000, 1).map((j) => j.jobId)).toEqual(["early"]);
    });
});

class InMemoryJobStore implements JobStore {
    private map = new Map<string, ScheduledJob>();
    get(id: string) { return this.map.get(id); }
    due(now: number, limit = 100): ScheduledJob[] {
        return [...this.map.values()]
            .filter((j) => j.status === "pending" && j.dueAt <= now)
            .sort((a, b) => a.dueAt - b.dueAt)
            .slice(0, limit);
    }
    save(job: ScheduledJob) { this.map.set(job.jobId, job); } // upsert 幂等
    list(sessionId: string, limit = 100): ScheduledJob[] {
        return [...this.map.values()].filter((j) => j.sessionId === sessionId).slice(0, limit);
    }
}

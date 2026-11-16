import { describe, it, expect } from "vitest";
import { AgentRunner, type AgentStepResult } from "./runner";
import { DEFAULT_AGENT_PROFILE } from "./profile";

const profile = { ...DEFAULT_AGENT_PROFILE, maxRounds: 3 };

interface FakeReply {
    text: string;
}

describe("AgentRunner 停止条件语义化（hasDebt 决定继续，maxRounds 熔断）", () => {
    it("首轮即产出文本 → 一轮收尾", async () => {
        const runner = new AgentRunner<FakeReply>(profile);
        let stepCount = 0;
        const result = await runner.run(async () => {
            stepCount++;
            return { kind: "final", value: { text: "你好" } };
        });
        expect(result.text).toBe("你好");
        expect(stepCount).toBe(1);
        expect(runner.round).toBe(0);
    });

    it("两轮工具调用后产出文本 → 三轮收尾，欠账逐轮回灌", async () => {
        const runner = new AgentRunner<FakeReply>(profile);
        const toolRounds: number[] = [];
        const result = await runner.run(async (round, r) => {
            if (round < 2) {
                const id = `tc-${round}`;
                toolRounds.push(round);
                r.note([id]);
                // 模拟工具执行并回灌
                r.settle(id);
                return { kind: "tools", toolCallIds: [id] } as AgentStepResult<FakeReply>;
            }
            return { kind: "final", value: { text: "完成" } };
        });
        expect(result.text).toBe("完成");
        expect(toolRounds).toEqual([0, 1]);
        expect(runner.round).toBe(2);
        expect(runner.hasDebt()).toBe(false);
    });

    it("账本 note 后未 settle → 拒绝进入下一轮并显式报错", async () => {
        const runner = new AgentRunner<FakeReply>(profile);
        await expect(
            runner.run(async () => {
                runner.note(["tc-leak"]);
                return { kind: "tools", toolCallIds: ["tc-leak"] };
            }),
        ).rejects.toThrow(/未回灌/);
    });

    it("收尾时仍有欠账 → 拒绝关闭 turn", async () => {
        const runner = new AgentRunner<FakeReply>(profile);
        await expect(
            runner.run(async () => {
                runner.note(["tc-dirty"]);
                return { kind: "final", value: { text: "不该成功" } };
            }),
        ).rejects.toThrow(/收尾时仍有 1 个未回灌/);
    });

    it("工具轮未领取任何 tool_call → 拒绝空转", async () => {
        const runner = new AgentRunner<FakeReply>(profile);
        await expect(
            runner.run(async () => ({ kind: "tools", toolCallIds: [] })),
        ).rejects.toThrow(/没有领取任何 tool_call/);
    });

    it("欠账连续产生到上限 → 抛出与原实现逐字一致的错误", async () => {
        const runner = new AgentRunner<FakeReply>(profile);
        let stepCount = 0;
        await expect(
            runner.run(async (round, r) => {
                stepCount++;
                const id = `tc-${round}`;
                r.note([id]);
                r.settle(id);
                return { kind: "tools", toolCallIds: [id] };
            }),
        ).rejects.toThrow("工具调用轮次过多，未能生成最终回复");
        expect(stepCount).toBe(profile.maxRounds);
    });

    it("step 抛错原样冒泡，runner 不吞错、不改文案", async () => {
        const runner = new AgentRunner<FakeReply>(profile);
        const boom = new Error("模型返回内容为空");
        await expect(
            runner.run(async () => {
                throw boom;
            }),
        ).rejects.toBe(boom);
    });

    // ── 阶段 C：continue 让未完成任务保持 turn 打开 ──
    it("continue 逐轮推进任务，最后一轮收尾", async () => {
        const runner = new AgentRunner<FakeReply>(profile);
        const rounds: number[] = [];
        const result = await runner.run(async (round) => {
            rounds.push(round);
            if (round < 2) return { kind: "continue", reason: "还有任务步骤" };
            return { kind: "final", value: { text: "任务全部完成" } };
        });
        expect(result.text).toBe("任务全部完成");
        expect(rounds).toEqual([0, 1, 2]);
        expect(runner.hasDebt()).toBe(false);
    });

    it("continue 与 tools 混合：先推进任务再调工具", async () => {
        const runner = new AgentRunner<FakeReply>(profile);
        const seq: string[] = [];
        const result = await runner.run(async (round, r) => {
            if (round === 0) {
                seq.push("continue");
                return { kind: "continue", reason: "任务待执行" };
            }
            if (round === 1) {
                seq.push("tools");
                r.note(["tc"]);
                r.settle("tc");
                return { kind: "tools", toolCallIds: ["tc"] };
            }
            seq.push("final");
            return { kind: "final", value: { text: "done" } };
        });
        expect(result.text).toBe("done");
        expect(seq).toEqual(["continue", "tools", "final"]);
    });

    it("任务一路 continue 到熔断上限 → 抛逐字一致的熔断错误", async () => {
        const runner = new AgentRunner<FakeReply>(profile);
        let stepCount = 0;
        await expect(
            runner.run(async () => {
                stepCount++;
                return { kind: "continue", reason: "任务一直没完成" };
            }),
        ).rejects.toThrow("工具调用轮次过多，未能生成最终回复");
        expect(stepCount).toBe(profile.maxRounds);
    });
});

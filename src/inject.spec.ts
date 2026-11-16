import { describe, expect, it } from "vitest";
import { buildSystemContent, concatInjects, createInjector } from "./inject";
import type { EventInput } from "./types";

// 四段样本刻意保留各自的前导 \n\n —— 原代码就是靠段内换行分隔的，
// 拼接函数一个字符都不能多给。
const FOUR = [
    { source: "system.base", content: "你是 Kirari。请如实作答。" },
    { source: "daily_brief", content: "\n\n【今日背景 · 已自动了解】\n日期：2026-11-14\n晴" },
    { source: "knowledge", content: "\n\n【知识库 · 检索到的参考信息】\n- （来源：A）条目" },
    { source: "skills", content: "\n\n# 已启用的技能（请遵循以下设定）\n【技能：甲】\n设定一\n\n【技能：乙】\n设定二" },
] as const;

describe("inject 逐字等价", () => {
    it("① 四段拼接 === 原字符串相加；空块、乱序传入都不改变结果", () => {
        const segments = FOUR.map((s, i) => ({ ...s, order: i, meta: {} }));
        const original = FOUR.map((s) => s.content).join("");

        expect(buildSystemContent(segments)).toBe(original);
        expect(buildSystemContent(segments.map((s) => ({ ...s, content: "" })))).toBe("");

        // 打乱传入顺序，仍按 order 拼接（order 由 source 决定，不由调用顺序决定）
        const shuffled = [segments[3], segments[0], segments[2], segments[1]];
        expect(buildSystemContent(shuffled)).toBe(original);
    });

    it("⑩ concatInjects 段间不产生任何额外字符", () => {
        const segments = [
            { source: "system.base" as const, content: "A", order: 0, meta: {} },
            { source: "daily_brief" as const, content: "B", order: 1, meta: {} },
        ];
        expect(concatInjects(segments)).toBe("AB");
        expect(concatInjects(segments)).not.toBe("A\nB");
        expect(concatInjects([])).toBe("");
    });

    it("inject 按 source 固定 order，并为每段落一条 context_inject 事件", () => {
        const got: EventInput[] = [];
        const injector = createInjector({
            origin: "core",
            sessionId: "s1",
            turnId: "t1",
            enqueue: (e) => got.push(e),
        });

        for (const s of FOUR) injector.inject(s.source, s.content, { failed: false });

        expect(got).toHaveLength(4);
        expect(got.map((e) => e.type)).toEqual(Array(4).fill("context_inject"));
        expect(got.map((e) => (e.payload as { order: number }).order)).toEqual([0, 1, 2, 3]);
        expect(got.map((e) => (e.payload as { source: string }).source)).toEqual(
            FOUR.map((s) => s.source),
        );
        expect(injector.segments).toHaveLength(4);
        expect(got.every((e) => e.sessionId === "s1" && e.turnId === "t1" && e.origin === "core")).toBe(true);
    });
});

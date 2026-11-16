import { describe, expect, it } from "vitest";
import {
    CapabilityRegistry,
    DEFAULT_CAPABILITY_TIMEOUT_MS,
    DEFAULT_CAPABILITY_TRUNCATE_CHARS,
    MAX_CAPABILITIES,
    defineCapability,
    parseCapability,
    scopeKey,
    toOpenAITool,
    truncateResult,
} from "./capability";

const builtin = (over: Record<string, unknown> = {}) =>
    defineCapability({
        id: "get_weather",
        kind: "tool",
        scope: "builtin",
        name: "get_weather",
        description: "查天气",
        ...over,
    });

describe("parseCapability 严格校验", () => {
    it("必填字段齐全时补齐默认 timeout/truncate", () => {
        const c = parseCapability({
            id: "x",
            kind: "tool",
            scope: "builtin",
            name: "x",
            description: "d",
        });
        expect(c.timeoutMs).toBe(DEFAULT_CAPABILITY_TIMEOUT_MS);
        expect(c.truncateChars).toBe(DEFAULT_CAPABILITY_TRUNCATE_CHARS);
        expect(c.tags).toBeUndefined();
    });

    it("非法 kind / scope 报错", () => {
        expect(() =>
            parseCapability({ id: "x", kind: "bad", scope: "builtin", name: "x", description: "d" }),
        ).toThrow(/kind/);
        expect(() =>
            parseCapability({ id: "x", kind: "tool", scope: "bad", name: "x", description: "d" }),
        ).toThrow(/scope/);
    });

    it("缺 name / description / id 报错", () => {
        expect(() =>
            parseCapability({ id: "", kind: "tool", scope: "builtin", name: "x", description: "d" }),
        ).toThrow(/id/);
        expect(() =>
            parseCapability({ id: "x", kind: "tool", scope: "builtin", name: "", description: "d" }),
        ).toThrow(/name/);
        expect(() =>
            parseCapability({ id: "x", kind: "tool", scope: "builtin", name: "x", description: "" }),
        ).toThrow(/description/);
    });

    it("timeout/truncate 越界报错，tags 必须是字符串数组", () => {
        expect(() =>
            parseCapability({
                id: "x", kind: "tool", scope: "builtin", name: "x", description: "d", timeoutMs: 0,
            }),
        ).toThrow(/timeoutMs/);
        expect(() =>
            parseCapability({
                id: "x", kind: "tool", scope: "builtin", name: "x", description: "d", truncateChars: -1,
            }),
        ).toThrow(/truncateChars/);
        expect(() =>
            parseCapability({
                id: "x", kind: "tool", scope: "builtin", name: "x", description: "d", tags: [1, 2],
            }),
        ).toThrow(/tags/);
    });

    it("parameters 必须是对象，tags 正常保留", () => {
        const c = parseCapability({
            id: "x", kind: "tool", scope: "builtin", name: "x", description: "d",
            parameters: { type: "object", properties: {} }, tags: ["a", "b"],
        });
        expect(c.parameters).toEqual({ type: "object", properties: {} });
        expect(c.tags).toEqual(["a", "b"]);
        expect(() =>
            parseCapability({
                id: "x", kind: "tool", scope: "builtin", name: "x", description: "d", parameters: 42,
            }),
        ).toThrow(/parameters/);
    });
});

describe("CapabilityRegistry scope 隔离", () => {
    it("connection 级能力按 scopeId 隔离，互不泄漏", () => {
        const reg = new CapabilityRegistry();
        const c1 = defineCapability({ id: "f1", kind: "tool", scope: "connection", name: "fa", description: "A" });
        const c2 = defineCapability({ id: "f2", kind: "tool", scope: "connection", name: "fb", description: "B" });
        reg.registerFor("conn-A", c1);
        reg.registerFor("conn-B", c2);
        expect(reg.list("conn-A").map((c) => c.name)).toContain("fa");
        expect(reg.list("conn-A").map((c) => c.name)).not.toContain("fb");
        expect(reg.list("conn-B").map((c) => c.name)).toContain("fb");
        expect(reg.list("conn-B").map((c) => c.name)).not.toContain("fa");
    });

    it("builtin/global 对所有 scope 可见，且 builtin 优先级最高", () => {
        const reg = new CapabilityRegistry();
        reg.register(builtin()); // name=get_weather, description=查天气
        reg.register(
            defineCapability({ id: "g1", kind: "tool", scope: "global", name: "get_weather", description: "全局同名" }),
        );
        reg.registerFor(
            "conn-A",
            defineCapability({ id: "c1", kind: "tool", scope: "connection", name: "get_weather", description: "连接同名" }),
        );
        const resolved = reg.resolve("conn-A", "get_weather");
        expect(resolved?.scope).toBe("builtin");
        expect(resolved?.description).toBe("查天气");
        // 去重后同名只出现一次
        expect(reg.list("conn-A").filter((c) => c.name === "get_weather")).toHaveLength(1);
    });

    it("resolve 严格按 scope 找归属，A 的名字不会在 B 桶命中", () => {
        const reg = new CapabilityRegistry();
        reg.registerFor("conn-A", defineCapability({ id: "f1", kind: "tool", scope: "connection", name: "fa", description: "A" }));
        expect(reg.resolve("conn-A", "fa")?.id).toBe("f1");
        expect(reg.resolve("conn-B", "fa")).toBeUndefined();
        expect(reg.has("conn-A", "fa")).toBe(true);
        expect(reg.has("conn-B", "fa")).toBe(false);
    });

    it("unregisterScope 清理整桶，不影响其它 scope", () => {
        const reg = new CapabilityRegistry();
        reg.registerFor("conn-A", defineCapability({ id: "f1", kind: "tool", scope: "connection", name: "fa", description: "A" }));
        reg.registerFor("conn-B", defineCapability({ id: "f2", kind: "tool", scope: "connection", name: "fb", description: "B" }));
        reg.unregisterScope("conn-A");
        expect(reg.list("conn-A")).toEqual([]);
        expect(reg.list("conn-B").map((c) => c.name)).toEqual(["fb"]);
    });

    it("list 白名单 / 标签过滤", () => {
        const reg = new CapabilityRegistry();
        reg.register(builtin()); // 无 tag
        reg.register(defineCapability({ id: "p", kind: "tool", scope: "builtin", name: "plan", description: "计划", tags: ["task"] }));
        expect(reg.list("any", { whitelist: ["plan"] }).map((c) => c.name)).toEqual(["plan"]);
        expect(reg.list("any", { tags: ["task"] }).map((c) => c.name)).toEqual(["plan"]);
        expect(reg.list("any", { excludeTags: ["task"] }).map((c) => c.name)).toEqual(["get_weather"]);
    });

    it("register 拒绝 connection 级，registerFor 拒绝非 connection 级", () => {
        const reg = new CapabilityRegistry();
        expect(() =>
            reg.register(defineCapability({ id: "f", kind: "tool", scope: "connection", name: "f", description: "f" })),
        ).toThrow(/registerFor/);
        expect(() =>
            reg.registerFor("s", builtin()),
        ).toThrow(/connection/);
    });

    it("容量上限防止无限膨胀", () => {
        const reg = new CapabilityRegistry();
        for (let i = 0; i < MAX_CAPABILITIES; i++)
            reg.register(builtin({ id: `c${i}`, name: `c${i}` }));
        expect(() => reg.register(builtin({ id: "over", name: "over" }))).toThrow(/超过/);
    });
});

describe("工具 schema 与截断策略", () => {
    it("toOpenAITool 产出标准 function schema", () => {
        const t = toOpenAITool(builtin());
        expect(t.type).toBe("function");
        expect(t.function.name).toBe("get_weather");
        expect(t.function.parameters).toEqual({ type: "object", properties: {} });
    });

    it("truncateResult 超限时截断并附标记，未超限原样返回", () => {
        expect(truncateResult("abc", 10)).toBe("abc");
        expect(truncateResult("abcdefgh", 3)).toContain("abc");
        expect(truncateResult("abcdefgh", 3)).toContain("结果已截断");
    });

    it("scopeKey 规范化拼接", () => {
        expect(scopeKey(" ws ", " conn-1 ")).toBe("ws::conn-1");
    });
});

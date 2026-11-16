import { describe, it, expect } from "vitest";
import {
    DEFAULT_AGENT_PROFILE,
    parseAgentProfile,
    getAgentProfileFromConfig,
    webSearchCapFor,
    computeLoopTimeout,
} from "./profile";

describe("AgentProfile 默认值与改造前逐字等价", () => {
    it("默认常量逐字等于原硬编码", () => {
        expect(DEFAULT_AGENT_PROFILE).toEqual({
            maxRounds: 5,
            webSearchCap: 4,
            correctionWebSearchCap: 2,
            maxTokens: 1500,
            timeoutFloorMs: 60000,
            timeoutPerRoundMs: 15000,
            timeoutCapMs: 120000,
        });
        expect(Object.isFrozen(DEFAULT_AGENT_PROFILE)).toBe(true);
    });

    it("computeLoopTimeout 与改造前公式逐字一致", () => {
        // 原：Math.min(120000, Math.max(baseTimeout, 60000) + MAX_ROUNDS * 15000)
        for (const base of [1000, 45000, 60000, 90000]) {
            const expected = Math.min(120000, Math.max(base, 60000) + 5 * 15000);
            expect(computeLoopTimeout(DEFAULT_AGENT_PROFILE, base)).toBe(expected);
        }
    });

    it("超时封顶生效", () => {
        expect(computeLoopTimeout(DEFAULT_AGENT_PROFILE, 999999)).toBe(120000);
    });

    it("webSearchCapFor 区分纠正模式", () => {
        expect(webSearchCapFor(DEFAULT_AGENT_PROFILE, false)).toBe(4);
        expect(webSearchCapFor(DEFAULT_AGENT_PROFILE, true)).toBe(2);
    });
});

describe("parseAgentProfile 严格校验（缺字段/坏值一律报错，不兜底）", () => {
    it("完整合法对象通过", () => {
        expect(parseAgentProfile({ ...DEFAULT_AGENT_PROFILE })).toEqual(DEFAULT_AGENT_PROFILE);
    });

    it("非对象报错", () => {
        expect(() => parseAgentProfile(null)).toThrow(/不是对象/);
        expect(() => parseAgentProfile([])).toThrow(/不是对象/);
        expect(() => parseAgentProfile("x")).toThrow(/不是对象/);
    });

    it("缺任一字段报错且不回退默认值", () => {
        for (const key of Object.keys(DEFAULT_AGENT_PROFILE)) {
            const bad: Record<string, unknown> = { ...DEFAULT_AGENT_PROFILE };
            delete bad[key];
            expect(() => parseAgentProfile(bad)).toThrow(new RegExp(`${key} 必须是整数`));
        }
    });

    it("类型错 / 非整数报错", () => {
        expect(() => parseAgentProfile({ ...DEFAULT_AGENT_PROFILE, maxRounds: "5" })).toThrow(/maxRounds 必须是整数/);
        expect(() => parseAgentProfile({ ...DEFAULT_AGENT_PROFILE, maxRounds: 2.5 })).toThrow(/maxRounds 必须是整数/);
        expect(() => parseAgentProfile({ ...DEFAULT_AGENT_PROFILE, maxTokens: NaN })).toThrow(/maxTokens 必须是整数/);
    });

    it("越界报错", () => {
        expect(() => parseAgentProfile({ ...DEFAULT_AGENT_PROFILE, maxRounds: 0 })).toThrow(/maxRounds 必须在/);
        expect(() => parseAgentProfile({ ...DEFAULT_AGENT_PROFILE, maxRounds: 51 })).toThrow(/maxRounds 必须在/);
        expect(() => parseAgentProfile({ ...DEFAULT_AGENT_PROFILE, webSearchCap: -1 })).toThrow(/webSearchCap 必须在/);
    });

    it("webSearchCap=0 合法（沿用原「>0 才检查」语义）", () => {
        expect(parseAgentProfile({ ...DEFAULT_AGENT_PROFILE, webSearchCap: 0 }).webSearchCap).toBe(0);
    });

    it("timeoutCap 小于 floor 报错", () => {
        expect(() =>
            parseAgentProfile({ ...DEFAULT_AGENT_PROFILE, timeoutCapMs: 1000, timeoutFloorMs: 60000 }),
        ).toThrow(/timeoutCapMs 不能小于 timeoutFloorMs/);
    });
});

describe("getAgentProfileFromConfig 缺键显式报错", () => {
    it("有 agentProfile 返回校验后的对象", () => {
        expect(getAgentProfileFromConfig({ agentProfile: { ...DEFAULT_AGENT_PROFILE } })).toEqual(DEFAULT_AGENT_PROFILE);
    });

    it("缺 agentProfile 报错，附带来源", () => {
        expect(() => getAgentProfileFromConfig({ model: "x" })).toThrow(/缺少 agentProfile/);
    });

    it("config 不是对象报错", () => {
        expect(() => getAgentProfileFromConfig(null)).toThrow(/不是对象/);
    });
});

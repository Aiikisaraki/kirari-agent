"use strict";
// src/profile.ts
// AgentProfile：把两端工具循环里散落的硬编码常量收敛成一份「可校验、两端同构」的配置。
//
// 为什么放共享包：用户拍板「两端跑同一个内核」，profile 的字段、默认值、校验规则
// 必须是同一份代码，否则「同一 profile 两端行为一致」无法成立。
//
// 红线：
//   - 运行期缺字段 / 类型错 = 显式报错，绝不静默用默认值兜底。
//   - DEFAULT_AGENT_PROFILE 只在「首次迁移写 config.json」时用一次，落盘后运行期只读文件。
//     这样既满足「缺配置显式报错」，又不让默认值变成架空配置的兜底常量。
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_AGENT_PROFILE = void 0;
exports.parseAgentProfile = parseAgentProfile;
exports.getAgentProfileFromConfig = getAgentProfileFromConfig;
exports.webSearchCapFor = webSearchCapFor;
exports.computeLoopTimeout = computeLoopTimeout;
/**
 * 默认 profile —— 数值逐字等于改造前两端的硬编码常量。
 * 仅供首次迁移写入 config.json 一次；两端运行期一律从配置读，不回退到这里的字段。
 */
exports.DEFAULT_AGENT_PROFILE = Object.freeze({
    maxRounds: 5,
    webSearchCap: 4,
    correctionWebSearchCap: 2,
    maxTokens: 1500,
    timeoutFloorMs: 60000,
    timeoutPerRoundMs: 15000,
    timeoutCapMs: 120000,
});
/** 字段合法区间。越界即报错，不夹紧、不兜底——配置错了要让用户看见。 */
const RANGES = {
    maxRounds: { min: 1, max: 50 },
    webSearchCap: { min: 0, max: 1000 },
    correctionWebSearchCap: { min: 0, max: 1000 },
    maxTokens: { min: 1, max: 1000000 },
    timeoutFloorMs: { min: 1000, max: 3600000 },
    timeoutPerRoundMs: { min: 0, max: 600000 },
    timeoutCapMs: { min: 1000, max: 7200000 },
};
function isPlainObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
/**
 * 严格校验一份 profile。任何字段缺失 / 类型错 / 越界都抛错，绝不返回部分默认值。
 * @param raw  待校验对象（通常来自 config.json 的 agentProfile 键）
 * @param where 出错信息里的来源标注，便于用户定位是哪一端配错
 */
function parseAgentProfile(raw, where = 'agentProfile') {
    if (!isPlainObject(raw)) {
        throw new Error(`${where} 缺失或不是对象：请检查 config.json 的 agentProfile 配置`);
    }
    const out = {};
    for (const key of Object.keys(RANGES)) {
        const value = raw[key];
        if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
            throw new Error(`${where}.${key} 必须是整数，收到：${JSON.stringify(value)}`);
        }
        const { min, max } = RANGES[key];
        if (value < min || value > max) {
            throw new Error(`${where}.${key} 必须在 ${min}~${max} 之间，收到：${value}`);
        }
        out[key] = value;
    }
    // 结构约束：封顶不能低于下限，否则 computeLoopTimeout 永远返回下限，配置形同虚设。
    if (out.timeoutCapMs < out.timeoutFloorMs) {
        throw new Error(`${where}.timeoutCapMs 不能小于 timeoutFloorMs`);
    }
    return out;
}
/** 由配置源取 profile：缺键 / 坏值都显式抛错，不回退默认值。 */
function getAgentProfileFromConfig(config, where = 'config.json') {
    if (!isPlainObject(config)) {
        throw new Error(`${where} 不是对象，无法读取 agentProfile`);
    }
    if (!('agentProfile' in config)) {
        throw new Error(`${where} 缺少 agentProfile：请在配置文件补上该段，或删除配置让程序重新生成`);
    }
    return parseAgentProfile(config.agentProfile, `${where}.agentProfile`);
}
/** 按纠正模式取 search 上限。0 表示不限制，调用方据此决定是否检查。 */
function webSearchCapFor(profile, correctionMode) {
    return correctionMode ? profile.correctionWebSearchCap : profile.webSearchCap;
}
/**
 * 计算本轮总超时：基线（随消息复杂度）至少给 timeoutFloorMs，
 * 再为每个工具轮次预留 timeoutPerRoundMs，最后用 timeoutCapMs 封顶。
 * 逐字等于改造前的 `Math.min(120000, Math.max(baseTimeout, 60000) + MAX_ROUNDS * 15000)`。
 */
function computeLoopTimeout(profile, baseTimeoutMs) {
    return Math.min(profile.timeoutCapMs, Math.max(baseTimeoutMs, profile.timeoutFloorMs) + profile.maxRounds * profile.timeoutPerRoundMs);
}
//# sourceMappingURL=profile.js.map
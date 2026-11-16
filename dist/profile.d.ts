/** 工具循环的可调参数。所有字段必填——运行期缺字段显式报错。 */
export interface AgentProfile {
    /** 工具调用循环最大轮数。语义是熔断上限，不是「必须跑满」。 */
    maxRounds: number;
    /** 普通模式 web_search 调用上限；0 = 不限制（沿用原 `webSearchCap > 0` 才检查的语义）。 */
    webSearchCap: number;
    /** 纠正意图（用户指出说错）时的 web_search 上限；0 = 不限制。 */
    correctionWebSearchCap: number;
    /** 单次模型请求 max_tokens。 */
    maxTokens: number;
    /** 超时下限（ms）：消息复杂度基线再短，也至少给这么多。 */
    timeoutFloorMs: number;
    /** 每个工具轮次追加的超时（ms）。 */
    timeoutPerRoundMs: number;
    /** 超时封顶（ms）。 */
    timeoutCapMs: number;
}
/**
 * 默认 profile —— 数值逐字等于改造前两端的硬编码常量。
 * 仅供首次迁移写入 config.json 一次；两端运行期一律从配置读，不回退到这里的字段。
 */
export declare const DEFAULT_AGENT_PROFILE: Readonly<AgentProfile>;
/**
 * 严格校验一份 profile。任何字段缺失 / 类型错 / 越界都抛错，绝不返回部分默认值。
 * @param raw  待校验对象（通常来自 config.json 的 agentProfile 键）
 * @param where 出错信息里的来源标注，便于用户定位是哪一端配错
 */
export declare function parseAgentProfile(raw: unknown, where?: string): AgentProfile;
/** 由配置源取 profile：缺键 / 坏值都显式抛错，不回退默认值。 */
export declare function getAgentProfileFromConfig(config: unknown, where?: string): AgentProfile;
/** 按纠正模式取 search 上限。0 表示不限制，调用方据此决定是否检查。 */
export declare function webSearchCapFor(profile: AgentProfile, correctionMode: boolean): number;
/**
 * 计算本轮总超时：基线（随消息复杂度）至少给 timeoutFloorMs，
 * 再为每个工具轮次预留 timeoutPerRoundMs，最后用 timeoutCapMs 封顶。
 * 逐字等于改造前的 `Math.min(120000, Math.max(baseTimeout, 60000) + MAX_ROUNDS * 15000)`。
 */
export declare function computeLoopTimeout(profile: AgentProfile, baseTimeoutMs: number): number;

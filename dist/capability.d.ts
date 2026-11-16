/** 能力种类。agent 预留（设计文档 §3 子 agent 后置），当前不实现 dispatch。 */
export type CapabilityKind = "tool" | "skill" | "agent";
/**
 * 能力作用域：
 *  - builtin    内置能力，schema 与执行都固定，所有 scope 可见
 *               （时间/天气/搜索/生图/load_skill）
 *  - global     配置驱动的全局能力，所有 scope 共享同一份（MCP / skill tools）
 *  - connection 按调用方/连接隔离，每个 scopeId 一份独立实例
 *               （frontend 工具、按 uid 绑定的执行器）
 */
export type CapabilityScope = "builtin" | "global" | "connection";
/** 默认策略，与两端历史值对齐：skillTools 4000 字符、bridge 30s。 */
export declare const DEFAULT_CAPABILITY_TIMEOUT_MS = 30000;
export declare const DEFAULT_CAPABILITY_TRUNCATE_CHARS = 4000;
export declare const MAX_CAPABILITY_TIMEOUT_MS = 120000;
export declare const MAX_CAPABILITY_TRUNCATE_CHARS = 50000;
export declare const MAX_CAPABILITIES = 200;
export declare const CAPABILITY_KINDS: readonly CapabilityKind[];
export declare const CAPABILITY_SCOPES: readonly CapabilityScope[];
/**
 * 一条能力的纯描述元数据。不含执行函数（dispatch 由两端按 id 另行持有）——
 * 这样本包保持纯逻辑，且同一份 schema 能被两端共用、不会出现两份分叉的描述。
 */
export interface Capability {
    /** 全局唯一 id，如 get_weather / mcp__srv__tool / skill__id__tool */
    id: string;
    kind: CapabilityKind;
    scope: CapabilityScope;
    /** 模型可见的函数名（通常等于 id；frontend 工具可能带 frontend__ 前缀） */
    name: string;
    description: string;
    /** JSON Schema（OpenAI function.parameters 形状） */
    parameters?: Record<string, unknown>;
    /** 统一超时（毫秒） */
    timeoutMs: number;
    /** 结果统一截断上限（字符数） */
    truncateChars: number;
    /** 语义标签，用于装配过滤，如 task / skill-loader */
    tags?: readonly string[];
}
/** 构造能力时的输入：timeout/truncate 可省略，由 defineCapability 填默认。 */
export type CapabilityInput = Omit<Capability, "timeoutMs" | "truncateChars"> & {
    timeoutMs?: number;
    truncateChars?: number;
};
/**
 * 严格解析一条能力。非法输入一律抛错（与 parseAgentProfile / parsePlan 同风格），
 * 不静默回填——能力契约一旦模糊，scope 隔离与截断策略就形同虚设。
 */
export declare function parseCapability(raw: unknown, where?: string): Capability;
/** 填默认值并做类型收窄；能力文件用它声明「一个能力一个文件」。 */
export declare function defineCapability(input: CapabilityInput): Capability;
/** 装配过滤：白名单/标签过滤。whitelist 按 name 匹配（对应 AgentProfile 的可选能力集）。 */
export interface ListCapabilitiesOptions {
    /** 只保留这些 name（白名单） */
    whitelist?: readonly string[];
    /** 只保留带这些 tag 之一的能力 */
    tags?: readonly string[];
    /** 排除带这些 tag 之一的能力 */
    excludeTags?: readonly string[];
}
/**
 * 统一能力注册表。两端各持一个实例，把 builtin / global 注册到公共桶，
 * 把 connection 级能力按 scopeId 分桶。这样每个客户端只看到自己的 frontend 工具，
 * 执行归属也按 scopeId 判定，彻底解决进程级单例互相覆盖。
 */
export declare class CapabilityRegistry {
    private readonly builtin;
    private readonly global;
    private readonly connections;
    /** 注册 builtin 或 global 能力。connection 级请用 registerFor。 */
    register(cap: Capability): void;
    /** 按 scopeId 注册一个 connection 级能力。 */
    registerFor(scopeId: string, cap: Capability): void;
    /** 连接关闭时整桶清理，避免残留能力被后续连接复用。 */
    unregisterScope(scopeId: string): void;
    /**
     * 列出该 scopeId 可见的能力（builtin + global + 该连接分桶），按 name 去重，
     * 优先级 builtin > global > connection——防止前端上报同名工具覆盖内置 schema。
     */
    list(scopeId: string, opts?: ListCapabilitiesOptions): Capability[];
    /** 按 name 查执行归属。返回的能力含 scope 字段，两端据此决定走哪个 dispatch。 */
    resolve(scopeId: string, name: string): Capability | undefined;
    has(scopeId: string, name: string): boolean;
    get size(): number;
    clear(): void;
}
/** 把能力描述转成 OpenAI function tool schema（两端装配时复用，避免两处转换分叉）。 */
export declare function toOpenAITool(cap: Capability): {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
};
/** 统一结果截断：超限时截断并附标记，保证模型知道结果被裁过。 */
export declare function truncateResult(text: string, maxChars: number): string;
/** 规范化 scope key，避免不同调用方拼接出同义不同形的 key。 */
export declare function scopeKey(namespace: string, id: string): string;

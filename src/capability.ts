// 统一能力注册表 · 纯逻辑契约（阶段 D）。
//
// 硬边界（沿用本项目纪律）：本包只放类型 + 纯函数 + 严格解析，不碰 fs / DB /
// 网络 / electron / openai。dispatch（真正执行能力）由两端各自按 id 持有，
// 注册表只负责「描述、scope 隔离、归属判定、超时/截断策略」。
//
// 为什么 scope 是核心：历史上 setFrontendTools() / setLocalTools() 是进程级
// 整表覆盖，多客户端（WS 多连接 / 本地 UI + 组网 hostExecutor + 机器人）
// 后到者覆盖前者，出现「模型看到 A 的工具名却走 B 的执行器」。注册表把
// connection 级能力按 scopeId 分桶：list(scopeId) 只返回该桶可见的 schema，
// resolve(scopeId, name) 也只在该桶内查归属，彻底消除 last-writer-wins。

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
export const DEFAULT_CAPABILITY_TIMEOUT_MS = 30000;
export const DEFAULT_CAPABILITY_TRUNCATE_CHARS = 4000;
export const MAX_CAPABILITY_TIMEOUT_MS = 120000;
export const MAX_CAPABILITY_TRUNCATE_CHARS = 50000;
export const MAX_CAPABILITIES = 200;

export const CAPABILITY_KINDS: readonly CapabilityKind[] = ["tool", "skill", "agent"];
export const CAPABILITY_SCOPES: readonly CapabilityScope[] = ["builtin", "global", "connection"];

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

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return !!v && typeof v === "object" && !Array.isArray(v);
}

function fail(where: string, msg: string): never {
    throw new Error(`[${where}] ${msg}`);
}

/**
 * 严格解析一条能力。非法输入一律抛错（与 parseAgentProfile / parsePlan 同风格），
 * 不静默回填——能力契约一旦模糊，scope 隔离与截断策略就形同虚设。
 */
export function parseCapability(raw: unknown, where = "capability"): Capability {
    if (!isPlainObject(raw)) fail(where, "必须是对象");
    const o = raw;
    const id = o.id;
    const name = o.name;
    const kind = o.kind;
    const scope = o.scope;
    const description = o.description;
    if (typeof id !== "string" || !id.trim()) fail(where, "id 必须是非空字符串");
    if (typeof name !== "string" || !name.trim()) fail(where, "name 必须是非空字符串");
    if (typeof kind !== "string" || !CAPABILITY_KINDS.includes(kind as CapabilityKind))
        fail(where, `kind 必须是 ${CAPABILITY_KINDS.join(" / ")} 之一`);
    if (typeof scope !== "string" || !CAPABILITY_SCOPES.includes(scope as CapabilityScope))
        fail(where, `scope 必须是 ${CAPABILITY_SCOPES.join(" / ")} 之一`);
    if (typeof description !== "string" || !description.trim())
        fail(where, "description 必须是非空字符串");

    const timeoutMsRaw: unknown = o.timeoutMs;
    const truncateCharsRaw: unknown = o.truncateChars;
    const timeoutMs: number =
        timeoutMsRaw === undefined ? DEFAULT_CAPABILITY_TIMEOUT_MS : (timeoutMsRaw as number);
    const truncateChars: number =
        truncateCharsRaw === undefined ? DEFAULT_CAPABILITY_TRUNCATE_CHARS : (truncateCharsRaw as number);
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_CAPABILITY_TIMEOUT_MS)
        fail(where, `timeoutMs 必须是 1..${MAX_CAPABILITY_TIMEOUT_MS} 的整数`);
    if (
        !Number.isInteger(truncateChars) ||
        truncateChars <= 0 ||
        truncateChars > MAX_CAPABILITY_TRUNCATE_CHARS
    )
        fail(where, `truncateChars 必须是 1..${MAX_CAPABILITY_TRUNCATE_CHARS} 的整数`);

    if (o.parameters !== undefined && !isPlainObject(o.parameters))
        fail(where, "parameters 必须是对象");
    if (o.tags !== undefined) {
        if (!Array.isArray(o.tags) || o.tags.some((t) => typeof t !== "string"))
            fail(where, "tags 必须是字符串数组");
    }

    return {
        id: id.trim(),
        name: name.trim(),
        kind: kind as CapabilityKind,
        scope: scope as CapabilityScope,
        description: description.trim(),
        ...(isPlainObject(o.parameters) ? { parameters: o.parameters } : {}),
        timeoutMs: timeoutMs as number,
        truncateChars: truncateChars as number,
        ...(Array.isArray(o.tags) ? { tags: o.tags as string[] } : {}),
    };
}

/** 填默认值并做类型收窄；能力文件用它声明「一个能力一个文件」。 */
export function defineCapability(input: CapabilityInput): Capability {
    return parseCapability(input, `capability:${input.id || "?"}`);
}

/** 装配过滤：白名单/标签过滤。whitelist 按 name 匹配（对应 AgentProfile 的可选能力集）。 */
export interface ListCapabilitiesOptions {
    /** 只保留这些 name（白名单） */
    whitelist?: readonly string[];
    /** 只保留带这些 tag 之一的能力 */
    tags?: readonly string[];
    /** 排除带这些 tag 之一的能力 */
    excludeTags?: readonly string[];
}

function matchesFilters(cap: Capability, opts?: ListCapabilitiesOptions): boolean {
    if (!opts) return true;
    if (opts.whitelist && !opts.whitelist.includes(cap.name)) return false;
    if (opts.tags && !(cap.tags ?? []).some((t) => opts.tags!.includes(t))) return false;
    if (opts.excludeTags && (cap.tags ?? []).some((t) => opts.excludeTags!.includes(t)))
        return false;
    return true;
}

/**
 * 统一能力注册表。两端各持一个实例，把 builtin / global 注册到公共桶，
 * 把 connection 级能力按 scopeId 分桶。这样每个客户端只看到自己的 frontend 工具，
 * 执行归属也按 scopeId 判定，彻底解决进程级单例互相覆盖。
 */
export class CapabilityRegistry {
    private readonly builtin = new Map<string, Capability>();
    private readonly global = new Map<string, Capability>();
    private readonly connections = new Map<string, Map<string, Capability>>();

    /** 注册 builtin 或 global 能力。connection 级请用 registerFor。 */
    register(cap: Capability): void {
        if (cap.scope === "connection")
            fail("CapabilityRegistry.register", "connection 能力请用 registerFor(scopeId, cap)");
        const bucket = cap.scope === "builtin" ? this.builtin : this.global;
        if (bucket.size >= MAX_CAPABILITIES && !bucket.has(cap.id))
            fail("CapabilityRegistry.register", `能力数量超过 ${MAX_CAPABILITIES}`);
        bucket.set(cap.id, cap);
    }

    /** 按 scopeId 注册一个 connection 级能力。 */
    registerFor(scopeId: string, cap: Capability): void {
        if (cap.scope !== "connection")
            fail("CapabilityRegistry.registerFor", "仅接受 connection 级能力");
        let bucket = this.connections.get(scopeId);
        if (!bucket) {
            bucket = new Map();
            this.connections.set(scopeId, bucket);
        }
        if (bucket.size >= MAX_CAPABILITIES && !bucket.has(cap.id))
            fail("CapabilityRegistry.registerFor", `scope=${scopeId} 能力数超过 ${MAX_CAPABILITIES}`);
        bucket.set(cap.id, cap);
    }

    /** 连接关闭时整桶清理，避免残留能力被后续连接复用。 */
    unregisterScope(scopeId: string): void {
        this.connections.delete(scopeId);
    }

    /**
     * 列出该 scopeId 可见的能力（builtin + global + 该连接分桶），按 name 去重，
     * 优先级 builtin > global > connection——防止前端上报同名工具覆盖内置 schema。
     */
    list(scopeId: string, opts?: ListCapabilitiesOptions): Capability[] {
        const byName = new Map<string, Capability>();
        // 低优先级先放，高优先级覆盖：connection → global → builtin
        for (const cap of this.connections.get(scopeId)?.values() ?? []) byName.set(cap.name, cap);
        for (const cap of this.global.values()) byName.set(cap.name, cap);
        for (const cap of this.builtin.values()) byName.set(cap.name, cap);
        return [...byName.values()].filter((c) => matchesFilters(c, opts));
    }

    /** 按 name 查执行归属。返回的能力含 scope 字段，两端据此决定走哪个 dispatch。 */
    resolve(scopeId: string, name: string): Capability | undefined {
        const builtin = [...this.builtin.values()].find((c) => c.name === name);
        if (builtin) return builtin;
        const global = [...this.global.values()].find((c) => c.name === name);
        if (global) return global;
        return [...(this.connections.get(scopeId)?.values() ?? [])].find((c) => c.name === name);
    }

    has(scopeId: string, name: string): boolean {
        return this.resolve(scopeId, name) !== undefined;
    }

    get size(): number {
        let n = this.builtin.size + this.global.size;
        for (const b of this.connections.values()) n += b.size;
        return n;
    }

    clear(): void {
        this.builtin.clear();
        this.global.clear();
        this.connections.clear();
    }
}

/** 把能力描述转成 OpenAI function tool schema（两端装配时复用，避免两处转换分叉）。 */
export function toOpenAITool(cap: Capability): {
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
} {
    return {
        type: "function",
        function: {
            name: cap.name,
            description: cap.description,
            parameters: cap.parameters ?? { type: "object", properties: {} },
        },
    };
}

/** 统一结果截断：超限时截断并附标记，保证模型知道结果被裁过。 */
export function truncateResult(text: string, maxChars: number): string {
    if (maxChars <= 0 || text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}\n…[结果已截断：${text.length} → ${maxChars} 字符]`;
}

/** 规范化 scope key，避免不同调用方拼接出同义不同形的 key。 */
export function scopeKey(namespace: string, id: string): string {
    return `${namespace.trim()}::${id.trim()}`;
}

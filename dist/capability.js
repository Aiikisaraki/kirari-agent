"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CapabilityRegistry = exports.CAPABILITY_SCOPES = exports.CAPABILITY_KINDS = exports.MAX_CAPABILITIES = exports.MAX_CAPABILITY_TRUNCATE_CHARS = exports.MAX_CAPABILITY_TIMEOUT_MS = exports.DEFAULT_CAPABILITY_TRUNCATE_CHARS = exports.DEFAULT_CAPABILITY_TIMEOUT_MS = void 0;
exports.parseCapability = parseCapability;
exports.defineCapability = defineCapability;
exports.toOpenAITool = toOpenAITool;
exports.truncateResult = truncateResult;
exports.scopeKey = scopeKey;
/** 默认策略，与两端历史值对齐：skillTools 4000 字符、bridge 30s。 */
exports.DEFAULT_CAPABILITY_TIMEOUT_MS = 30000;
exports.DEFAULT_CAPABILITY_TRUNCATE_CHARS = 4000;
exports.MAX_CAPABILITY_TIMEOUT_MS = 120000;
exports.MAX_CAPABILITY_TRUNCATE_CHARS = 50000;
exports.MAX_CAPABILITIES = 200;
exports.CAPABILITY_KINDS = ["tool", "skill", "agent"];
exports.CAPABILITY_SCOPES = ["builtin", "global", "connection"];
function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
}
function fail(where, msg) {
    throw new Error(`[${where}] ${msg}`);
}
/**
 * 严格解析一条能力。非法输入一律抛错（与 parseAgentProfile / parsePlan 同风格），
 * 不静默回填——能力契约一旦模糊，scope 隔离与截断策略就形同虚设。
 */
function parseCapability(raw, where = "capability") {
    if (!isPlainObject(raw))
        fail(where, "必须是对象");
    const o = raw;
    const id = o.id;
    const name = o.name;
    const kind = o.kind;
    const scope = o.scope;
    const description = o.description;
    if (typeof id !== "string" || !id.trim())
        fail(where, "id 必须是非空字符串");
    if (typeof name !== "string" || !name.trim())
        fail(where, "name 必须是非空字符串");
    if (typeof kind !== "string" || !exports.CAPABILITY_KINDS.includes(kind))
        fail(where, `kind 必须是 ${exports.CAPABILITY_KINDS.join(" / ")} 之一`);
    if (typeof scope !== "string" || !exports.CAPABILITY_SCOPES.includes(scope))
        fail(where, `scope 必须是 ${exports.CAPABILITY_SCOPES.join(" / ")} 之一`);
    if (typeof description !== "string" || !description.trim())
        fail(where, "description 必须是非空字符串");
    const timeoutMsRaw = o.timeoutMs;
    const truncateCharsRaw = o.truncateChars;
    const timeoutMs = timeoutMsRaw === undefined ? exports.DEFAULT_CAPABILITY_TIMEOUT_MS : timeoutMsRaw;
    const truncateChars = truncateCharsRaw === undefined ? exports.DEFAULT_CAPABILITY_TRUNCATE_CHARS : truncateCharsRaw;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > exports.MAX_CAPABILITY_TIMEOUT_MS)
        fail(where, `timeoutMs 必须是 1..${exports.MAX_CAPABILITY_TIMEOUT_MS} 的整数`);
    if (!Number.isInteger(truncateChars) ||
        truncateChars <= 0 ||
        truncateChars > exports.MAX_CAPABILITY_TRUNCATE_CHARS)
        fail(where, `truncateChars 必须是 1..${exports.MAX_CAPABILITY_TRUNCATE_CHARS} 的整数`);
    if (o.parameters !== undefined && !isPlainObject(o.parameters))
        fail(where, "parameters 必须是对象");
    if (o.tags !== undefined) {
        if (!Array.isArray(o.tags) || o.tags.some((t) => typeof t !== "string"))
            fail(where, "tags 必须是字符串数组");
    }
    return {
        id: id.trim(),
        name: name.trim(),
        kind: kind,
        scope: scope,
        description: description.trim(),
        ...(isPlainObject(o.parameters) ? { parameters: o.parameters } : {}),
        timeoutMs: timeoutMs,
        truncateChars: truncateChars,
        ...(Array.isArray(o.tags) ? { tags: o.tags } : {}),
    };
}
/** 填默认值并做类型收窄；能力文件用它声明「一个能力一个文件」。 */
function defineCapability(input) {
    return parseCapability(input, `capability:${input.id || "?"}`);
}
function matchesFilters(cap, opts) {
    if (!opts)
        return true;
    if (opts.whitelist && !opts.whitelist.includes(cap.name))
        return false;
    if (opts.tags && !(cap.tags ?? []).some((t) => opts.tags.includes(t)))
        return false;
    if (opts.excludeTags && (cap.tags ?? []).some((t) => opts.excludeTags.includes(t)))
        return false;
    return true;
}
/**
 * 统一能力注册表。两端各持一个实例，把 builtin / global 注册到公共桶，
 * 把 connection 级能力按 scopeId 分桶。这样每个客户端只看到自己的 frontend 工具，
 * 执行归属也按 scopeId 判定，彻底解决进程级单例互相覆盖。
 */
class CapabilityRegistry {
    builtin = new Map();
    global = new Map();
    connections = new Map();
    /** 注册 builtin 或 global 能力。connection 级请用 registerFor。 */
    register(cap) {
        if (cap.scope === "connection")
            fail("CapabilityRegistry.register", "connection 能力请用 registerFor(scopeId, cap)");
        const bucket = cap.scope === "builtin" ? this.builtin : this.global;
        if (bucket.size >= exports.MAX_CAPABILITIES && !bucket.has(cap.id))
            fail("CapabilityRegistry.register", `能力数量超过 ${exports.MAX_CAPABILITIES}`);
        bucket.set(cap.id, cap);
    }
    /** 按 scopeId 注册一个 connection 级能力。 */
    registerFor(scopeId, cap) {
        if (cap.scope !== "connection")
            fail("CapabilityRegistry.registerFor", "仅接受 connection 级能力");
        let bucket = this.connections.get(scopeId);
        if (!bucket) {
            bucket = new Map();
            this.connections.set(scopeId, bucket);
        }
        if (bucket.size >= exports.MAX_CAPABILITIES && !bucket.has(cap.id))
            fail("CapabilityRegistry.registerFor", `scope=${scopeId} 能力数超过 ${exports.MAX_CAPABILITIES}`);
        bucket.set(cap.id, cap);
    }
    /** 连接关闭时整桶清理，避免残留能力被后续连接复用。 */
    unregisterScope(scopeId) {
        this.connections.delete(scopeId);
    }
    /**
     * 列出该 scopeId 可见的能力（builtin + global + 该连接分桶），按 name 去重，
     * 优先级 builtin > global > connection——防止前端上报同名工具覆盖内置 schema。
     */
    list(scopeId, opts) {
        const byName = new Map();
        // 低优先级先放，高优先级覆盖：connection → global → builtin
        for (const cap of this.connections.get(scopeId)?.values() ?? [])
            byName.set(cap.name, cap);
        for (const cap of this.global.values())
            byName.set(cap.name, cap);
        for (const cap of this.builtin.values())
            byName.set(cap.name, cap);
        return [...byName.values()].filter((c) => matchesFilters(c, opts));
    }
    /** 按 name 查执行归属。返回的能力含 scope 字段，两端据此决定走哪个 dispatch。 */
    resolve(scopeId, name) {
        const builtin = [...this.builtin.values()].find((c) => c.name === name);
        if (builtin)
            return builtin;
        const global = [...this.global.values()].find((c) => c.name === name);
        if (global)
            return global;
        return [...(this.connections.get(scopeId)?.values() ?? [])].find((c) => c.name === name);
    }
    has(scopeId, name) {
        return this.resolve(scopeId, name) !== undefined;
    }
    get size() {
        let n = this.builtin.size + this.global.size;
        for (const b of this.connections.values())
            n += b.size;
        return n;
    }
    clear() {
        this.builtin.clear();
        this.global.clear();
        this.connections.clear();
    }
}
exports.CapabilityRegistry = CapabilityRegistry;
/** 把能力描述转成 OpenAI function tool schema（两端装配时复用，避免两处转换分叉）。 */
function toOpenAITool(cap) {
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
function truncateResult(text, maxChars) {
    if (maxChars <= 0 || text.length <= maxChars)
        return text;
    return `${text.slice(0, maxChars)}\n…[结果已截断：${text.length} → ${maxChars} 字符]`;
}
/** 规范化 scope key，避免不同调用方拼接出同义不同形的 key。 */
function scopeKey(namespace, id) {
    return `${namespace.trim()}::${id.trim()}`;
}
//# sourceMappingURL=capability.js.map
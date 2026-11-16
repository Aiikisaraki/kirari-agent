// SKILL.md 渐进披露 · 纯逻辑（阶段 D）。
//
// 设计来源（设计文档 §3）：prompt 型技能现在每次全量拼进 system，装十个技能
// 就吃掉大量 token。这里改为「目录摘要 + 按需加载正文」：
//   1) 解析 SKILL.md frontmatter，进 system 的只有一行 name + description；
//   2) 模型判断需要时用 load_skill(name) 才把正文注入。
//
// 本包只放解析与拼装纯逻辑；文件扫描、路径管理由两端各自实现（保持无 fs 依赖）。

/** SKILL.md frontmatter 解析后的元数据。 */
export interface SkillMeta {
    name: string;
    description: string;
    /** 可选：版本、标签、作者等扩展字段，原样保留供 UI 展示。 */
    [key: string]: string | string[];
}

/** 一个解析好的 SKILL.md。 */
export interface ParsedSkill {
    meta: SkillMeta;
    /** frontmatter 之后的 Markdown 正文（按需加载时注入的内容）。 */
    body: string;
}

export const MAX_SKILL_NAME = 64;
export const MAX_SKILL_DESCRIPTION = 200;
export const MAX_SKILL_BODY = 20000;
export const MAX_SKILL_TAGS = 20;

function fail(where: string, msg: string): never {
    throw new Error(`[${where}] ${msg}`);
}

/**
 * 解析一段 SKILL.md 文本。格式：
 *   ---
 *   name: xxx
 *   description: yyy
 *   tags: a, b
 *   ---
 *   # 正文...
 *
 * 严格规则：必须以 --- 开头（允许前置 BOM/空白），必须有闭合 ---；
 * name/description 必填且非空；未知字段作为字符串保留；越界一律抛错。
 */
export function parseSkillMarkdown(raw: string, where = "SKILL.md"): ParsedSkill {
    if (typeof raw !== "string") fail(where, "内容必须是字符串");
    const text = raw.replace(/^\uFEFF/, "").replace(/^\s*\r?\n/, "");
    if (!text.startsWith("---")) fail(where, "必须以 frontmatter 起始标记 --- 开头");
    const afterOpen = text.slice(3);
    const lines = afterOpen.split(/\r?\n/);
    // 第 0 行是 --- 之后的内容：通常为空行（因为 --- 独占一行），兼容 ---name: 写法但不鼓励
    let closeIdx = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === "---") {
            closeIdx = i;
            break;
        }
    }
    if (closeIdx < 0) fail(where, "缺少 frontmatter 闭合标记 ---");

    const meta: SkillMeta = { name: "", description: "" };
    for (let i = 1; i < closeIdx; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        const colon = line.indexOf(":");
        if (colon <= 0) fail(where, `frontmatter 第 ${i + 1} 行缺少 key: value 结构`);
        const key = line.slice(0, colon).trim();
        const value = line.slice(colon + 1).trim();
        if (!key) fail(where, `frontmatter 第 ${i + 1} 行 key 为空`);
        if (key === "tags") {
            meta.tags = value
                ? value.split(",").map((t) => t.trim()).filter(Boolean)
                : [];
        } else {
            meta[key] = value;
        }
    }

    if (typeof meta.name !== "string" || !meta.name.trim())
        fail(where, "frontmatter 必须包含非空 name");
    if (typeof meta.description !== "string" || !meta.description.trim())
        fail(where, "frontmatter 必须包含非空 description");
    if (meta.name.length > MAX_SKILL_NAME)
        fail(where, `name 超过 ${MAX_SKILL_NAME} 字符`);
    if (meta.description.length > MAX_SKILL_DESCRIPTION)
        fail(where, `description 超过 ${MAX_SKILL_DESCRIPTION} 字符`);
    if (Array.isArray(meta.tags) && meta.tags.length > MAX_SKILL_TAGS)
        fail(where, `tags 超过 ${MAX_SKILL_TAGS} 个`);

    const body = lines.slice(closeIdx + 1).join("\n").trim();
    if (body.length > MAX_SKILL_BODY) fail(where, `正文超过 ${MAX_SKILL_BODY} 字符`);

    return { meta: { ...meta, name: meta.name.trim(), description: meta.description.trim() }, body };
}

/** 目录摘要的一行：进 system 的只有这一行，不含正文。 */
export function skillCatalogLine(parsed: ParsedSkill): string {
    return `- ${parsed.meta.name}: ${parsed.meta.description}`;
}

/** 把多个 SKILL.md 解析结果生成目录块（仍不含正文）。 */
export function buildSkillCatalog(skills: readonly ParsedSkill[]): string {
    if (!skills.length) return "";
    return "# 可用技能（需要时用 load_skill 加载正文）\n" + skills.map(skillCatalogLine).join("\n");
}

/**
 * 把已按需加载的技能正文拼成注入块。只在模型调用 load_skill 后调用，
 * 未命中的技能正文绝不进入这里——这就是「渐进披露」的关键。
 */
export function buildLoadedSkillBlock(loaded: readonly ParsedSkill[]): string {
    if (!loaded.length) return "";
    return loaded
        .map((s) => `# 技能：${s.meta.name}\n${s.body}`)
        .join("\n\n");
}

/** 按 name 从目录里找技能（load_skill 工具用；大小写敏感，避免歧义）。 */
export function findSkillByName(skills: readonly ParsedSkill[], name: string): ParsedSkill | undefined {
    return skills.find((s) => s.meta.name === name);
}

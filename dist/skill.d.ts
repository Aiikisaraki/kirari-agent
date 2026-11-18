/** SKILL.md frontmatter 解析后的元数据。 */
export interface SkillMeta {
    name: string;
    description: string;
    /** 可选：版本、标签、作者等扩展字段，原样保留供 UI 展示。 */
    [key: string]: string | string[] | Record<string, unknown>;
}
/** 一个解析好的 SKILL.md。 */
export interface ParsedSkill {
    meta: SkillMeta;
    /** frontmatter 之后的 Markdown 正文（按需加载时注入的内容）。 */
    body: string;
}
export declare const MAX_SKILL_NAME = 64;
export declare const MAX_SKILL_DESCRIPTION = 2000;
export declare const MAX_SKILL_BODY = 200000;
export declare const MAX_SKILL_TAGS = 20;
export interface FrontmatterParseResult {
    /** 顶层标量字段（name / description / version ...）。嵌套与列表是 JSON 串。 */
    meta: Record<string, string | string[] | Record<string, unknown>>;
    /** 正文（frontmatter 之后）。 */
    body: string;
}
/**
 * 解析 SKILL.md 文本，返回元数据与正文。
 * 严格的错误信息全部带 where 前缀，便于定位是哪个文件坏了。
 */
export declare function parseFrontmatter(raw: string, where?: string): FrontmatterParseResult;
/**
 * 解析一段 SKILL.md 文本。格式：YAML frontmatter + Markdown 正文。
 *
 * 必备：name、description 非空且不超上限。其余字段原样保留。
 *
 * @param fallbackName 可选的兜底名字（通常传技能所在目录名）。
 *   Claude Code 等实现对「frontmatter 只写了 description、没写 name」的技能
 *   是允许的（用目录名当名字）。传了 fallbackName 就能兼容这类文件；
 *   不传则维持严格语义（name 必填）。
 */
export declare function parseSkillMarkdown(raw: string, where?: string, fallbackName?: string): ParsedSkill;
/** 目录摘要的一行：进 system 的只有这一行，不含正文。 */
export declare function skillCatalogLine(parsed: ParsedSkill, maxDescription?: number): string;
/** 把多个 SKILL.md 解析结果生成目录块（仍不含正文）。 */
export declare function buildSkillCatalog(skills: readonly ParsedSkill[], maxDescription?: number): string;
/**
 * 把已按需加载的技能正文拼成注入块。只在模型调用 load_skill 后调用，
 * 未命中的技能正文绝不进入这里——这就是「渐进披露」的关键。
 */
export declare function buildLoadedSkillBlock(loaded: readonly ParsedSkill[]): string;
/** 按 name 从目录里找技能（load_skill 工具用；大小写敏感，避免歧义）。 */
export declare function findSkillByName(skills: readonly ParsedSkill[], name: string): ParsedSkill | undefined;

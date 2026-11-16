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
export declare const MAX_SKILL_NAME = 64;
export declare const MAX_SKILL_DESCRIPTION = 200;
export declare const MAX_SKILL_BODY = 20000;
export declare const MAX_SKILL_TAGS = 20;
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
export declare function parseSkillMarkdown(raw: string, where?: string): ParsedSkill;
/** 目录摘要的一行：进 system 的只有这一行，不含正文。 */
export declare function skillCatalogLine(parsed: ParsedSkill): string;
/** 把多个 SKILL.md 解析结果生成目录块（仍不含正文）。 */
export declare function buildSkillCatalog(skills: readonly ParsedSkill[]): string;
/**
 * 把已按需加载的技能正文拼成注入块。只在模型调用 load_skill 后调用，
 * 未命中的技能正文绝不进入这里——这就是「渐进披露」的关键。
 */
export declare function buildLoadedSkillBlock(loaded: readonly ParsedSkill[]): string;
/** 按 name 从目录里找技能（load_skill 工具用；大小写敏感，避免歧义）。 */
export declare function findSkillByName(skills: readonly ParsedSkill[], name: string): ParsedSkill | undefined;

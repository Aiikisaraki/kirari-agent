import { describe, expect, it } from "vitest";
import {
    buildLoadedSkillBlock,
    buildSkillCatalog,
    findSkillByName,
    parseSkillMarkdown,
    skillCatalogLine,
} from "./skill";

const md = (name: string, description: string, body: string) =>
    `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;

describe("parseSkillMarkdown 严格解析", () => {
    it("正常解析 name/description/正文", () => {
        const p = parseSkillMarkdown(md("weather", "查天气", "# 正文\n用 Open-Meteo"));
        expect(p.meta.name).toBe("weather");
        expect(p.meta.description).toBe("查天气");
        expect(p.body).toContain("# 正文");
    });

    it("允许 BOM 与前置空行", () => {
        const p = parseSkillMarkdown(`\uFEFF\n---\nname: a\ndescription: b\n---\nbody`);
        expect(p.meta.name).toBe("a");
    });

    it("保留 tags 为字符串数组", () => {
        const p = parseSkillMarkdown(`---\nname: a\ndescription: b\ntags: x, y, z\n---\nbody`);
        expect(p.meta.tags).toEqual(["x", "y", "z"]);
    });

    it("保留未知扩展字段", () => {
        const p = parseSkillMarkdown(`---\nname: a\ndescription: b\nversion: 1.2\n---\nbody`);
        expect(p.meta.version).toBe("1.2");
    });

    it("缺少起始/闭合标记报错", () => {
        expect(() => parseSkillMarkdown("name: a\n---\nbody")).toThrow(/---/);
        expect(() => parseSkillMarkdown("---\nname: a\ndescription: b\nbody")).toThrow(/闭合/);
    });

    it("缺 name/description 报错", () => {
        expect(() => parseSkillMarkdown("---\ndescription: b\n---\nbody")).toThrow(/name/);
        expect(() => parseSkillMarkdown("---\nname: a\n---\nbody")).toThrow(/description/);
    });

    it("frontmatter 行缺冒号报错", () => {
        expect(() => parseSkillMarkdown("---\nname: a\nbadline\n---\nbody")).toThrow(/key: value/);
    });

    it("name/description 超长报错", () => {
        const long = "x".repeat(65);
        expect(() => parseSkillMarkdown(md(long, "b", "body"))).toThrow(/name 超过/);
        const longDesc = "d".repeat(201);
        expect(() => parseSkillMarkdown(md("a", longDesc, "body"))).toThrow(/description 超过/);
    });
});

describe("渐进披露拼装", () => {
    const skills = [
        parseSkillMarkdown(md("weather", "查天气", "正文A：7000 字")),
        parseSkillMarkdown(md("reminder", "设定提醒", "正文B：8000 字")),
    ];

    it("目录只含 name/description，不含正文", () => {
        const catalog = buildSkillCatalog(skills);
        expect(catalog).toContain("weather: 查天气");
        expect(catalog).toContain("reminder: 设定提醒");
        expect(catalog).not.toContain("正文A");
        expect(catalog).not.toContain("正文B");
    });

    it("目录摘要单行与按需正文块", () => {
        expect(skillCatalogLine(skills[0])).toBe("- weather: 查天气");
        const block = buildLoadedSkillBlock([skills[0]]);
        expect(block).toContain("# 技能：weather");
        expect(block).toContain("正文A");
        expect(block).not.toContain("正文B");
    });

    it("空目录/空加载块返回空串", () => {
        expect(buildSkillCatalog([])).toBe("");
        expect(buildLoadedSkillBlock([])).toBe("");
    });

    it("findSkillByName 按名字精确查找", () => {
        expect(findSkillByName(skills, "weather")?.body).toContain("正文A");
        expect(findSkillByName(skills, "Weather")).toBeUndefined();
        expect(findSkillByName(skills, "nope")).toBeUndefined();
    });
});

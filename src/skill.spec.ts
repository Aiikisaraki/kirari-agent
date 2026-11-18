import { describe, expect, it } from "vitest";
import {
    MAX_SKILL_DESCRIPTION,
    MAX_SKILL_NAME,
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
        const long = "x".repeat(MAX_SKILL_NAME + 1);
        expect(() => parseSkillMarkdown(md(long, "b", "body"))).toThrow(/name 超过/);
        // description 上限 v0.5.0 放宽到 2000：真实技能普遍写 300~800 字触发条件
        const longDesc = "d".repeat(MAX_SKILL_DESCRIPTION + 1);
        expect(() => parseSkillMarkdown(md("a", longDesc, "body"))).toThrow(/description 超过/);
    });

    it("frontmatter 不是首行时报错", () => {
        expect(() => parseSkillMarkdown("# 标题\n---\nname: a\ndescription: b\n---\nbody")).toThrow(/---/);
    });
});

// ── v0.5.0：标准 YAML 子集兼容（跨 agent 无缝迁移的关键）────────────
describe("parseSkillMarkdown 兼容标准 YAML 写法", () => {
    it("双引号 description 去引号", () => {
        const p = parseSkillMarkdown('---\nname: a\ndescription: "带引号的描述"\n---\nbody');
        expect(p.meta.description).toBe("带引号的描述");
    });

    it("单引号 description 去引号", () => {
        const p = parseSkillMarkdown("---\nname: a\ndescription: '单引号: 含冒号'\n---\nbody");
        expect(p.meta.description).toBe("单引号: 含冒号");
    });

    it("折叠块 description: > 折成一行", () => {
        const p = parseSkillMarkdown("---\nname: a\ndescription: >\n  第一行\n  第二行\n---\nbody");
        expect(p.meta.description).toBe("第一行 第二行");
    });

    it("字面块 description: | 保留换行", () => {
        const p = parseSkillMarkdown("---\nname: a\ndescription: |\n  第一行\n  第二行\n---\nbody");
        expect(p.meta.description).toBe("第一行\n第二行");
    });

    it("普通标量跨行续写（续行缩进）", () => {
        const p = parseSkillMarkdown(
            "---\nname: a\ndescription: 前半句，\n  ad spy, app intelligence.\n---\nbody",
        );
        expect(p.meta.description).toBe("前半句， ad spy, app intelligence.");
    });

    it("单引号跨行续写：先拼接再去引号", () => {
        const p = parseSkillMarkdown(
            "---\nname: a\ndescription: 'Multi-agent system,\n  Editor, Scriptwriter.'\n---\nbody",
        );
        expect(p.meta.description).toBe("Multi-agent system, Editor, Scriptwriter.");
    });

    it("缩进块序列 tags", () => {
        const p = parseSkillMarkdown("---\nname: a\ndescription: b\ntags:\n  - x\n  - y\n---\nbody");
        expect(p.meta.tags).toEqual(["x", "y"]);
    });

    it("顶格块序列 tags（与父 key 同缩进）", () => {
        const p = parseSkillMarkdown("---\nname: a\ndescription: b\ntags:\n- x\n- y\n---\nbody");
        expect(p.meta.tags).toEqual(["x", "y"]);
    });

    it("深层嵌套 metadata 不吞后续顶层字段", () => {
        const p = parseSkillMarkdown(
            [
                "---",
                "name: a",
                "description: b",
                "metadata:",
                "  clawdbot:",
                "    requires:",
                "      bins:",
                "      - node",
                "    env:",
                "    - NAME",
                "version: 1.2.3",
                "---",
                "body",
            ].join("\n"),
        );
        expect(p.meta.version).toBe("1.2.3"); // 关键：嵌套没把它吞掉
        expect(p.meta.metadata).toBeTruthy();
    });

    it("description 超 200 字（真实技能常态）也能通过", () => {
        const longDesc = "描述内容".repeat(80); // 400 字
        const p = parseSkillMarkdown(md("a", longDesc, "body"));
        expect(p.meta.description).toBe(longDesc);
    });

    it("fallbackName 兜底：只写 description 时用目录名", () => {
        const p = parseSkillMarkdown("---\ndescription: b\n---\nbody", "x.md", "my-skill");
        expect(p.meta.name).toBe("my-skill");
    });

    it("不传 fallbackName 时 name 仍必填（保持严格）", () => {
        expect(() => parseSkillMarkdown("---\ndescription: b\n---\nbody")).toThrow(/name/);
    });

    it("只有 description_zh 也能解析（技能市场里的真实写法）", () => {
        // 例：codebuddy skills-marketplace 的 conversion-ops / sales-playbook，
        // 只写 description_zh + description_en，没有 description。
        const p = parseSkillMarkdown(
            '---\nname: conversion-ops\ndescription_zh: "CRO 审计与落地页优化"\ndescription_en: "CRO audit"\n---\n正文',
            "x.md",
        );
        expect(p.meta.description).toBe("CRO 审计与落地页优化");
        expect(p.meta.description_zh).toBe("CRO 审计与落地页优化"); // 原字段也保留
    });

    it("只有 description_en 也能解析", () => {
        const p = parseSkillMarkdown('---\nname: s\ndescription_en: "Only english"\n---\n正文', "x.md");
        expect(p.meta.description).toBe("Only english");
    });

    it("标准 description 优先于 description_zh/en", () => {
        const p = parseSkillMarkdown(
            '---\nname: s\ndescription: "标准"\ndescription_zh: "中文"\ndescription_en: "EN"\n---\n正文',
            "x.md",
        );
        expect(p.meta.description).toBe("标准");
    });

    it("三个 description 都没有才报错", () => {
        expect(() => parseSkillMarkdown("---\nname: s\n---\n正文", "x.md")).toThrow(/description/);
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

// SKILL.md 渐进披露 · 纯逻辑（阶段 D）。
//
// 设计来源（设计文档 §3）：prompt 型技能现在每次全量拼进 system，装十个技能
// 就吃掉大量 token。这里改为「目录摘要 + 按需加载正文」：
//   1) 解析 SKILL.md frontmatter，进 system 的只有一行 name + description；
//   2) 模型判断需要时用 load_skill(name) 才把正文注入。
//
// 本包只放解析与拼装纯逻辑；文件扫描、路径管理由两端各自实现（保持无 fs 依赖）。
//
// ── 为什么 frontmatter 要支持 YAML 子集（v0.5.0）─────────────────────
// SKILL.md 是 Agent Skills 的事实标准，Claude Code / codebuddy / WorkBuddy /
// Trae 全用它。早期这里只认「每行一个 key: value」，实测本机 389 个真实技能
// 只有 33% 能解析 —— 剩下 67% 用了标准 YAML 的常见写法：
//
//   description: >            ← 折叠块标量（多行，折成一行）
//     第一行
//     第二行
//   description: |            ← 字面块标量（保留换行）
//   description: "带: 冒号的"   ← 双引号（需去引号 + 处理转义）
//   description: '单引号'      ← 单引号（'' 表示一个 '）
//   tags:                      ← 块序列
//     - a
//     - b
//   metadata:                  ← 嵌套映射（缩进子层）
//     version: 1.0
//
// 于是这里实现一个**够用的 YAML 子集解析器**：不追求完整 YAML（不支持锚点、
// 流式集合、多文档等罕见语法），但覆盖技能文件实际会用到的全部写法。
// 解析失败依然显式报错，绝不静默产出错值。
//
// ── 长度上限（v0.5.0 放宽）───────────────────────────────────────────
// description 原来卡 200 字符，实测 137 个真实技能被这一条挡掉 —— 它们普遍
// 写 300~800 字的详细触发条件，这是标准做法而非错误输入。上限放宽到 2000；
// 真正进 system 时由调用方截断（目录摘要本身不需要全文）。

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

export const MAX_SKILL_NAME = 64;
export const MAX_SKILL_DESCRIPTION = 2000;
export const MAX_SKILL_BODY = 200000;
export const MAX_SKILL_TAGS = 20;

function fail(where: string, msg: string): never {
    throw new Error(`[${where}] ${msg}`);
}

// ─────────────────────────── YAML 子集 ───────────────────────────

/** 去掉包裹的引号并还原转义。非引号串原样返回（去首尾空白）。 */
function unquote(raw: string): string {
    const s = raw.trim();
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
        const inner = s.slice(1, -1);
        return inner
            .replace(/\\n/g, "\n")
            .replace(/\\t/g, "\t")
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\");
    }
    if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
        // 单引号里 '' 表示一个字面单引号，其余不转义（YAML 规范）
        return s.slice(1, -1).replace(/''/g, "'");
    }
    return s;
}

/** 该行是否一个「key:」或「key: value」结构的开头。 */
function matchKeyLine(line: string): { key: string; rest: string } | null {
    const m = /^([A-Za-z0-9_.-]+)\s*:(.*)$/.exec(line);
    if (!m) return null;
    return { key: m[1], rest: m[2].trim() };
}

/**
 * 把一段「全部是缩进行」的 YAML 块尽力解析成数组或对象。
 *
 * 只做 Kirari 需要的深度：这些元数据（metadata / permissions / capabilities…）
 * Kirari 不解释、只透传展示，所以**宁可解析成字符串也不要抛错** ——
 * 一个技能因为私有元数据格式奇特就整个用不了，是更糟的结果。
 *
 * 支持的形态：
 *   - a / - b               → ["a","b"]
 *   - name: x               → { name: "x" }（值为空的 key 继续递归）
 *   mixed                   → 数组（保留每行原文，不丢信息）
 */
function parseIndentedBlock(lines: readonly string[]): string[] | Record<string, unknown> {
    const meaningful = lines.filter((l) => l.trim() && !l.trim().startsWith("#"));
    if (!meaningful.length) return [];

    // 全是 `- item` → 数组
    if (meaningful.every((l) => /^\s*-\s+/.test(l) || /^\s*-$/.test(l))) {
        return meaningful.map((l) => {
            const m = /^\s*-\s+(.*)$/.exec(l);
            return unquote(m ? m[1] : "");
        });
    }
    // 全是 `key: ...` 或 `- key: ...`（带子项的列表）→ 对象 / 数组
    const obj: Record<string, unknown> = {};
    let ok = true;
    for (const l of meaningful) {
        const body = l.trim().replace(/^-\s+/, "");
        const kv = matchKeyLine(body);
        if (!kv) {
            ok = false;
            break;
        }
        obj[kv.key] = kv.rest === "" ? [] : unquote(kv.rest);
    }
    if (ok && Object.keys(obj).length) return obj;
    // 混合形态：原样保留每行（信息不丢，展示时也能看出结构）
    return meaningful.map((l) => l.trim());
}

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
export function parseFrontmatter(raw: string, where = "SKILL.md"): FrontmatterParseResult {
    if (typeof raw !== "string") fail(where, "内容必须是字符串");
    // 去 BOM、去开头空行；frontmatter 必须从第一行开始
    const text = raw.replace(/^\uFEFF/, "").replace(/^(?:[ \t]*\r?\n)+/, "");
    const openMatch = /^---[ \t]*\r?\n/.exec(text);
    if (!openMatch) fail(where, "必须以 frontmatter 起始标记 --- 开头（第一行）");

    const lines = text.slice(openMatch[0].length).split(/\r?\n/);
    let closeIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (t === "---" || t === "...") {
            closeIdx = i;
            break;
        }
    }
    if (closeIdx < 0) fail(where, "缺少 frontmatter 闭合标记 ---");

    const meta: Record<string, string | string[] | Record<string, unknown>> = {};
    const fm = lines.slice(0, closeIdx);

    let i = 0;
    while (i < fm.length) {
        const line = fm[i];
        if (!line.trim() || line.trim().startsWith("#")) {
            i++;
            continue;
        }
        // 顶层 key 必须顶格（YAML 里缩进行属于上一层）。
        // 走到这里还遇到缩进行，说明上一轮没消费干净（罕见嵌套形态）。
        // 容忍跳过而不是报错：技能文件里多一层私有元数据不该让整个技能失效。
        if (/^[ \t]/.test(line)) {
            i++;
            continue;
        }
        // 顶格的孤立引号行（`'` 或 `"`）：是上一层嵌套里跨行引号标量的**闭合行**。
        // 真实例子：metadata.notes: '多行……（空行）……' 而闭合引号被写到顶格，
        // 于是它落在 metadata 块外面。若按 key 解析会直接报「缺少 key: value」
        // 让整个技能作废 —— 但它其实是个合法的（虽然排版很糟的）文件。
        // 跳过即可：那个值已经随上一层块被吞进去了，这里只是收尾。
        if (/^['"]$/.test(line.trim())) {
            i++;
            continue;
        }
        const kv = matchKeyLine(line);
        if (!kv) fail(where, `frontmatter 第 ${i + 1} 行缺少 key: value 结构`);
        i++;

        // 1) 块标量：`key: >` / `key: |` / `key: >-` / `key: |+` 等
        const blockMatch = /^([|>])([+-]?)\d*$/.exec(kv.rest);
        if (blockMatch) {
            const folded = blockMatch[1] === ">";
            const chomp = blockMatch[2];
            const collected: string[] = [];
            let blockIndent = -1;
            while (i < fm.length) {
                const l = fm[i];
                if (!l.trim()) {
                    collected.push("");
                    i++;
                    continue;
                }
                const indent = l.length - l.trimStart().length;
                if (blockIndent < 0) blockIndent = indent;
                if (indent < blockIndent) break;
                collected.push(l.slice(blockIndent));
                i++;
            }
            // 去掉尾部空行（除非 |+ 保留）
            if (chomp !== "+") {
                while (collected.length && collected[collected.length - 1] === "") collected.pop();
            }
            let value: string;
            if (folded) {
                // 折叠：单个换行变空格，空行变换行
                value = collected.reduce((acc, cur, idx) => {
                    if (idx === 0) return cur;
                    if (cur === "") return acc + "\n";
                    if (acc.endsWith("\n")) return acc + cur;
                    return acc + " " + cur;
                }, "");
            } else {
                value = collected.join("\n");
            }
            meta[kv.key] = value.trim();
            continue;
        }

        // 2) 空值：后面跟缩进块（块序列 or 嵌套映射，可能有任意深），
        //    或者**顶格的 `- item`** 列表（YAML 允许序列与父 key 同缩进）：
        //      tags:
        //      - a
        //      - b
        //    做法是**先无条件吃掉整块**，再尽力解析成数组/对象。
        //    为什么不用「边解析边判断」：真实技能里嵌套能到四五层
        //    （metadata.clawdbot.requires.env / capabilities.deny…），
        //    逐层判断一旦漏一种形态，剩下的行就会撞到顶层 key 检查、
        //    让整个技能作废。元数据对 Kirari 只是透传展示，不值得冒这个风险。
        if (kv.rest === "") {
            const block: string[] = [];
            while (i < fm.length) {
                const l = fm[i];
                if (!l.trim()) {
                    i++;
                    continue;
                }
                const indented = /^[ \t]/.test(l);
                // 顶格时只有 `- item` 仍属于本 key（同缩进序列），否则是下一个 key
                if (!indented && !/^-(\s|$)/.test(l)) break;
                block.push(l);
                i++;
            }
            meta[kv.key] = parseIndentedBlock(block);
            continue;
        }

        // 3) 普通标量（可能带引号，也可能是跨多行的普通标量）
        //    YAML 允许普通标量折行续写，续行缩进且不是 key:：
        //      description: 前半句，
        //        ad spy, app intelligence, ...
        //    引号也可能跨行（'前半, \n  后半'），所以必须**先拼接再去引号**，
        //    逐行去引号会把开头的 ' 当正文留下来。
        //
        //    ⚠️ 还有一种真实写法：引号内正文里夹了空行，闭合引号单独一行且**顶格**：
        //      description: '第一段
        //
        //      第二段
        //
        //      '
        //    这时不能把闭合引号那行当新的 key（它没有 key: value 结构，会直接报错
        //    让整个技能作废）。所以：只要「引号还没闭合」，就一直吃到闭合为止，
        //    不看缩进。判定用「本行前引号计数是否闭合」，纯文本计数对技能文件足够。
        const parts: string[] = [kv.rest];
        const quoteClosed = (s: string): boolean => {
            const t = s.trim();
            if (!t) return true;
            const q = t[0];
            if (q !== "'" && q !== '"') return true;
            // 单引号里 '' 是转义的一个引号，先折叠掉再数
            const inner = q === "'" ? t.slice(1).replace(/''/g, "") : t.slice(1);
            let n = 0;
            for (const ch of inner) {
                if (ch === q) n++;
            }
            return n % 2 === 1;
        };
        let stillOpen = /^['"]/.test(kv.rest.trim()) && !quoteClosed(kv.rest);
        while (i < fm.length) {
            const l = fm[i];
            if (!l.trim()) {
                if (stillOpen) {
                    // 引号内空行：保留为换行（YAML 折叠时会变成 \n）
                    parts.push("");
                    i++;
                    continue;
                }
                i++;
                continue;
            }
            if (!stillOpen && !/^[ \t]/.test(l)) break; // 顶格 = 下一个 key
            const trimmed = l.trim();
            // 缩进行如果长得像 key: 或 - item，那就属于嵌套结构，不是续行
            if (!stillOpen && (matchKeyLine(trimmed) || /^-\s+/.test(trimmed))) break;
            parts.push(trimmed);
            i++;
            stillOpen = !quoteClosed(parts.join(" "));
        }
        meta[kv.key] = unquote(parts.join(" "));
        // 行内逗号写法：`tags: a, b, c` → 数组（老格式，与块序列并存）
        if (kv.key === "tags" && typeof meta[kv.key] === "string") {
            const s = meta[kv.key] as string;
            meta[kv.key] = s ? s.split(",").map((t) => t.trim()).filter(Boolean) : [];
        }
    }

    const body = lines.slice(closeIdx + 1).join("\n").trim();
    return { meta, body };
}

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
export function parseSkillMarkdown(raw: string, where = "SKILL.md", fallbackName?: string): ParsedSkill {
    const { meta: rawMeta, body } = parseFrontmatter(raw, where);

    const declared = typeof rawMeta.name === "string" ? rawMeta.name.trim() : "";
    const name = declared || String(fallbackName || "").trim();
    // description 兼容三种真实写法：标准 description、分语种的 description_zh /
    // description_en（技能市场里很常见，例如 conversion-ops 只有这两个）。
    // 都不写才判失败 —— 那才是真的没法让模型知道这个技能干什么。
    const pickDesc = (...keys: string[]): string => {
        for (const k of keys) {
            const v = rawMeta[k];
            if (typeof v === "string" && v.trim()) return v.trim();
        }
        return "";
    };
    const description = pickDesc("description", "description_zh", "description_en");
    if (!name) fail(where, "frontmatter 必须包含非空 name");
    if (!description) fail(where, "frontmatter 必须包含非空 description（或 description_zh / description_en）");
    if (name.length > MAX_SKILL_NAME) fail(where, `name 超过 ${MAX_SKILL_NAME} 字符`);
    if (description.length > MAX_SKILL_DESCRIPTION) {
        fail(where, `description 超过 ${MAX_SKILL_DESCRIPTION} 字符（当前 ${description.length}）`);
    }
    const tags = rawMeta.tags;
    if (Array.isArray(tags) && tags.length > MAX_SKILL_TAGS) fail(where, `tags 超过 ${MAX_SKILL_TAGS} 个`);
    if (body.length > MAX_SKILL_BODY) fail(where, `正文超过 ${MAX_SKILL_BODY} 字符（当前 ${body.length}）`);

    const meta: SkillMeta = { ...rawMeta, name, description };
    return { meta, body };
}

/** 目录摘要的一行：进 system 的只有这一行，不含正文。 */
export function skillCatalogLine(parsed: ParsedSkill, maxDescription = 0): string {
    const desc = maxDescription > 0 && parsed.meta.description.length > maxDescription
        ? parsed.meta.description.slice(0, maxDescription) + "…"
        : parsed.meta.description;
    return `- ${parsed.meta.name}: ${desc}`;
}

/** 把多个 SKILL.md 解析结果生成目录块（仍不含正文）。 */
export function buildSkillCatalog(skills: readonly ParsedSkill[], maxDescription = 0): string {
    if (!skills.length) return "";
    return "# 可用技能（需要时用 load_skill 加载正文）\n" + skills.map((s) => skillCatalogLine(s, maxDescription)).join("\n");
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

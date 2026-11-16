"use strict";
// 显式上下文注入。
//
// 替换过去 conversationService 里那行字符串拼接：
//     systemPrompt + dailyBlock + kbBlock + skillBlock
// 四段被拼进同一条 system message，没有独立 message 边界，也无法追溯
// 「哪段是哪来的」。改成显式 inject 后，每段带 source 与 order，各自落一条
// context_inject 事件，Trajectory 才能按来源分组。
//
// ⚠️ 关键决策：concatInjects 用空串 join('')，**绝不插入任何分隔符**。
//    原代码是四段直接相加，每段自带前导 \n\n；插一个字符都会让模型
//    看到的 system 变样，破坏阶段 A「行为等价」的前提。
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInjector = createInjector;
exports.concatInjects = concatInjects;
exports.buildSystemContent = buildSystemContent;
const types_1 = require("./types");
/**
 * 每轮对话创建一个 injector。把 recorder 作为依赖注入进来，而不是让 inject
 * 直接引用全局单例——这样 inject 仍是纯逻辑（可单测），同时调用方写起来
 * 还是一句 inject(source, content, meta)，不增加控制流。
 */
function createInjector(ctx) {
    const segments = [];
    return {
        inject(source, content, meta = {}) {
            const order = types_1.INJECT_SOURCES.indexOf(source);
            const segment = { source, content, order, meta };
            segments.push(segment);
            ctx.enqueue({
                origin: ctx.origin,
                sessionId: ctx.sessionId,
                turnId: ctx.turnId,
                type: "context_inject",
                payload: {
                    source,
                    content,
                    order,
                    meta,
                },
            });
            return segment;
        },
        get segments() {
            return segments;
        },
    };
}
/** 按 order 升序拼接，段间不加任何字符。 */
function concatInjects(segments) {
    return [...segments]
        .sort((a, b) => a.order - b.order)
        .map((s) => s.content)
        .join("");
}
/** 语义别名：明确「组装 system content」这件事就是无分隔符拼接。 */
function buildSystemContent(segments) {
    return concatInjects(segments);
}
//# sourceMappingURL=inject.js.map
import type { EventInput, EventOrigin, InjectSource } from "./types";
export interface InjectSegment {
    source: InjectSource;
    content: string;
    /** 固定 0..3，与 INJECT_SOURCES 顺序一致。 */
    order: number;
    meta: Record<string, unknown>;
}
export interface InjectContext {
    origin: EventOrigin;
    sessionId: string;
    turnId: string;
    /** 事件入队回调，由两端 recorder 提供；包不碰数据库、不持有全局单例。 */
    enqueue: (event: EventInput) => void;
}
export interface Injector {
    /** 返回注入段，并自动落一条 context_inject 事件。 */
    inject(source: InjectSource, content: string, meta?: Record<string, unknown>): InjectSegment;
    readonly segments: readonly InjectSegment[];
}
/**
 * 每轮对话创建一个 injector。把 recorder 作为依赖注入进来，而不是让 inject
 * 直接引用全局单例——这样 inject 仍是纯逻辑（可单测），同时调用方写起来
 * 还是一句 inject(source, content, meta)，不增加控制流。
 */
export declare function createInjector(ctx: InjectContext): Injector;
/** 按 order 升序拼接，段间不加任何字符。 */
export declare function concatInjects(segments: readonly InjectSegment[]): string;
/** 语义别名：明确「组装 system content」这件事就是无分隔符拼接。 */
export declare function buildSystemContent(segments: readonly InjectSegment[]): string;

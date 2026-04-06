/**
 * EventTypes — 事件系统公共类型定义
 *
 * 设计原则：
 *   - 仅包含对外暴露的接口与类型，与内部实现完全解耦
 *   - 依赖接口编程，便于 Mock 与替换实现
 *
 * 触发模式：
 *   - emit / emitDeferred             → 多播：按优先级顺序通知所有监听器
 *   - emitUnicast / emitDeferredUnicast → 单播：只通知优先级最高的一个监听器
 *
 * 优先级：数值越大越先触发；相同优先级按注册先后顺序触发（FIFO，稳定排序）
 *
 * 防御机制：
 *   - 触发前检测宿主上下文是否仍然有效（isAlive / isDestroyed 鸭式类型检测）
 *   - 回调异常以 console.error 记录，不阻断后续监听器
 *   - 事件无监听器时静默跳过，不抛出异常
 */

// ─── 回调类型 ─────────────────────────────────────────────────────────────────

/** 事件回调函数类型 */
export type EventCallback<T extends any[] = any[]> = (...args: T) => void;

// ─── 注册选项 ─────────────────────────────────────────────────────────────────

/**
 * 注册事件监听器时的选项
 */
export interface IEventRegOptions {
    /**
     * 触发优先级，数值越大越先触发。
     * 默认值：0
     */
    priority?: number;

    /**
     * 是否只触发一次后自动注销。
     * 默认值：false
     */
    once?: boolean;

    /**
     * 监听器的宿主上下文（通常是 `this`）。
     *
     * 作用：
     *   1. 触发前检测宿主是否仍然有效（实现了 `isAlive`/`isDestroyed` 的对象会被检测）
     *   2. 用于 `off()` 时精确匹配并注销该上下文注册的监听器
     */
    context?: object;
}

// ─── 句柄接口 ─────────────────────────────────────────────────────────────────

/**
 * 注册监听器后返回的句柄，用于后续注销。
 */
export interface IEventHandle {
    /** 监听器唯一 ID */
    readonly id: number;
    /** 该监听器是否仍处于活跃状态（未注销） */
    readonly isActive: boolean;
    /** 注销该监听器 */
    off(): void;
}

// ─── 总线接口 ─────────────────────────────────────────────────────────────────

/**
 * 事件总线接口（全局总线和模块总线共同实现）
 */
export interface IEventBus {
    /**
     * 注册多播监听器。
     * @param event    事件名
     * @param callback 回调函数
     * @param options  注册选项（优先级、once、context）
     * @returns        句柄，可调用 handle.off() 注销
     */
    on<T extends any[] = any[]>(
        event: string,
        callback: EventCallback<T>,
        options?: IEventRegOptions,
    ): IEventHandle;

    /**
     * 注册只触发一次的监听器（等同于 on + once: true）。
     */
    once<T extends any[] = any[]>(
        event: string,
        callback: EventCallback<T>,
        options?: Omit<IEventRegOptions, "once">,
    ): IEventHandle;

    /**
     * 注销监听器。
     * - 不传 callback：注销该 event 下所有监听器
     * - 只传 callback：注销所有匹配该回调的监听器
     * - 传 callback + context：精确匹配注销
     */
    off(event: string, callback?: Function, context?: object): void;

    /**
     * 瞬时多播触发：按优先级降序依次调用所有监听器。
     */
    emit<T extends any[] = any[]>(event: string, ...args: T): void;

    /**
     * 瞬时单播触发：只调用优先级最高的第一个有效监听器。
     */
    emitUnicast<T extends any[] = any[]>(event: string, ...args: T): void;

    /**
     * 延迟多播触发：经过 delayMs 毫秒后触发（需要 update 每帧驱动）。
     * @param delayMs 延迟毫秒数（>= 0）
     */
    emitDeferred<T extends any[] = any[]>(event: string, delayMs: number, ...args: T): void;

    /**
     * 延迟单播触发：经过 delayMs 毫秒后只触发优先级最高的监听器。
     */
    emitDeferredUnicast<T extends any[] = any[]>(event: string, delayMs: number, ...args: T): void;

    /**
     * 清除监听器。
     * - 不传参数：清除所有事件的监听器及延迟队列
     * - 传入 event：只清除该事件的监听器
     */
    clear(event?: string): void;

    /** 当前活跃监听器总数（不含待移除条目） */
    readonly listenerCount: number;
}

// ─── 系统接口 ─────────────────────────────────────────────────────────────────

/**
 * 事件系统模块接口
 */
export interface IEventSystem extends IEventBus {
    /**
     * 创建或获取模块专属事件总线。
     * 同一 moduleName 始终返回同一实例（幂等）。
     */
    getOrCreateModule(moduleName: string): IEventBus;

    /**
     * 获取已创建的模块专属总线，不存在时返回 undefined。
     */
    getModule(moduleName: string): IEventBus | undefined;

    /**
     * 销毁指定模块的事件总线，清除其所有监听器。
     */
    removeModule(moduleName: string): void;
}

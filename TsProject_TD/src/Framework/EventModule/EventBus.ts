/**
 * EventBus — 事件总线核心实现
 *
 * 职责：
 *   1. 管理单个总线内所有事件频道（每个频道为按优先级降序排列的监听器列表）
 *   2. 同步触发（emit / emitUnicast）与延迟触发（emitDeferred / emitDeferredUnicast）
 *   3. 触发期间监听器变更使用 Mark-Sweep 延迟清理，避免遍历中断
 *   4. 触发前执行宿主存活检测，自动清除已失效的监听器
 *
 * 优先级排序：
 *   - 注册时使用二分查找有序插入，维护频道列表始终按优先级降序排列
 *   - 相同优先级按注册先后顺序触发（FIFO，稳定）
 *
 * 宿主存活检测（鸭式类型，支持多种生命周期接口）：
 *   - context.isAlive    === false        → 跳过并移除
 *   - context.isAlive()   returns false   → 跳过并移除
 *   - context.isDestroyed === true        → 跳过并移除
 *   - context.isDestroyed() returns true  → 跳过并移除
 *   - 其他情况                            → 视为存活，正常触发
 *
 * 防御机制：
 *   - 事件无监听器时静默返回，不抛出异常
 *   - 回调内异常以 console.error 记录，不影响后续监听器或主流程
 *
 * 重入安全：
 *   - 使用 _firingDepth 深度计数器（非 boolean）追踪嵌套触发层级，
 *     仅当深度归零时才执行 sweep，避免多层嵌套时提前或遗漏清理
 *   - clear() 在触发期间改为标记 pendingRemove，物理删除推迟到深度归零后执行
 */

import type { EventCallback, IEventRegOptions, IEventHandle, IEventBus } from "./EventTypes";

// ─── 内部数据结构 ─────────────────────────────────────────────────────────────

interface EventEntry {
    id:            number;
    callback:      Function;
    /** 宿主上下文：用于 off() 精确匹配 & 触发前存活检测 */
    context:       object | null;
    priority:      number;
    once:          boolean;
    pendingRemove: boolean;
}

interface DeferredEntry {
    event:     string;
    args:      any[];
    /** 剩余等待毫秒数 */
    remaining: number;
    unicast:   boolean;
}

// ─── 句柄实现（内部，不对外导出） ─────────────────────────────────────────────

class EventHandle implements IEventHandle {
    constructor(
        private readonly _bus:   EventBus,
        readonly id:             number,
        private readonly _event: string,
    ) {}

    get isActive(): boolean {
        return this._bus.hasListener(this.id);
    }

    off(): void {
        this._bus.offById(this._event, this.id);
    }
}

// ─── 宿主存活检测 ─────────────────────────────────────────────────────────────

/**
 * 检测宿主上下文是否仍然有效。
 * 鸭式类型检测：支持 isAlive（boolean / getter / 方法）和 isDestroyed（boolean / getter / 方法）。
 * 无法识别时默认返回 true（视为存活）。
 */
function isContextAlive(context: object | null): boolean {
    if (context === null) return true;
    const c = context as Record<string, unknown>;

    if ("isAlive" in c) {
        const v = c["isAlive"];
        if (typeof v === "function") return (v as () => boolean).call(context) !== false;
        return v !== false;
    }
    if ("isDestroyed" in c) {
        const v = c["isDestroyed"];
        if (typeof v === "function") return (v as () => boolean).call(context) !== true;
        return v !== true;
    }
    return true;
}

// ─── EventBus ────────────────────────────────────────────────────────────────

export class EventBus implements IEventBus {

    /** 每个事件名对应一个按优先级降序排列的监听器列表 */
    private readonly _channels = new Map<string, EventEntry[]>();
    /** id → eventName 的快速映射，供 hasListener() 使用 */
    private readonly _idIndex  = new Map<number, string>();
    /** 待触发的延迟事件队列 */
    private readonly _deferred: DeferredEntry[] = [];

    private _nextId = 1;
    /**
     * 嵌套触发深度计数器。
     * 每次进入 _dispatch +1，退出 -1；仅深度归零时才执行 sweep。
     * 使用计数器而非 boolean，是为了正确处理回调内嵌套 emit 的重入场景：
     * 若用 boolean，内层 dispatch 结束时会将标志重置为 false，
     * 导致外层遍历期间 off() 提前触发 sweep，修改正在迭代的数组。
     */
    private _firingDepth = 0;
    /** 触发期间被标记了 pendingRemove 的频道，等深度归零后统一 sweep */
    private readonly _pendingSweep = new Set<string>();
    /** 触发期间收到无参 clear()，深度归零后需要清空全部 channels */
    private _pendingClearAll = false;

    // ── 注册 ──────────────────────────────────────────────────────────────────

    on<T extends any[] = any[]>(
        event:    string,
        callback: EventCallback<T>,
        options?: IEventRegOptions,
    ): IEventHandle {
        return this._register(event, callback, options ?? {});
    }

    once<T extends any[] = any[]>(
        event:    string,
        callback: EventCallback<T>,
        options?: Omit<IEventRegOptions, "once">,
    ): IEventHandle {
        return this._register(event, callback, { ...options, once: true });
    }

    // ── 注销 ──────────────────────────────────────────────────────────────────

    off(event: string, callback?: Function, context?: object): void {
        const channel = this._channels.get(event);
        if (!channel) return;

        for (const entry of channel) {
            if (entry.pendingRemove) continue;
            const cbMatch  = callback == null || entry.callback === callback;
            const ctxMatch = context  == null || entry.context  === context;
            if (cbMatch && ctxMatch) {
                entry.pendingRemove = true;
                this._idIndex.delete(entry.id);
            }
        }
        this._scheduleSwoop(event);
    }

    /** 通过句柄 ID 精确注销（由 EventHandle.off() 调用） */
    offById(event: string, id: number): void {
        const channel = this._channels.get(event);
        if (!channel) return;

        for (const entry of channel) {
            if (entry.id === id) {
                entry.pendingRemove = true;
                this._idIndex.delete(id);
                break;
            }
        }
        this._scheduleSwoop(event);
    }

    // ── 瞬时触发 ──────────────────────────────────────────────────────────────

    emit<T extends any[] = any[]>(event: string, ...args: T): void {
        this._dispatch(event, false, args);
    }

    emitUnicast<T extends any[] = any[]>(event: string, ...args: T): void {
        this._dispatch(event, true, args);
    }

    // ── 延迟触发 ──────────────────────────────────────────────────────────────

    emitDeferred<T extends any[] = any[]>(event: string, delayMs: number, ...args: T): void {
        this._deferred.push({ event, args, remaining: Math.max(0, delayMs), unicast: false });
    }

    emitDeferredUnicast<T extends any[] = any[]>(event: string, delayMs: number, ...args: T): void {
        this._deferred.push({ event, args, remaining: Math.max(0, delayMs), unicast: true });
    }

    // ── 清除 ──────────────────────────────────────────────────────────────────

    clear(event?: string): void {
        if (event != null) {
            const channel = this._channels.get(event);
            if (!channel) return;
            for (const e of channel) {
                e.pendingRemove = true;
                this._idIndex.delete(e.id);
            }
            // 触发期间：物理删除推迟到 _scheduleSwoop，深度归零时统一 sweep
            this._scheduleSwoop(event);
        } else {
            // 全清：将所有频道条目标记 pendingRemove，阻止当前 dispatch 继续调用回调
            for (const ch of this._channels.values()) {
                for (const e of ch) e.pendingRemove = true;
            }
            this._idIndex.clear();
            this._deferred.length = 0;
            if (this._firingDepth === 0) {
                this._channels.clear();
                this._pendingSweep.clear();
            } else {
                // 触发期间：设标志，_channels 保留引用供 dispatch 的 for...of 安全结束；
                // 深度归零后 _flushSweep 统一清空所有 channel，彻底释放内存。
                this._pendingClearAll = true;
                this._pendingSweep.clear();
            }
        }
    }

    // ── 状态查询 ──────────────────────────────────────────────────────────────

    get listenerCount(): number {
        return this._idIndex.size;
    }

    /** 判断某 ID 的监听器是否仍然活跃（供 EventHandle.isActive 使用） */
    hasListener(id: number): boolean {
        return this._idIndex.has(id);
    }

    // ── update 驱动（延迟事件倒计时）─────────────────────────────────────────

    /**
     * 驱动延迟事件队列，由 EventSystem.onUpdate 每帧调用。
     * @param deltaMs 本帧经过毫秒数（= Unity deltaTime × 1000）
     */
    update(deltaMs: number): void {
        if (this._deferred.length === 0) return;

        // 逆序遍历，安全地 splice 已到期的条目。
        // 每次迭代开始前先校验索引边界：dispatch 触发的回调有可能调用 clear()
        // 将 _deferred 清空，若不做边界检查会以 undefined 访问已不存在的条目。
        for (let i = this._deferred.length - 1; i >= 0; i--) {
            if (i >= this._deferred.length) break;
            const d = this._deferred[i];
            d.remaining -= deltaMs;
            if (d.remaining <= 0) {
                this._deferred.splice(i, 1);
                this._dispatch(d.event, d.unicast, d.args);
            }
        }
    }

    // ── 私有辅助 ──────────────────────────────────────────────────────────────

    private _register(
        event:    string,
        callback: Function,
        options:  IEventRegOptions,
    ): IEventHandle {
        const id: number = this._nextId++;
        const entry: EventEntry = {
            id,
            callback,
            context:       options.context  ?? null,
            priority:      options.priority ?? 0,
            once:          options.once     ?? false,
            pendingRemove: false,
        };

        let channel = this._channels.get(event);
        if (!channel) {
            channel = [];
            this._channels.set(event, channel);
        }
        this._insertSorted(channel, entry);
        this._idIndex.set(id, event);

        return new EventHandle(this, id, event);
    }

    /**
     * 按优先级降序有序插入（二分查找 + splice）。
     * 相同优先级按注册先后触发（FIFO 稳定性）。
     */
    private _insertSorted(channel: EventEntry[], entry: EventEntry): void {
        // 找到第一个 priority < entry.priority 的位置，插到它前面
        // 等价于：跳过所有 priority >= entry.priority 的条目
        let lo = 0, hi = channel.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (channel[mid].priority >= entry.priority) lo = mid + 1;
            else hi = mid;
        }
        channel.splice(lo, 0, entry);
    }

    /**
     * 核心分发逻辑。
     * - 无监听器时静默返回（防御机制）
     * - 触发前检测宿主存活状态，失效则标记移除并跳过
     * - 回调异常仅记录日志，不影响后续监听器
     * - unicast 模式触发第一个有效监听器后立即 break
     */
    private _dispatch(event: string, unicast: boolean, args: any[]): void {
        const channel = this._channels.get(event);
        if (!channel || channel.length === 0) return;

        this._firingDepth++;
        for (const entry of channel) {
            if (entry.pendingRemove) continue;

            // 宿主存活检测：失效则自动清除，不触发
            if (!isContextAlive(entry.context)) {
                entry.pendingRemove = true;
                this._idIndex.delete(entry.id);
                continue;
            }

            if (entry.once) {
                entry.pendingRemove = true;
                this._idIndex.delete(entry.id);
            }

            try {
                entry.callback.call(entry.context, ...args);
            } catch (err) {
                console.error(
                    `[EventBus] Uncaught error in listener for "${event}" (id=${entry.id}):`, err,
                );
            }

            if (unicast) break;
        }
        this._firingDepth--;
        if (this._firingDepth === 0) this._flushSweep();
    }

    /**
     * 触发期间需要 sweep 时，将事件名加入待处理集合；
     * 非触发期间直接执行物理清理。
     */
    private _scheduleSwoop(event: string): void {
        if (this._firingDepth === 0) {
            this._sweepChannel(event);
        } else {
            this._pendingSweep.add(event);
        }
    }

    /**
     * 深度归零后统一执行所有挂起的 sweep。
     * 若收到过全清标志，直接清空 _channels 并重置标志。
     */
    private _flushSweep(): void {
        if (this._pendingClearAll) {
            this._pendingClearAll = false;
            this._pendingSweep.clear();
            this._channels.clear();
            return;
        }
        for (const ev of this._pendingSweep) {
            this._sweepChannel(ev);
        }
        this._pendingSweep.clear();
    }

    /** 移除频道内所有标记了 pendingRemove 的条目，频道为空时从 Map 中删除 */
    private _sweepChannel(event: string): void {
        const channel = this._channels.get(event);
        if (!channel) return;

        let write = 0;
        for (let i = 0; i < channel.length; i++) {
            if (!channel[i].pendingRemove) channel[write++] = channel[i];
        }
        channel.length = write;
        if (write === 0) this._channels.delete(event);
    }
}

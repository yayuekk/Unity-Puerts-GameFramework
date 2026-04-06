/**
 * ObjectPool — 单类型对象池核心实现
 *
 * 职责：
 *   - 维护闲置对象栈（LIFO，利用 CPU 缓存局部性）与使用中对象集合
 *   - 通过引用计数（refCount = inUse 数量）驱动空闲计时器
 *   - 引用计数归零并持续空闲超过 autoDestroyDelay 后，通知上层自动销毁
 *   - 提供 warmupSync() 供分帧预热调度器逐帧批量填充
 *
 * 设计约定：
 *   - get()       idleSeconds 重置，refCount + 1，调用 factory.onGet
 *   - return()    refCount - 1，调用 factory.onReturn；超出 maxCapacity 则调用 factory.onDestroy
 *   - destroy()   清空闲置栈并标记 isAlive = false；使用中对象不受影响（由调用方管理）
 */

import type { IPoolItemFactory, IPoolConfig, IPoolStats, IPool } from "./PoolTypes";

// ─── ObjectPool ───────────────────────────────────────────────────────────────

export class ObjectPool<T> implements IPool<T> {

    readonly name: string;

    private readonly _factory:          IPoolItemFactory<T>;
    private readonly _maxCapacity:      number;
    private readonly _autoDestroyDelay: number;

    /** 闲置对象栈（LIFO） */
    private readonly _available: T[]   = [];
    /** 使用中对象集合，用于幂等性校验 */
    private readonly _inUse:     Set<T> = new Set();

    private _idleSeconds: number  = 0;
    private _isAlive:     boolean = true;

    // ── 构造 ──────────────────────────────────────────────────────────────────

    constructor(config: IPoolConfig<T>) {
        this.name               = config.name;
        this._factory           = config.factory;
        this._maxCapacity       = config.maxCapacity      ?? 0;
        this._autoDestroyDelay  = config.autoDestroyDelay ?? 60;
    }

    // ── IPool 属性 ────────────────────────────────────────────────────────────

    get available(): number { return this._available.length; }
    get inUse():     number { return this._inUse.size; }
    get total():     number { return this._available.length + this._inUse.size; }
    get refCount():  number { return this._inUse.size; }
    get isAlive():   boolean { return this._isAlive; }

    // ── IPool 操作 ────────────────────────────────────────────────────────────

    /**
     * 从池中取出一个对象。
     * 池为空时调用 factory.create() 创建新实例；空闲计时器重置。
     */
    get(): T {
        if (!this._isAlive) {
            throw new Error(`[ObjectPool] "${this.name}" is destroyed. Cannot get().`);
        }
        this._idleSeconds = 0;

        const item = this._available.length > 0
            ? this._available.pop()!
            : this._factory.create();

        this._inUse.add(item);
        this._factory.onGet(item);
        return item;
    }

    /**
     * 将对象归还池中（幂等：重复归还同一对象安全，静默忽略）。
     * 超出 maxCapacity 时调用 factory.onDestroy 永久销毁该实例。
     *
     * 若池已被 destroy()（如手动 clearPool），直接调用 onDestroy 销毁对象，
     * 避免 onReturn 访问已销毁的 poolRoot / 已释放的资产句柄。
     */
    return(item: T): void {
        if (!this._inUse.has(item)) return;

        this._inUse.delete(item);

        if (!this._isAlive) {
            this._factory.onDestroy(item);
            return;
        }

        this._factory.onReturn(item);

        const poolFull = this._maxCapacity > 0 && this._available.length >= this._maxCapacity;
        if (poolFull) {
            this._factory.onDestroy(item);
        } else {
            this._available.push(item);
        }
    }

    /**
     * 同步预热指定数量（立即批量创建，不分帧）。
     * 实际创建数受 maxCapacity 约束；池已死时静默跳过。
     * @returns 实际创建的对象数量（≤ count）
     */
    warmupSync(count: number): number {
        if (!this._isAlive || count <= 0) return 0;

        const room = this._maxCapacity > 0
            ? Math.max(0, this._maxCapacity - this._available.length - this._inUse.size)
            : count;
        const actual = Math.min(count, room);

        for (let i = 0; i < actual; i++) {
            this._available.push(this._factory.create());
        }
        return actual;
    }

    /**
     * 销毁所有闲置对象（调用 onDestroy），使用中对象不受影响。
     * 池本身保持存活，可继续使用。
     */
    clear(): void {
        for (const item of this._available) {
            this._factory.onDestroy(item);
        }
        this._available.length = 0;
    }

    /**
     * 彻底销毁对象池：清空闲置对象、调用工厂的 dispose()（如有）并标记为死亡。
     * 调用后 isAlive = false，后续 get() 会抛出错误。
     * 对于 ResGameObjectFactory，dispose() 会 release IResHandle，触发 ResSystem 卸载 Prefab。
     */
    destroy(): void {
        this.clear();
        this._factory.dispose?.();
        this._isAlive = false;
    }

    getStats(): IPoolStats {
        return {
            name:        this.name,
            available:   this._available.length,
            inUse:       this._inUse.size,
            total:       this._available.length + this._inUse.size,
            refCount:    this._inUse.size,
            isWarming:   false, // 由 PoolSystem.getAllStats() 填充实际值
            idleSeconds: this._idleSeconds,
        };
    }

    // ── 内部接口（供 PoolSystem 调用）─────────────────────────────────────────

    /**
     * 每帧更新空闲计时器，返回 true 表示应由 PoolSystem 触发自动销毁。
     *
     * 规则：
     *   - refCount > 0（有对象在外部使用）时重置计时器
     *   - refCount = 0 且 autoDestroyDelay > 0 时累积空闲时间
     *   - 空闲时间超出阈值 → 返回 true
     */
    updateIdleTimer(dt: number): boolean {
        if (!this._isAlive) return true;
        if (this._autoDestroyDelay <= 0) return false;

        if (this._inUse.size === 0) {
            this._idleSeconds += dt;
            return this._idleSeconds >= this._autoDestroyDelay;
        }

        // 有对象在外部使用时，保持计时器清零（避免"一还清即超时"）
        this._idleSeconds = 0;
        return false;
    }
}

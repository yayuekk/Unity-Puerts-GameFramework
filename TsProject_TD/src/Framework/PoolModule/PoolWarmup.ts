/**
 * PoolWarmup — 分帧预热调度器
 *
 * 职责：
 *   - 维护预热任务队列（FIFO），每帧取队首任务执行
 *   - 根据 ComputingSystem 提供的 cpuLoad 动态调整每帧预热数量：
 *       cpuLoad ≥ 1.0  →  0 个（本帧完全跳过，避免卡帧）
 *       cpuLoad ≥ 0.8  →  1 个（CPU 重载，极低预算）
 *       cpuLoad ≥ 0.6  →  2 个（CPU 高负荷，保守预算）
 *       cpuLoad ≥ 0.4  →  4 个（CPU 适中，常规预算）
 *       cpuLoad <  0.4  →  8 个（CPU 轻负载，积极预热）
 *
 * 调度策略：
 *   - FIFO：优先完成最早提交的任务，避免饥饿
 *   - 每帧仅处理一个任务，保证单帧对象创建数量可控
 *   - 已取消或对象池已死亡的任务在下一帧自动清理
 */

import type { IWarmupHandle } from "./PoolTypes";
import type { ObjectPool }    from "./ObjectPool";

// ─── 内部任务数据 ──────────────────────────────────────────────────────────────

/** 预热任务内部数据（不对外暴露） */
interface WarmupTaskData<T = any> {
    pool:           ObjectPool<T>;
    totalCount:     number;
    completedCount: number;
    cancelled:      boolean;
}

// ─── WarmupHandle ─────────────────────────────────────────────────────────────

/** 预热句柄实现，封装任务数据引用以供外部监控与取消 */
export class WarmupHandle<T = any> implements IWarmupHandle {

    private readonly _task: WarmupTaskData<T>;

    constructor(task: WarmupTaskData<T>) {
        this._task = task;
    }

    get poolName():        string  { return this._task.pool.name; }
    get totalCount():      number  { return this._task.totalCount; }
    get completedCount():  number  { return this._task.completedCount; }
    get isCancelled():     boolean { return this._task.cancelled; }

    get isDone(): boolean {
        return this._task.cancelled
            || this._task.completedCount >= this._task.totalCount;
    }

    cancel(): void {
        this._task.cancelled = true;
    }
}

// ─── PoolWarmupScheduler ──────────────────────────────────────────────────────

export class PoolWarmupScheduler {

    private readonly _tasks: WarmupTaskData[] = [];

    // ── 任务管理 ──────────────────────────────────────────────────────────────

    /**
     * 向队列尾部添加预热任务，返回可监控/取消的句柄。
     * 若目标池已死亡，任务将在首次 update 时被自动丢弃。
     */
    schedule<T>(pool: ObjectPool<T>, count: number): WarmupHandle<T> {
        const task: WarmupTaskData<T> = {
            pool,
            totalCount:     count,
            completedCount: 0,
            cancelled:      false,
        };
        this._tasks.push(task);
        return new WarmupHandle(task);
    }

    /** 是否存在指定池名称的未完成预热任务 */
    isPoolWarming(poolName: string): boolean {
        return this._tasks.some(
            t => !t.cancelled && t.pool.isAlive && t.pool.name === poolName
        );
    }

    /** 当前队列中未完成任务数量 */
    get pendingCount(): number {
        return this._tasks.length;
    }

    // ── 每帧调度 ──────────────────────────────────────────────────────────────

    /**
     * 每帧调用，根据 cpuLoad 执行本帧预热预算。
     * 每帧仅处理队首一个有效任务，保证创建数量严格受控。
     *
     * 完成条件（满足任一即移除任务）：
     *   1. completedCount 达到 totalCount（正常完成）
     *   2. warmupSync 实际创建数 < 请求数（pool 已达 maxCapacity，无法继续预热）
     */
    update(cpuLoad: number): void {
        // 先清理队首已失效的任务
        this._pruneHead();
        if (this._tasks.length === 0) return;

        const budget = this._calcBudget(cpuLoad);
        if (budget <= 0) return;

        const task = this._tasks[0];
        const remaining       = task.totalCount - task.completedCount;
        const batchSize       = Math.min(budget, remaining);
        const actualCreated   = task.pool.warmupSync(batchSize);
        task.completedCount  += actualCreated;

        // pool 满容（actualCreated < batchSize）或自然完成，均视为任务结束
        if (task.completedCount >= task.totalCount || actualCreated < batchSize) {
            this._tasks.shift();
        }
    }

    /** 取消并清空所有待处理任务（不回滚已完成的对象） */
    cancelAll(): void {
        for (const t of this._tasks) {
            t.cancelled = true;
        }
        this._tasks.length = 0;
    }

    // ── 私有辅助 ──────────────────────────────────────────────────────────────

    /**
     * 移除队首所有无效任务（已取消 / 对象池已死 / 已完成）。
     * 保持队列整洁，避免 update 每次都要跳过大量废弃任务。
     */
    private _pruneHead(): void {
        while (this._tasks.length > 0) {
            const front = this._tasks[0];
            const isInvalid =
                front.cancelled ||
                !front.pool.isAlive ||
                front.completedCount >= front.totalCount;

            if (isInvalid) {
                this._tasks.shift();
            } else {
                break;
            }
        }
    }

    /**
     * 根据 CPU 负载计算本帧最大预热数量。
     * 超出 1.0 时返回 0，表示当帧已超预算，完全跳过预热。
     */
    private _calcBudget(cpuLoad: number): number {
        if (cpuLoad >= 1.0) return 0;
        if (cpuLoad >= 0.8) return 1;
        if (cpuLoad >= 0.6) return 2;
        if (cpuLoad >= 0.4) return 4;
        return 8;
    }
}

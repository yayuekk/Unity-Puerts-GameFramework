/**
 * TimerSystem — 计时器系统核心
 *
 * 职责：管理所有计时器条目的生命周期（添加、更新、移除）。
 * 策略分发、句柄创建等职责已拆分至独立文件，本文件只关注调度逻辑。
 */

import type { GameFramework, IModule } from "../GameFramework";
import type { ITimerHandle, ITimerSystem } from "./TimerTypes";
import { TimerType } from "./TimerTypes";
import type { TimerEntry } from "./TimerEntry";
import { getStrategy, type ITickStrategy } from "./TickStrategy";
import { TimerHandle } from "./TimerHandle";
import type { ITimerController } from "./TimerHandle";

export class TimerSystem implements IModule, ITimerSystem, ITimerController {

    readonly moduleName = "TimerSystem";

    private readonly _timers = new Map<number, TimerEntry>();
    /** tick 过程中标记待删除的 ID，tick 结束后统一清除（Mark-Sweep） */
    private readonly _pendingRemove: number[] = [];
    /** tick 开始时快照当前所有 ID，防止同帧新增的计时器被立即 tick */
    private readonly _tickIds: number[] = [];
    private _nextId = 1;
    private _activeCount = 0;
    private _ticking = false;

    // ── IModule 生命周期 ──────────────────────────────────────────────────────

    onInit(_fw: GameFramework): void { /* 无外部依赖 */ }

    onUpdate(deltaTime: number): void {
        this._ticking = true;

        // 先快照 ID 列表，防止回调中新增的计时器在同一帧被 tick
        for (const id of this._timers.keys()) this._tickIds.push(id);

        for (const id of this._tickIds) {
            const entry = this._timers.get(id);
            if (!entry || entry.paused || entry.pendingRemove) continue;

            const strategy = getStrategy(entry.type);
            if (!strategy.tick(entry, deltaTime)) continue;

            this._fire(entry, strategy);
        }

        this._tickIds.length = 0;
        this._ticking = false;
        this._sweep();
    }

    onShutdown(): void {
        this.clearAll();
    }

    // ── ITimerSystem 公开 API ─────────────────────────────────────────────────

    addFrameTimer(interval: number, callback: () => void, repeat = 1): ITimerHandle {
        return this._add(TimerType.Frame, Math.max(1, Math.floor(interval)), callback, repeat);
    }

    addSecondTimer(interval: number, callback: () => void, repeat = 1): ITimerHandle {
        return this._add(TimerType.Second, Math.max(0.001, interval), callback, repeat);
    }

    addMinuteTimer(interval: number, callback: () => void, repeat = 1): ITimerHandle {
        return this._add(TimerType.Minute, Math.max(0.001, interval) * 60, callback, repeat);
    }

    removeTimer(id: number): boolean {
        const entry = this._timers.get(id);
        if (!entry || entry.pendingRemove) return false;
        this._markRemove(entry);
        if (!this._ticking) this._sweep();
        return true;
    }

    pauseTimer(id: number): void {
        const entry = this._timers.get(id);
        if (entry && !entry.pendingRemove) entry.paused = true;
    }

    resumeTimer(id: number): void {
        const entry = this._timers.get(id);
        if (entry && !entry.pendingRemove) entry.paused = false;
    }

    resetTimer(id: number): void {
        const entry = this._timers.get(id);
        if (entry && !entry.pendingRemove) entry.elapsed = 0;
    }

    clearAll(): void {
        this._timers.clear();
        this._pendingRemove.length = 0;
        this._activeCount = 0;
    }

    get activeCount(): number {
        return this._activeCount;
    }

    // ── ITimerController（供 TimerHandle 回调）────────────────────────────────

    isTimerActive(id: number): boolean {
        const entry = this._timers.get(id);
        return entry != null && !entry.pendingRemove;
    }

    isTimerPaused(id: number): boolean {
        return this._timers.get(id)?.paused ?? false;
    }

    // ── 私有辅助 ──────────────────────────────────────────────────────────────

    private _add(
        type: TimerType,
        interval: number,
        callback: () => void,
        repeat: number,
    ): ITimerHandle {
        const id = this._nextId++;
        const entry: TimerEntry = {
            id, type, interval,
            elapsed: 0,
            remaining: repeat <= 0 ? -1 : repeat,
            callback,
            paused: false,
            pendingRemove: false,
        };
        this._timers.set(id, entry);
        this._activeCount++;
        return new TimerHandle(this, id);
    }

    private _fire(entry: TimerEntry, strategy: ITickStrategy): void {
        try {
            entry.callback();
        } catch (err) {
            console.error(`[TimerSystem] Uncaught error in timer #${entry.id}:`, err);
        }

        // 回调可能调用 cancel()（pendingRemove=true）或 clearAll()（entry 已从 map 中移除），
        // 两者都意味着本计时器不应继续处理生命周期逻辑
        if (entry.pendingRemove || !this._timers.has(entry.id)) return;

        if (entry.remaining === -1) {
            strategy.afterFire(entry);
        } else {
            entry.remaining--;
            if (entry.remaining <= 0) {
                this._markRemove(entry);
            } else {
                strategy.afterFire(entry);
            }
        }
    }

    private _markRemove(entry: TimerEntry): void {
        if (entry.pendingRemove) return;
        entry.pendingRemove = true;
        this._pendingRemove.push(entry.id);
        this._activeCount--;
    }

    private _sweep(): void {
        for (const id of this._pendingRemove) {
            this._timers.delete(id);
        }
        this._pendingRemove.length = 0;
    }
}

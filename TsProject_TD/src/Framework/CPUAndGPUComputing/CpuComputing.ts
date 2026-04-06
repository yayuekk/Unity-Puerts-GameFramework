/**
 * CpuSampler — CPU 帧耗时与内存采样器
 *
 * 职责：
 *   - 维护一个固定大小的滑动窗口，计算平均 FPS
 *   - 通过 UnityEngine.Profiling.Profiler 读取托管堆内存（分配量 / 预留量）
 *   - 根据目标帧耗时（ms）估算当帧 CPU 负载比例（0–1，超预算时 > 1）
 *
 * 注意：
 *   Profiler API 在 Release Build 且未开启 Development Mode 时可能不可用，
 *   访问失败时内存字段静默降级为 0，不影响帧率与负载计算。
 */

declare const CS: any;

import type { ICpuStats } from "./ComputingTypes";

const BYTES_TO_MB = 1 / (1024 * 1024);

// ─── CpuSampler ───────────────────────────────────────────────────────────────

export class CpuSampler {

    private readonly _window:    number[] = [];
    private readonly _maxWindow: number;
    private _windowSum           = 0;
    private _lastFrameTimeMs     = 0;
    private _lastFps             = 0;

    /**
     * @param windowSize 滑动窗口大小（帧数），用于计算平均 FPS，默认 60。
     */
    constructor(windowSize = 60) {
        this._maxWindow = Math.max(1, windowSize);
    }

    // ── 采样 ─────────────────────────────────────────────────────────────────

    /**
     * 每帧调用，传入 Unity Time.deltaTime（秒）。
     * deltaTime ≤ 0 时跳过以避免除零。
     */
    update(deltaTime: number): void {
        if (deltaTime <= 0) return;

        const fps = 1 / deltaTime;
        this._lastFrameTimeMs = deltaTime * 1000;
        this._lastFps         = fps;

        this._window.push(fps);
        this._windowSum += fps;
        if (this._window.length > this._maxWindow) {
            this._windowSum -= this._window.shift()!;
        }
    }

    // ── 快照 ─────────────────────────────────────────────────────────────────

    /**
     * 返回当前帧的 CPU 压力快照。
     * @param targetFrameTimeMs 目标帧耗时（ms），用于计算 cpuLoad = frameTimeMs / target。
     */
    getSnapshot(targetFrameTimeMs: number): ICpuStats {
        const frameTimeMs = this._lastFrameTimeMs;
        const fps         = this._lastFps;
        const avgFps      = this._window.length > 0
            ? this._windowSum / this._window.length
            : 0;

        let allocatedMemoryMB = 0;
        let reservedMemoryMB  = 0;
        try {
            allocatedMemoryMB =
                CS.UnityEngine.Profiling.Profiler.GetTotalAllocatedMemoryLong() * BYTES_TO_MB;
            reservedMemoryMB  =
                CS.UnityEngine.Profiling.Profiler.GetTotalReservedMemoryLong()  * BYTES_TO_MB;
        } catch {
            // Release Build 下 Profiler 不可用时静默忽略，内存字段保持 0
        }

        const cpuLoad = targetFrameTimeMs > 0
            ? Math.min(frameTimeMs / targetFrameTimeMs, 2)
            : 0;

        return { frameTimeMs, fps, avgFps, allocatedMemoryMB, reservedMemoryMB, cpuLoad };
    }

    // ── 重置 ─────────────────────────────────────────────────────────────────

    reset(): void {
        this._window.length   = 0;
        this._windowSum       = 0;
        this._lastFrameTimeMs = 0;
        this._lastFps         = 0;
    }
}

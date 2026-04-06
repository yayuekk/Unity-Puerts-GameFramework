/**
 * GpuSampler — GPU 帧耗时采样器
 *
 * 职责：
 *   - 每帧调用 FrameTimingManager.CaptureFrameTimings() 采集最新 GPU 耗时
 *   - 根据目标帧耗时（ms）估算 GPU 负载比例（0–1，超预算时 > 1）
 *
 * 降级策略：
 *   - 若 FrameTiming / FrameTimingManager 在当前平台不可用（如 OpenGL ES 2.0
 *     或 Puerts 类型绑定缺失），则 _supported = false，gpuFrameTimeMs 始终返回 -1，
 *     gpuLoad 返回 0，不影响其他模块运行。
 *   - 所有 CS 调用均包裹在 try/catch 内，运行时异常同样触发降级。
 *
 * 注意：
 *   FrameTimingManager 需要在 Project Settings → Player → Enable Frame Timing Stats
 *   中开启，否则 GetLatestTimings 将返回 0。
 */

declare const CS: any;

import { $typeof } from "puerts";
import type { IGpuStats } from "./ComputingTypes";

// ─── GpuSampler ───────────────────────────────────────────────────────────────

export class GpuSampler {

    private _gpuFrameTimeMs: number = -1;
    /** 预分配的 FrameTiming[1] C# 数组，避免每帧 GC */
    private _timings: any           = null;
    /** 平台是否支持 FrameTimingManager */
    private _supported: boolean     = false;

    constructor() {
        this._initTimings();
    }

    // ── 采样 ─────────────────────────────────────────────────────────────────

    /**
     * 每帧调用，尝试采集最新 GPU 帧耗时。
     * 平台不支持时为空操作。
     */
    update(): void {
        if (!this._supported || this._timings == null) return;
        try {
            CS.UnityEngine.FrameTimingManager.CaptureFrameTimings();
            const count: number = CS.UnityEngine.FrameTimingManager.GetLatestTimings(
                1, this._timings
            );
            if (count >= 1) {
                const timing = this._timings.GetValue(0);
                this._gpuFrameTimeMs = timing.gpuFrameTime as number;
            }
        } catch {
            // 运行时意外失败时降级，避免持续抛出异常阻塞帧循环
            this._gpuFrameTimeMs = -1;
        }
    }

    // ── 快照 ─────────────────────────────────────────────────────────────────

    /**
     * 返回当前帧的 GPU 压力快照。
     * @param targetFrameTimeMs 目标帧耗时（ms），用于计算 gpuLoad = gpuFrameTimeMs / target。
     */
    getSnapshot(targetFrameTimeMs: number): IGpuStats {
        const gpuFrameTimeMs = this._gpuFrameTimeMs;
        const gpuLoad = (gpuFrameTimeMs >= 0 && targetFrameTimeMs > 0)
            ? Math.min(gpuFrameTimeMs / targetFrameTimeMs, 2)
            : 0;
        return { gpuFrameTimeMs, gpuLoad };
    }

    // ── 重置 ─────────────────────────────────────────────────────────────────

    reset(): void {
        this._gpuFrameTimeMs = -1;
    }

    // ── 私有辅助 ──────────────────────────────────────────────────────────────

    /**
     * 预分配 FrameTiming[1] C# 数组。
     * 失败时静默标记平台不支持，不抛出异常。
     */
    private _initTimings(): void {
        try {
            this._timings = CS.System.Array.CreateInstance(
                $typeof(CS.UnityEngine.FrameTiming), 1
            );
            this._supported = true;
        } catch {
            this._timings   = null;
            this._supported = false;
        }
    }
}

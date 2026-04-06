/**
 * ComputingSystem — CPU / GPU 压力检测模块
 *
 * 职责：
 *   - 每帧采样当前的 CPU 帧耗时、平均 FPS、托管内存占用
 *   - 每帧采样 GPU 帧耗时（依赖 FrameTimingManager，不支持时静默降级）
 *   - 对外提供 ICpuStats / IGpuStats 快照及 0–1 负载比例
 *
 * 使用约定：
 *   1. 负载 > 1 表示当帧超出目标帧时间预算（掉帧风险）
 *   2. GPU 耗时在不支持的平台上返回 -1，gpuLoad 为 0
 *   3. 通过 setTargetFps() 可动态调整参考帧率（默认跟随 Application.targetFrameRate）
 *
 * 注册示例（src/index.cts）：
 *   framework.registerModule(new ComputingSystem());
 *
 * 获取示例：
 *   const cs = framework.getModule<IComputingSystem>("ComputingSystem");
 *   console.log(cs.cpuLoad, cs.gpuLoad);
 */

declare const CS: any;

import type { GameFramework, IModule } from "../GameFramework";
import type { ILogChannelHandle }      from "../LogModule";
import type { LogSystem }              from "../LogModule";
import type { ICpuStats, IGpuStats, IComputingSystem } from "./ComputingTypes";
import { CpuSampler } from "./CpuComputing";
import { GpuSampler } from "./GupComputing";

// ─── ComputingSystem ──────────────────────────────────────────────────────────

export class ComputingSystem implements IModule, IComputingSystem {

    readonly moduleName = "ComputingSystem";

    private readonly _cpu: CpuSampler = new CpuSampler(60);
    private readonly _gpu: GpuSampler = new GpuSampler();

    private _targetFps: number   = 60;
    private _cpuStats: ICpuStats = ComputingSystem._zeroCpuStats();
    private _gpuStats: IGpuStats = { gpuFrameTimeMs: -1, gpuLoad: 0 };
    private _log?: ILogChannelHandle;

    // ── IModule 生命周期 ──────────────────────────────────────────────────────

    onInit(fw: GameFramework): void {
        const logSys = fw.tryGetModule<LogSystem>("LogSystem");
        this._log = logSys?.registerChannel("computing", "ComputingSystem");

        // 读取项目目标帧率作为初始基准，若为 -1（不限帧）则默认 60
        try {
            const appTarget: number = CS.UnityEngine.Application.targetFrameRate;
            this._targetFps = appTarget > 0 ? appTarget : 60;
        } catch {
            this._targetFps = 60;
        }

        this._log?.info(`ComputingSystem initialized. targetFps=${this._targetFps}`);
    }

    onUpdate(deltaTime: number): void {
        this._cpu.update(deltaTime);
        this._gpu.update();

        const targetMs = 1000 / this._targetFps;
        this._cpuStats = this._cpu.getSnapshot(targetMs);
        this._gpuStats = this._gpu.getSnapshot(targetMs);
    }

    onShutdown(): void {
        this._cpu.reset();
        this._gpu.reset();
        this._log?.info("ComputingSystem shutdown.");
    }

    // ── IComputingSystem ──────────────────────────────────────────────────────

    get cpuStats(): ICpuStats { return this._cpuStats; }
    get gpuStats(): IGpuStats { return this._gpuStats; }
    get cpuLoad():  number    { return this._cpuStats.cpuLoad; }
    get gpuLoad():  number    { return this._gpuStats.gpuLoad; }
    get targetFps(): number   { return this._targetFps; }

    /**
     * 设置目标帧率基准。
     * fps ≤ 0 时重新读取 Application.targetFrameRate（仍为 -1/0 则保持 60）。
     */
    setTargetFps(fps: number): void {
        if (fps <= 0) {
            try {
                const appTarget: number = CS.UnityEngine.Application.targetFrameRate;
                this._targetFps = appTarget > 0 ? appTarget : 60;
            } catch {
                this._targetFps = 60;
            }
        } else {
            this._targetFps = fps;
        }
        this._log?.info(`targetFps updated to ${this._targetFps}`);
    }

    // ── 私有辅助 ──────────────────────────────────────────────────────────────

    private static _zeroCpuStats(): ICpuStats {
        return {
            frameTimeMs: 0, fps: 0, avgFps: 0,
            allocatedMemoryMB: 0, reservedMemoryMB: 0, cpuLoad: 0,
        };
    }
}

/**
 * ComputingTypes — CPU / GPU 压力检测模块公共类型定义
 *
 * 设计原则：
 *   - 仅包含对外暴露的接口，与内部实现完全解耦
 *   - 负载比例（cpuLoad / gpuLoad）以目标帧耗时为基准，> 1 表示超预算（掉帧）
 */

// ─── CPU 快照 ──────────────────────────────────────────────────────────────────

/** 一帧的 CPU 压力快照（只读，每帧更新） */
export interface ICpuStats {
    /** 当前帧耗时（ms） */
    readonly frameTimeMs: number;
    /** 当前帧率（FPS） */
    readonly fps: number;
    /** 采样窗口内的滑动平均帧率（FPS） */
    readonly avgFps: number;
    /** 已分配的托管堆内存（MB），由 Profiler.GetTotalAllocatedMemoryLong 提供 */
    readonly allocatedMemoryMB: number;
    /** 已预留的托管堆内存（MB），由 Profiler.GetTotalReservedMemoryLong 提供 */
    readonly reservedMemoryMB: number;
    /**
     * CPU 负载估算（0–1，超预算时可 > 1）。
     * = frameTimeMs / targetFrameTimeMs。
     * 超过 1 表示当帧 CPU 耗时超出目标帧时间（掉帧风险）。
     */
    readonly cpuLoad: number;
}

// ─── GPU 快照 ──────────────────────────────────────────────────────────────────

/** 一帧的 GPU 压力快照（只读，每帧更新） */
export interface IGpuStats {
    /**
     * GPU 帧耗时（ms），由 FrameTimingManager 采样。
     * 若平台不支持或采样失败则为 -1。
     */
    readonly gpuFrameTimeMs: number;
    /**
     * GPU 负载估算（0–1，超预算时可 > 1）。
     * = gpuFrameTimeMs / targetFrameTimeMs；gpuFrameTimeMs < 0 时为 0。
     */
    readonly gpuLoad: number;
}

// ─── 系统接口 ──────────────────────────────────────────────────────────────────

/**
 * ComputingSystem 对外接口（面向接口编程，便于 Mock / 替换实现）。
 * 通过 framework.getModule<IComputingSystem>("ComputingSystem") 获取。
 */
export interface IComputingSystem {
    /** 当前 CPU 压力快照（每帧刷新） */
    readonly cpuStats: ICpuStats;
    /** 当前 GPU 压力快照（每帧刷新） */
    readonly gpuStats: IGpuStats;
    /** CPU 负载估算快捷属性（0–1） */
    readonly cpuLoad: number;
    /** GPU 负载估算快捷属性（0–1） */
    readonly gpuLoad: number;
    /** 当前设定的目标帧率 */
    readonly targetFps: number;
    /**
     * 设置目标帧率（用于负载比例分母）。
     * 传入 ≤ 0 时自动读取 Application.targetFrameRate（仍为 -1/0 则退回 60）。
     */
    setTargetFps(fps: number): void;
}

/**
 * GameFramework — 框架核心单例
 *
 * 职责：
 *   1. 提供全局唯一的访问入口（GameFramework.instance）
 *   2. 管理所有子模块的注册、初始化、逐帧更新与销毁
 *   3. 底层模块通过直接 getter 获取，扩展模块通过 getModule 获取
 *
 * 生命周期（由 Unity C# 侧驱动）：
 *   create() → registerModule() × N → init() → update() × N → shutdown()
 */

import type { IEventSystem } from "./EventModule";
import type { ILogSystem } from "./LogModule";
import type { ITimerSystem } from "./TimerModule";
import type { IResSystem } from "./ResModule";
import type { IPoolSystem } from "./PoolModule";
import type { ISaveSystem } from "./SaveModule";
import type { ISceneSystem } from "./SceneSystem";
import type { IComputingSystem } from "./CPUAndGPUComputing";
import type { UISystem } from "./UISystem";

// ─── 框架内置事件 ────────────────────────────────────────────────────────────

export const FrameworkEvents = {
    /** 所有模块 onInit 全部完成后触发 */
    INIT_COMPLETE: "fw:initComplete",
    /** shutdown 开始前触发，此时模块尚未销毁，可做清理前的善后工作 */
    BEFORE_SHUTDOWN: "fw:beforeShutdown",
} as const;

export type FrameworkEventKey = typeof FrameworkEvents[keyof typeof FrameworkEvents];

// ─── 底层模块名称（与 bootstrap 注册顺序一致，仅底层模块在此定义）────────────

export const CoreModuleNames = {
    EVENT: "EventSystem",
    LOG: "LogSystem",
    TIMER: "TimerSystem",
    RES: "ResSystem",
    POOL: "PoolSystem",
    SAVE: "SaveSystem",
    SCENE: "SceneSystem",
    COMPUTING: "ComputingSystem",
    UI: "UISystem",
} as const;

// ─── 模块接口 ────────────────────────────────────────────────────────────────

/**
 * 所有子系统模块需实现此接口。
 * - `moduleName`：全局唯一标识符，用于注册与查找。
 * - `onInit`：框架调用 `init()` 时执行，可在此获取其他模块引用。
 * - `onUpdate`：每帧调用（可选），deltaTime 单位为秒。
 * - `onShutdown`：框架销毁时逆序调用，释放模块持有的资源。
 */
export interface IModule {
    readonly moduleName: string;
    onInit(framework: GameFramework): void;
    onUpdate?(deltaTime: number): void;
    onShutdown(): void;
}

// ─── GameFramework ────────────────────────────────────────────────────────────

export class GameFramework {

    // ── 单例 ──────────────────────────────────────────────────────────────────

    private static _instance: GameFramework | null = null;

    /**
     * 获取框架单例。必须在 `create()` 之后调用，否则抛出异常。
     */
    static get instance(): GameFramework {
        if (!GameFramework._instance) {
            throw new Error(
                "[GameFramework] Not created yet. Call GameFramework.create() first."
            );
        }
        return GameFramework._instance;
    }

    /**
     * 创建框架单例并返回，供入口脚本调用一次。
     * 若已存在则直接返回现有实例（幂等）。
     */
    static create(): GameFramework {
        if (GameFramework._instance) {
            console.warn("[GameFramework] Instance already exists, returning existing.");
            return GameFramework._instance;
        }
        GameFramework._instance = new GameFramework();
        console.log("[GameFramework] Instance created.");
        return GameFramework._instance;
    }

    // ── 内部状态 ──────────────────────────────────────────────────────────────

    private readonly _modules: Map<string, IModule> = new Map();
    /** 只保存实现了 onUpdate 的模块，避免每帧空判断 */
    private readonly _updateables: IModule[] = [];
    private _initialized: boolean = false;

    private constructor() {}

    // ── 底层模块直接访问（由 bootstrap 优先注册，扩展模块请用 getModule）──────

    /** 全局事件总线（底层模块，直接获取） */
    get event(): IEventSystem {
        return this.getModule(CoreModuleNames.EVENT) as unknown as IEventSystem;
    }

    /** 日志系统（底层模块，直接获取） */
    get log(): ILogSystem {
        return this.getModule(CoreModuleNames.LOG) as unknown as ILogSystem;
    }

    /** 计时器系统（底层模块，直接获取） */
    get timer(): ITimerSystem {
        return this.getModule(CoreModuleNames.TIMER) as unknown as ITimerSystem;
    }

    /** 资源系统（底层模块，直接获取） */
    get res(): IResSystem {
        return this.getModule(CoreModuleNames.RES) as unknown as IResSystem;
    }

    /** 对象池系统（底层模块，直接获取） */
    get pool(): IPoolSystem {
        return this.getModule(CoreModuleNames.POOL) as unknown as IPoolSystem;
    }

    /** 存档系统（底层模块，直接获取） */
    get save(): ISaveSystem {
        return this.getModule(CoreModuleNames.SAVE) as unknown as ISaveSystem;
    }

    /** 场景系统（底层模块，直接获取） */
    get scene(): ISceneSystem {
        return this.getModule(CoreModuleNames.SCENE) as unknown as ISceneSystem;
    }

    /** CPU/GPU 性能采样（底层模块，直接获取） */
    get computing(): IComputingSystem {
        return this.getModule(CoreModuleNames.COMPUTING) as unknown as IComputingSystem;
    }

    /** UI 系统（底层模块，直接获取） */
    get ui(): UISystem {
        return this.getModule(CoreModuleNames.UI) as unknown as UISystem;
    }

    /** 框架是否已完成初始化 */
    get isInitialized(): boolean {
        return this._initialized;
    }

    // ── 模块管理 ──────────────────────────────────────────────────────────────

    /**
     * 注册一个模块。必须在 `init()` 之前调用，支持链式调用。
     */
    registerModule(module: IModule): this {
        if (this._initialized) {
            console.error(
                `[GameFramework] Cannot register "${module.moduleName}" after init().`
            );
            return this;
        }
        if (this._modules.has(module.moduleName)) {
            console.warn(
                `[GameFramework] Module "${module.moduleName}" already registered, skipping.`
            );
            return this;
        }
        this._modules.set(module.moduleName, module);
        if (typeof module.onUpdate === "function") {
            this._updateables.push(module);
        }
        console.log(`[GameFramework]   + ${module.moduleName}`);
        return this;
    }

    /**
     * 按名称获取模块（强类型）。找不到时抛出异常，适合确定存在的场景。
     */
    getModule<T extends IModule>(name: string): T {
        const mod = this._modules.get(name);
        if (!mod) {
            throw new Error(`[GameFramework] Module "${name}" not found.`);
        }
        return mod as T;
    }

    /**
     * 按名称安全获取模块，找不到返回 undefined，适合可选依赖场景。
     */
    tryGetModule<T extends IModule>(name: string): T | undefined {
        return this._modules.get(name) as T | undefined;
    }

    // ── 生命周期 ──────────────────────────────────────────────────────────────

    /**
     * 初始化框架：按注册顺序依次调用各模块的 `onInit`。
     * 由 Unity 入口脚本在 Start / Awake 阶段调用一次。
     */
    init(): void {
        if (this._initialized) {
            console.warn("[GameFramework] Already initialized.");
            return;
        }

        const total = this._modules.size;
        console.log(`[GameFramework] ── Initializing ${total} module(s) ──`);

        let okCount = 0;
        let failCount = 0;
        const t0 = Date.now();

        for (const mod of this._modules.values()) {
            const mt0 = Date.now();
            try {
                mod.onInit(this);
                const elapsed = Date.now() - mt0;
                console.log(`[GameFramework]   [OK] ${mod.moduleName}${elapsed > 0 ? ` (${elapsed}ms)` : ""}`);
                okCount++;
            } catch (err) {
                console.error(`[GameFramework]   [FAIL] ${mod.moduleName}: ${err}`);
                failCount++;
            }
        }

        this._initialized = true;
        this.event.emit(FrameworkEvents.INIT_COMPLETE);

        const elapsed = Date.now() - t0;
        if (failCount === 0) {
            console.log(`[GameFramework] ── Init complete: ${okCount}/${total} OK (${elapsed}ms) ──`);
        } else {
            console.warn(`[GameFramework] ── Init complete: ${okCount}/${total} OK, ${failCount} FAILED (${elapsed}ms) ──`);
        }
    }

    /**
     * 每帧更新：依次调用所有实现了 `onUpdate` 的模块。
     * 由 Unity 入口脚本在 Update 阶段调用。
     * @param deltaTime — Unity Time.deltaTime，单位秒
     */
    update(deltaTime: number): void {
        for (const mod of this._updateables) {
            mod.onUpdate!(deltaTime);
        }
    }

    /**
     * 销毁框架：先广播 BEFORE_SHUTDOWN 事件，再逆序调用各模块的 `onShutdown`，
     * 最后清空所有状态并释放单例。
     * 由 Unity 入口脚本在 OnDestroy 阶段调用。
     */
    shutdown(): void {
        if (!this._initialized) return;

        const total = this._modules.size;
        console.log(`[GameFramework] ── Shutting down ${total} module(s) ──`);

        this.event.emit(FrameworkEvents.BEFORE_SHUTDOWN);

        let failCount = 0;
        const mods = Array.from(this._modules.values()).reverse();
        for (const mod of mods) {
            try {
                mod.onShutdown();
                console.log(`[GameFramework]   [OK] ${mod.moduleName}`);
            } catch (err) {
                console.error(`[GameFramework]   [FAIL] ${mod.moduleName}: ${err}`);
                failCount++;
            }
        }

        this._modules.clear();
        this._updateables.length = 0;
        this._initialized = false;
        GameFramework._instance = null;

        if (failCount === 0) {
            console.log("[GameFramework] ── Shutdown complete ──");
        } else {
            console.warn(`[GameFramework] ── Shutdown complete (${failCount} error(s)) ──`);
        }
    }
}

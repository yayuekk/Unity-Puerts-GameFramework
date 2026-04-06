/**
 * GameModule — 游戏逻辑模块管理器
 *
 * 职责：
 *   - 维护游戏逻辑模块的注册表，提供按名 O(1) 查找
 *   - 驱动模块生命周期：init() → update(dt) × N → shutdown()
 *   - 作为模块间通信唯一入口：各模块通过 getModule() 获取其它模块，保证低耦合
 *
 * 设计要点：
 *   - 高性能：Map 存储 + 独立 _updateables 数组，无每帧类型判断
 *   - 低耦合：模块仅依赖 IGameModuleManager，不直接引用其它游戏模块
 *   - 高内聚：每个 IGameLogicModule 只负责一块领域逻辑
 *   - 与 Framework 一致的生命周期与命名风格，便于与 TDGameLayer 集成
 *
 * 使用示例：
 *   const manager = new GameModule();
 *   manager
 *     .registerModule(new WaveSystem())
 *     .registerModule(new BuildSystem())
 *     .registerModule(new EconomySystem());
 *   manager.init(framework);
 *   // 在 TDGameLayer.onUpdate 中：manager.update(deltaTime);
 *   // 在模块内：const build = this._manager.getModule<BuildSystem>("BuildSystem");
 */

import type { GameFramework } from "../../Framework";
import { GameLaunchModule } from "../GameLaunchModule";
import type { IGameLogicModule, IGameModuleManager } from "./GameModuleTypes";

// ─── GameModule ───────────────────────────────────────────────────────────────

export class GameModule implements IGameModuleManager {

    /** 框架引用，init(framework) 后可用 */
    private _framework!: GameFramework;

    /** 名称 → 模块实例，保证 O(1) 查找 */
    private readonly _modules = new Map<string, IGameLogicModule>();

    /** 实现了 onUpdate 的模块列表，避免每帧对全部模块做函数存在性判断 */
    private readonly _updateables: IGameLogicModule[] = [];

    private _initialized = false;

    // ── IGameModuleManager 只读视图 ───────────────────────────────────────────

    get framework(): GameFramework {
        if (!this._framework) {
            throw new Error("[GameModule] Not initialized. Call init(framework) first.");
        }
        return this._framework;
    }

    get isInitialized(): boolean {
        return this._initialized;
    }

    getModule<T extends IGameLogicModule>(name: string): T {
        const mod = this._modules.get(name);
        if (!mod) {
            throw new Error(`[GameModule] Module "${name}" not found.`);
        }
        return mod as T;
    }

    tryGetModule<T extends IGameLogicModule>(name: string): T | undefined {
        return this._modules.get(name) as T | undefined;
    }

    // ── 注册模块（模块）──────────────────────────────────────────────────────
    registerGameModule() : void {
        //TODO:这里注册游戏模块

        
        this.registerModule(new GameLaunchModule())
        
    }



    // ── 注册（init 之前）──────────────────────────────────────────────────────

    /**
     * 注册一个游戏逻辑模块。必须在 init() 之前调用，支持链式调用。
     */
    registerModule(module: IGameLogicModule): this {
        if (this._initialized) {
            console.error(
                `[GameModule] Cannot register "${module.moduleName}" after init().`
            );
            return this;
        }
        if (this._modules.has(module.moduleName)) {
            console.warn(
                `[GameModule] Module "${module.moduleName}" already registered, skipping.`
            );
            return this;
        }
        this._modules.set(module.moduleName, module);
        if (typeof module.onUpdate === "function") {
            this._updateables.push(module);
        }
        return this;
    }

    // ── 生命周期 ─────────────────────────────────────────────────────────────

    /**
     * 绑定框架并初始化所有已注册模块。由 TDGameLayer.onInit 内调用一次。
     */
    init(framework: GameFramework): void {
        if (this._initialized) {
            console.warn("[GameModule] Already initialized.");
            return;
        }
        this._framework = framework;

        const total = this._modules.size;
        for (const mod of this._modules.values()) {
            try {
                mod.onInit(this);
            } catch (err) {
                console.error(`[GameModule] onInit failed: ${mod.moduleName}`, err);
                throw err;
            }
        }
        this._initialized = true;
    }

    /**
     * 每帧更新。由 TDGameLayer.onUpdate 调用。
     */
    update(deltaTime: number): void {
        if (!this._initialized) return;
        for (const mod of this._updateables) {
            mod.onUpdate!(deltaTime);
        }
    }

    /**
     * 逆序关闭所有模块并清空注册表。由 TDGameLayer.onShutdown 调用。
     */
    shutdown(): void {
        if (!this._initialized) return;

        const mods = Array.from(this._modules.values()).reverse();
        for (const mod of mods) {
            try {
                mod.onShutdown();
            } catch (err) {
                console.error(`[GameModule] onShutdown failed: ${mod.moduleName}`, err);
            }
        }
        this._modules.clear();
        this._updateables.length = 0;
        this._initialized = false;
    }
}

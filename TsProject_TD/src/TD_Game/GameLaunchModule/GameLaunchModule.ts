/**
 * GameLaunchModule — 游戏启动模块
 *
 * 职责（高内聚）：
 *   - 游戏逻辑层的启动入口，负责 Framework 与 GAS 就绪后的首帧引导
 *   - 执行一次性的启动流程：如订阅框架事件、触发首屏 UI/场景、初始化启动阶段状态
 *   - 不承载具体玩法逻辑，仅做「启动」相关编排
 *
 * 依赖（低耦合）：
 *   - 仅依赖 IGameModuleManager，通过 manager.framework 获取 Framework，
 *     再通过 framework.getModule() 按需获取各子系统（Event、Res、Log、UI、Scene 等）
 *
 * 性能：
 *   - 不在 onUpdate 中做每帧逻辑，不加入 update 列表
 *   - Framework / GAS 在 onInit 中解析并缓存，避免重复查找
 */

import { GameFramework } from "../../Framework";
import { GASLayer, GAS_MODULE_NAME } from "../../GameplayAbilitySystem";
import type { IGameLogicModule, IGameModuleManager } from "../GameModuleManager";
import { ExampleDemo } from "./Example";


// ─── 常量 ────────────────────────────────────────────────────────────────────

export const GAME_LAUNCH_MODULE_NAME = "GameLaunchModule" as const;

// ─── GameLaunchModule ─────────────────────────────────────────────────────────

export class GameLaunchModule implements IGameLogicModule {

    readonly moduleName = GAME_LAUNCH_MODULE_NAME;

    private _manager!: IGameModuleManager;
    private _framework!: GameFramework;
    private _gas!: GASLayer;



    // ── IGameLogicModule 生命周期 ──────────────────────────────────────────────

    onInit(manager: IGameModuleManager): void {
        this._manager = manager;
        this._framework = manager.framework;
        this._gas = this._framework.getModule<GASLayer>(GAS_MODULE_NAME);

        this._runBootstrap();
    }

    onShutdown(): void {
        this._framework = undefined!;
        this._gas = undefined!;
    }

    // ── 内部实现 ─────────────────────────────────────────────────────────────

    private _onBeforeShutdown(): void {
        // 框架即将关闭，可在此做启动模块的收尾（如关闭启动期 UI）
    }

    /**
     * 启动阶段一次性逻辑：在 Framework / GAS 就绪后执行。
     * 子类可重写以扩展启动流程，可在此使用 event / res / log / scene / ui 等触发首屏。
     */
    protected _runBootstrap(): void {
        // 预留：打开主菜单、加载首场景、注册游戏全局事件等
        // 例：this._framework.event.emit("game:launchComplete");
        // 例：this.resSystem.loadAsync(...); this.sceneSystem.loadScene(...);

        var exampleDemo = new ExampleDemo(this._framework, this._gas)
        exampleDemo.Init()
    }

    // ── 只读访问器（供扩展或测试）────────────────────────────────────────────

    /** 游戏模块管理器，用于按需获取其它游戏模块 */
    protected get manager(): IGameModuleManager {
        return this._manager;
    }

    /** Framework 引用（Event、各子系统均通过 framework 获取） */
    protected get framework(): GameFramework {
        return this._framework;
    }

    /** GAS 服务层引用 */
    protected get gas(): GASLayer {
        return this._gas;
    }

}

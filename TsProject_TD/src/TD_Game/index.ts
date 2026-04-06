/**
 * TD_Game — 游戏逻辑层（Layer 3）
 *
 * 职责：
 *   负责塔防游戏的核心玩法逻辑（波次、建造、寻路、经济等）。
 *   依赖 Framework 层的基础服务与 GameplayAbilitySystem 服务层。
 *
 * 生命周期由 GameFramework 统一驱动：
 *   onInit(framework) → onUpdate(deltaTime) × N → onShutdown()
 */

import { GameFramework, type IModule } from "../Framework";
import { GASLayer, GAS_MODULE_NAME } from "../GameplayAbilitySystem";
import { GameModule, type IGameModuleManager } from "./GameModuleManager";

export const TD_GAME_MODULE_NAME = "TD_Game" as const;

// ─── TDGameLayer ─────────────────────────────────────────────────────────────

export class TDGameLayer implements IModule {

    readonly moduleName = TD_GAME_MODULE_NAME;

    private _framework!: GameFramework;
    private _gas!: GASLayer;

    /** 游戏逻辑模块管理器，各子模块通过它获取其它模块与 Framework */
    private _gameModule : GameModule ;

    // ── 生命周期 ──────────────────────────────────────────────────────────────

    onInit(framework: GameFramework): void {
        console.log(`[TD_Game] Initializing game layer...`);
        this._framework = framework;
        this._gas = framework.getModule<GASLayer>(GAS_MODULE_NAME);

        this._gameModule = new GameModule()

        //TODO:后续模块在这里注册
        // 先注册启动模块，再注册其它游戏逻辑模块，模块间通过 gameModule.getModule() 通信
        this._gameModule
            .registerGameModule();
        // .registerModule(new WaveSystem())
        // .registerModule(new BuildSystem());
        this._gameModule.init(framework);
    }

    onUpdate(deltaTime: number): void {
        this._gameModule.update(deltaTime);
    }

    onShutdown(): void {
        this._gameModule.shutdown();
    }

    // ── 公开访问器 ────────────────────────────────────────────────────────────

    /** Framework 基础服务引用，供 TD_Game 子模块使用 */
    get framework(): GameFramework {
        return this._framework;
    }

    /** GAS 服务层引用，供 TD_Game 子模块使用 */
    get gas(): GASLayer {
        return this._gas;
    }

    /** 游戏逻辑模块管理器，用于获取已注册的游戏模块（如 WaveSystem、BuildSystem） */
    get gameModule(): IGameModuleManager {
        return this._gameModule;
    }
}

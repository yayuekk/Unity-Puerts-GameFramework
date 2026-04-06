/**
 * GameplayAbilitySystem — 服务层（Layer 2）
 *
 * 职责：
 *   向游戏逻辑层（TD_Game）提供技能、属性、效果等运行时服务。
 *   依赖 Framework 层的基础服务（Log、Timer、Event 等）。
 *
 * 生命周期由 GameFramework 统一驱动：
 *   onInit(framework) → onUpdate(deltaTime) × N → onShutdown()
 */

import { type GameFramework, type IModule } from "../Framework";

export const GAS_MODULE_NAME = "GameplayAbilitySystem" as const;

// ─── GASLayer ────────────────────────────────────────────────────────────────

export class GASLayer implements IModule {

    readonly moduleName = GAS_MODULE_NAME;

    private _framework!: GameFramework;

    // ── 生命周期 ──────────────────────────────────────────────────────────────

    onInit(framework: GameFramework): void {
        this._framework = framework;

        // TODO: 在此初始化 GAS 子系统
        //   例：this._abilitySystem  = new AbilitySystem(framework);
        //       this._attributeSystem = new AttributeSystem(framework);
        //       this._effectSystem    = new EffectSystem(framework);
    }

    onUpdate(deltaTime: number): void {
        // TODO: 驱动 GAS 子系统的逐帧逻辑
        //   例：this._effectSystem.tick(deltaTime);
    }

    onShutdown(): void {
        // TODO: 释放 GAS 持有的资源
    }

    // ── 公开访问器 ────────────────────────────────────────────────────────────

    /** Framework 基础服务引用，供 GAS 子模块使用 */
    get framework(): GameFramework {
        return this._framework;
    }
}

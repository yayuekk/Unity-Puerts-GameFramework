/**
 * SceneTransition — 场景过渡策略实现
 *
 * 采用策略模式（Strategy Pattern）将过渡动画与场景加载逻辑解耦。
 * 框架提供两个内置实现，业务层可自行继承 SceneTransitionBase 实现任意效果。
 *
 * 内置实现：
 *   - NullSceneTransition    无过渡，立即切换（默认，适合开发调试）
 *   - DelaySceneTransition   延迟过渡，适合简单的时序控制（单元测试 / 简单切换）
 *
 * 业务层扩展示例（淡入淡出）：
 *   ```typescript
 *   class FadeTransition extends SceneTransitionBase {
 *       async onBeforeLoad() { await UISystem.openUI("LoadingScreen"); }
 *       async onAfterLoad()  { await UISystem.closeUI("LoadingScreen"); }
 *   }
 *   ```
 */

import type { ISceneTransition } from "./SceneTypes";

// ─── SceneTransitionBase ──────────────────────────────────────────────────────

/**
 * 场景过渡策略抽象基类。
 *
 * 提供空实现作为默认行为，子类只需重写需要的钩子。
 * 两个方法均返回 Promise，支持任意异步操作（动画、UI 等）。
 */
export abstract class SceneTransitionBase implements ISceneTransition {
    async onBeforeLoad(): Promise<void> {}
    async onAfterLoad():  Promise<void> {}
}

// ─── NullSceneTransition ──────────────────────────────────────────────────────

/**
 * 空过渡（默认策略）。
 *
 * onBeforeLoad / onAfterLoad 均立即 resolve，场景瞬间切换。
 * 适用于：
 *   - 开发阶段快速调试
 *   - 不需要过渡动画的内部场景切换
 */
export class NullSceneTransition extends SceneTransitionBase {
    private static _instance: NullSceneTransition | null = null;

    /** 全局共享的空过渡实例，无需每次 new */
    static get shared(): NullSceneTransition {
        if (!NullSceneTransition._instance) {
            NullSceneTransition._instance = new NullSceneTransition();
        }
        return NullSceneTransition._instance;
    }
}

// ─── DelaySceneTransition ─────────────────────────────────────────────────────

/**
 * 延迟过渡策略（用于测试 / 简单淡出淡入效果的时序模拟）。
 *
 * 在 onBeforeLoad / onAfterLoad 各等待指定毫秒数后 resolve。
 *
 * @example
 * ```typescript
 * sceneSystem.loadScene("Level_01", {
 *     transition: new DelaySceneTransition(300, 500),
 * });
 * ```
 */
export class DelaySceneTransition extends SceneTransitionBase {
    private readonly _beforeMs: number;
    private readonly _afterMs:  number;

    /**
     * @param beforeMs 加载前等待毫秒数（默认 0）
     * @param afterMs  加载后等待毫秒数（默认 0）
     */
    constructor(beforeMs: number = 0, afterMs: number = 0) {
        super();
        this._beforeMs = beforeMs;
        this._afterMs  = afterMs;
    }

    async onBeforeLoad(): Promise<void> {
        if (this._beforeMs > 0) {
            await this._delay(this._beforeMs);
        }
    }

    async onAfterLoad(): Promise<void> {
        if (this._afterMs > 0) {
            await this._delay(this._afterMs);
        }
    }

    private _delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

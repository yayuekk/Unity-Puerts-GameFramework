/**
 * ModelBase — MVC 数据层基类
 *
 * 职责：
 *   - 持有界面相关的运行时数据状态
 *   - 提供数据变更通知（推荐结合 EventSystem 的模块总线）
 *
 * 依赖方向（单向）：
 *   Service → Model → （通过事件通知）→ View
 *   Model 不直接持有 View 或 Service 引用。
 *
 * 生命周期：
 *   _setup(ctx) → _onInit() [onInit]   初始化数据
 *   _onDestroy()            [onDestroy] 释放数据资源
 */

import type { IModelBase, IUIContext } from "./UITypes";

export abstract class ModelBase implements IModelBase {

    /** 当前 UI 的运行时上下文，可通过 this._ctx.name / this._ctx.config 访问元数据 */
    protected _ctx!: IUIContext;

    // ── 内部生命周期（由 UISystem 调用） ──────────────────────────────────────

    _setup(ctx: IUIContext): void {
        this._ctx = ctx;
    }

    _onInit(): void {
        this.onInit();
    }

    _onDestroy(): void {
        this.onDestroy();
    }

    // ── 抽象生命周期（子类实现） ──────────────────────────────────────────────

    /**
     * 在此初始化数据字段（如设置默认值、从 SaveSystem 读取存档数据等）。
     * 在 View.onCreate 之前调用，因此 View 在 onCreate 中可以读取已初始化的数据。
     */
    protected abstract onInit(): void;

    /**
     * 在此释放数据相关资源（如取消异步请求、清理大型数据集等）。
     * 在 View.onDestroy 和 Service.onDestroy 之后调用。
     */
    protected abstract onDestroy(): void;
}

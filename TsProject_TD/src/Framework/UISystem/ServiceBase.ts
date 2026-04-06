/**
 * ServiceBase — MVC 业务逻辑层基类
 *
 * 职责：
 *   - 处理界面相关的业务逻辑（网络请求、游戏状态查询、数据转换等）
 *   - 作为 View 与 Model 的中间协调者：
 *       View 触发事件 → Service 处理 → Service 更新 Model → Model 通知 View 刷新
 *   - 管理 Service 内部的事件订阅与资源
 *
 * 依赖方向：
 *   Service 可持有 View 和 Model 的接口引用；
 *   View 和 Model 不直接引用 Service（通过事件通信）。
 *
 * 生命周期（在 View.onCreate 之后、View.onOpen 之前调用）：
 *   _setup(ctx, view, model) → _onInit() [onInit]   订阅事件、拉取初始数据
 *   _onDestroy()             [onDestroy] 取消订阅、清理资源
 */

import type { IServiceBase, IUIContext, IViewBase, IModelBase, UIOpenMode } from "./UITypes";

export abstract class ServiceBase implements IServiceBase {

    /** 当前 UI 运行时上下文 */
    protected _ctx   !: IUIContext;
    /** View 接口引用（通过接口而非具体类型访问，保持低耦合） */
    protected _view  !: IViewBase;
    /** Model 接口引用（可能为 null，若该 UI 未配置 Model） */
    protected _model : IModelBase | null = null;

    // ── 内部生命周期（由 UISystem 调用） ──────────────────────────────────────

    _setup(ctx: IUIContext, view: IViewBase, model: IModelBase | null): void {
        this._ctx   = ctx;
        this._view  = view;
        this._model = model;
    }

    _onInit(): void {
        this.onInit();
    }

    async _onPreload(mode: UIOpenMode): Promise<boolean> {
        return this.onPreload(mode);
    }

    _onDestroy(): void {
        this.onDestroy();
    }

    // ── 抽象生命周期（子类实现） ──────────────────────────────────────────────

    /**
     * 在此订阅事件、注册监听器、发起初始数据请求（同步部分）。
     * 此时 View 和 Model 均已完成 onInit，可安全访问 this._view 和 this._model。
     * 耗时的异步预加载（网络请求等）请放在 onPreload() 中。
     */
    protected abstract onInit(): void;

    /**
     * 可选预加载回调。重写此方法以实现打开前的数据预取（如网络请求）。
     *
     * 调用时机：onInit() 之后，View.onOpen() 之前。
     * Fresh 和 FromCache 两种打开模式均会触发。
     *
     * 行为规则：
     *   - 返回 true  → 预加载成功，继续打开界面（默认行为）
     *   - 返回 false → 业务层主动中止，界面不打开，UISystem 触发 onFailed(PreloadAborted)
     *   - throw      → 视为异常失败，UISystem 触发 onFailed(PreloadFailed, error)
     *
     * @param mode 打开模式，用于区分首次打开与从缓存恢复
     */
    protected async onPreload(_mode: UIOpenMode): Promise<boolean> {
        return true;
    }

    /**
     * 在此取消订阅事件、中止进行中的异步请求、释放临时资源。
     * 在 View.onDestroy 之前调用。
     */
    protected abstract onDestroy(): void;
}

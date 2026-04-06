/**
 * UISystem — UI 系统核心模块
 *
 * 职责：
 *   - 通过 UIClassRegistry 按类名查找 @UIClass 装饰器自动注册的 MVC 类
 *   - 驱动 UI 完整生命周期：openUI / closeUI / destroyUI
 *   - 协调 UIStage 进行层级 Panel Distance 管理
 *   - 通过 C# UIRoot 读取预制体上的 UIConfig 运行时配置
 *   - 管理缓存 UI 的超时检测与自动销毁
 *   - 依赖 ResSystem 进行 Addressable 资源的加载与释放
 *
 * ─── MVC 完整生命周期 ─────────────────────────────────────────────────────────
 *
 *  【首次打开】
 *    instantiateAsync → 读取 UIConfig → 挂到层级节点
 *    → Model.onInit → View.onCreate → Service.onInit
 *    → Service.onPreload(Fresh)   ← 可重写为网络请求，失败则不打开
 *    → GO.SetActive(true) → View.onOpen(Fresh)
 *
 *  【关闭 - 缓存（isCached=true）】
 *    View.onClose → GO.SetActive(false) → 记录 hideTimestamp
 *
 *  【再次打开（从缓存恢复）】
 *    Service.onPreload(FromCache) ← 可重写刷新数据
 *    → GO.SetActive(true) → View.onOpen(FromCache)
 *
 *  【关闭 - 非缓存 / 强制销毁 / 缓存超时】
 *    View.onClose(可见时) → Service.onDestroy → View.onDestroy → Model.onDestroy
 *    → goHandle.release()
 *
 * ─── 使用示例 ─────────────────────────────────────────────────────────────────
 *
 *   // 在类定义上添加 @UIClass 装饰器，模块加载时自动注册，无需任何手动调用
 *   @UIClass export class MainMenuView    extends ViewBase    { ... }
 *   @UIClass export class MainMenuModel   extends ModelBase   { ... }
 *   @UIClass export class MainMenuService extends ServiceBase { ... }
 *
 *   // 直接 openUI——MVC 类完全由预制体 UIConfig 中的 className 字段驱动
 *   await uiSystem.openUI("UI_Shop", (name, reason, err) => {
 *       console.error(`${name} open failed: ${reason}`, err);
 *   });
 *
 *   // 关闭（缓存 → 隐藏；非缓存 → 销毁）
 *   uiSystem.closeUI("UI_MainMenu");
 *
 *   // 强制销毁（无论缓存配置）
 *   uiSystem.destroyUI("UI_MainMenu");
 */

import type { GameFramework, IModule } from "../GameFramework";
import type { IResSystem, IResHandle } from "../ResModule/ResTypes";
import type { ILogChannelHandle } from "../LogModule/LogTypes";
import {
    UILayer,
    UIOpenMode,
    UIOpenFailReason,
    type UIOpenFailedCallback,
    type IUIRuntimeConfig,
    type IUIContext,
    type IViewBase,
    type IModelBase,
    type IServiceBase,
} from "./UITypes";
import { getUIClassCtor } from "./UIClassRegistry";
import { UIStage } from "./UIStage";

declare const CS: any;

export class UISystem implements IModule {

    readonly moduleName = "UISystem";

    // ── 依赖 ──────────────────────────────────────────────────────────────────

    private _resSys!: IResSystem;
    private _log?  : ILogChannelHandle;

    // ── 运行时上下文：资源名 → UIContext ──────────────────────────────────────

    /** 所有在内存中的 UI（含可见与缓存隐藏两种状态） */
    private readonly _contexts = new Map<string, IUIContext>();

    /**
     * 正在加载或预加载中的 UI 名称集合。
     * 防止并发重复 openUI 调用，所有进入 openUI 的异步路径必须通过 try/finally 清理此集合。
     */
    private readonly _loadingSet = new Set<string>();

    /**
     * 在加载期间收到 closeUI 请求的 UI 名称集合。
     * 加载完成后若 UI 已可见，将自动补调 closeUI（遵循缓存策略）。
     * closeUI 优先级低于 destroyUI，后者会将同名条目从此集合移除。
     */
    private readonly _pendingCloseSet = new Set<string>();

    /**
     * 在加载期间收到 destroyUI 请求的 UI 名称集合。
     * 加载完成后若 UI 在内存中，将自动补调强制销毁。
     * destroyUI 优先级高于 closeUI，会将同名条目从 _pendingCloseSet 移除。
     */
    private readonly _pendingDestroySet = new Set<string>();

    // ── 每层级的 Panel Distance 管理器 ────────────────────────────────────────

    /** 使用 Map 而非数组，避免 UILayer 枚举值变更时产生静默越界 */
    private readonly _stages = new Map<UILayer, UIStage>([
        [UILayer.Bottom, new UIStage(UILayer.Bottom)],
        [UILayer.Normal, new UIStage(UILayer.Normal)],
        [UILayer.Queue,  new UIStage(UILayer.Queue)],
        [UILayer.Pop,    new UIStage(UILayer.Pop)],
        [UILayer.Top,    new UIStage(UILayer.Top)],
    ]);

    // ── 缓存超时检测 ──────────────────────────────────────────────────────────

    private _cacheCheckAccum = 0;
    /** 每隔 5 秒执行一次缓存超时扫描（ms） */
    private static readonly CACHE_CHECK_INTERVAL_MS = 5_000;

    // ── IModule 生命周期 ──────────────────────────────────────────────────────

    onInit(fw: GameFramework): void {
        this._resSys = fw.getModule<any>("ResSystem") as IResSystem;
        const logSys = fw.tryGetModule<any>("LogSystem");
        this._log    = logSys?.registerChannel("ui", "UISystem");
        this._log?.info("UISystem initialized.");
    }

    onUpdate(deltaTime: number): void {
        this._cacheCheckAccum += deltaTime * 1000;
        if (this._cacheCheckAccum >= UISystem.CACHE_CHECK_INTERVAL_MS) {
            this._cacheCheckAccum = 0;
            this._checkCacheTimeout();
        }
    }

    onShutdown(): void {
        // 逆序静默销毁所有 UI，跳过 onClose（应用关闭，无需动画/音效）
        const names = Array.from(this._contexts.keys()).reverse();
        for (const name of names) {
            this._doDestroy(name, true);
        }
        // _doDestroy 已逐一 delete，此处 clear 是防御性兜底
        this._contexts.clear();
        this._loadingSet.clear();
        this._pendingCloseSet.clear();
        this._pendingDestroySet.clear();
        this._log?.info("UISystem shutdown.");
    }

    // ── 公共 UI 操作 API ──────────────────────────────────────────────────────

    /**
     * 打开一个 UI 界面。
     *
     * 行为策略：
     *   - 正在加载中 → 忽略并警告（防竞态）
     *   - 已缓存隐藏 → 运行 Service.onPreload(FromCache)，成功则恢复显示
     *   - 已可见     → 提到当前层级栈顶（bringToFront）
     *   - 未加载     → 实例化 → 初始化 MVC → Service.onPreload(Fresh) → 显示
     *
     * onPreload 失败处理：
     *   - 返回 false → 触发 onFailed(PreloadAborted)，Fresh 时销毁 MVC，FromCache 时保留缓存
     *   - 抛出异常  → 触发 onFailed(PreloadFailed, error)，同上清理策略
     *
     * @param name     Addressable 资源名
     * @param onFailed 可选失败回调，预加载失败时触发
     */
    async openUI(name: string, onFailed?: UIOpenFailedCallback): Promise<void> {
        // ── 防并发 ────────────────────────────────────────────────────────────
        if (this._loadingSet.has(name)) {
            this._log?.warn(`openUI: "${name}" is still opening, duplicate call ignored.`);
            return;
        }

        // ── 已在内存中 ────────────────────────────────────────────────────────
        const existing = this._contexts.get(name);
        if (existing) {
            if (!existing.isVisible) {
                // 从缓存恢复：需要先预加载（刷新数据），再显示
                this._loadingSet.add(name);
                try {
                    const ok = await this._runPreload(existing, UIOpenMode.FromCache, onFailed);
                    if (ok) {
                        this._showContext(existing);
                        try { await existing.view?._onOpen(UIOpenMode.FromCache); }
                        catch (e) { this._log?.error(`view.onOpen(FromCache) error for "${name}": ${e}`); }
                        this._log?.info(`openUI: "${name}" restored from cache.`);
                    }
                } finally {
                    this._loadingSet.delete(name);
                }
                // 从缓存恢复期间若收到 close/destroy 请求，在此补执行
                this._applyPendingActions(name);
            } else {
                // 已可见：提到层级栈顶
                this._stages.get(existing.config.layer)!.bringToFront(existing);
                this._log?.info(`openUI: "${name}" already visible, brought to front.`);
            }
            return;
        }

        // ── 首次加载 ──────────────────────────────────────────────────────────
        this._loadingSet.add(name);
        try {
            await this._doLoadAndOpen(name, onFailed);
        } finally {
            // 无论成功、失败、抛出，_loadingSet 均在此清理，保证下次可以重新打开
            this._loadingSet.delete(name);
        }
        // 首次加载期间若收到 close/destroy 请求，在此补执行
        this._applyPendingActions(name);
    }

    /**
     * 关闭一个 UI 界面。
     *
     * 行为策略：
     *   - 缓存模式（isCached=true）→ 调用 View.onClose，隐藏 GO，记录 hideTimestamp
     *   - 非缓存（isCached=false）→ 调用 View.onClose 后立即销毁并释放资源
     *
     * @param name  UI 资源名
     */
    closeUI(name: string): void {
        // UI 正在加载中：延迟到加载完成后执行（close 优先级低于 destroy）
        if (this._loadingSet.has(name)) {
            this._pendingDestroySet.delete(name);
            this._pendingCloseSet.add(name);
            this._log?.info(`closeUI: "${name}" is loading; close queued.`);
            return;
        }
        const ctx = this._contexts.get(name);
        if (!ctx) {
            this._log?.warn(`closeUI: "${name}" not found.`);
            return;
        }
        if (!ctx.isVisible) {
            this._log?.warn(`closeUI: "${name}" is already hidden (cached).`);
            return;
        }

        if (ctx.config.isCached) {
            ctx.view?._onClose();
            this._hideContext(ctx);
            ctx.hideTimestamp = Date.now();
            this._log?.info(
                `closeUI: "${name}" hidden (cached, timeout=${ctx.config.cacheTimeoutSeconds}s).`
            );
        } else {
            // onClose 在 _doDestroy 内部调用（skipOnClose=false）
            this._doDestroy(name, false);
            this._log?.info(`closeUI: "${name}" destroyed.`);
        }
    }

    /**
     * 强制销毁一个 UI，无论其缓存设置。
     * - 若当前可见：先调用 View.onClose，再销毁
     * - 若处于缓存隐藏：直接销毁（onClose 已在 closeUI 时调用过）
     *
     * @param name  UI 资源名
     */
    destroyUI(name: string): void {
        // UI 正在加载中：延迟到加载完成后执行（destroy 优先级高于 close）
        if (this._loadingSet.has(name)) {
            this._pendingCloseSet.delete(name);
            this._pendingDestroySet.add(name);
            this._log?.info(`destroyUI: "${name}" is loading; destroy queued.`);
            return;
        }
        if (!this._contexts.has(name)) {
            this._log?.warn(`destroyUI: "${name}" not found.`);
            return;
        }
        this._doDestroy(name, false);
        this._log?.info(`destroyUI: "${name}" force-destroyed.`);
    }

    /**
     * 关闭当前所有可见 UI（遵循各自的缓存策略）。
     */
    closeAll(): void {
        // 快照 keys，避免 closeUI 修改 Map 时迭代器失效
        const names = Array.from(this._contexts.keys());
        for (const name of names) {
            if (this._contexts.get(name)?.isVisible) {
                this.closeUI(name);
            }
        }
    }

    // ── 查询 API ──────────────────────────────────────────────────────────────

    /** 指定 UI 当前是否可见（GO 激活且在层级栈中） */
    isVisible(name: string): boolean {
        return this._contexts.get(name)?.isVisible ?? false;
    }

    /** 指定 UI 是否在内存中（可见或缓存隐藏均算） */
    isLoaded(name: string): boolean {
        return this._contexts.has(name);
    }

    /** 指定 UI 当前是否正在加载/预加载中 */
    isLoading(name: string): boolean {
        return this._loadingSet.has(name);
    }

    /** 获取指定 UI 的 View 实例（用于跨模块访问，建议谨慎使用） */
    getView<T extends object>(name: string): T | null {
        return (this._contexts.get(name)?.view as T | undefined) ?? null;
    }

    /** 获取指定 UI 的 Model 实例 */
    getModel<T extends object>(name: string): T | null {
        return (this._contexts.get(name)?.model as T | undefined) ?? null;
    }

    // ── 私有 —— 首次加载流程 ──────────────────────────────────────────────────

    /**
     * 首次加载并打开一个 UI 的完整流程。
     * 由 openUI 在 try/finally 中调用，_loadingSet 由外层负责清理。
     */
    private async _doLoadAndOpen(
        name    : string,
        onFailed?: UIOpenFailedCallback,
    ): Promise<void> {
        // 实例化 Addressable 预制体
        let goHandle: IResHandle<any>;
        try {
            goHandle = await this._resSys.instantiateAsync(name);
        } catch (e) {
            this._log?.error(`openUI: instantiateAsync("${name}") failed: ${e}`);
            return;
        }

        // 立即隐藏，避免 GO 在挂到层级节点之前出现视觉闪烁
        goHandle.asset.SetActive(false);

        // 读取预制体根节点上的 C# UIConfig 组件
        const csConfig = CS.GameFramework.UI.UIRoot.GetUIConfig(goHandle.asset);
        if (!csConfig) {
            this._log?.error(
                `openUI: UIConfig component missing on "${name}". ` +
                `Attach UIConfig to the prefab root.`
            );
            goHandle.release();
            return;
        }

        const config: IUIRuntimeConfig = {
            layer              : csConfig.layer               as UILayer,
            isCached           : csConfig.isCached            as boolean,
            cacheTimeoutSeconds: csConfig.cacheTimeoutSeconds as number,
            viewClassName      : csConfig.viewClassName       as string,
            modelClassName     : csConfig.modelClassName      as string,
            serviceClassName   : csConfig.serviceClassName    as string,
        };

        // 将 GO 挂到对应层级的根节点下（SetParent false = 不保留世界坐标）
        const uiRoot    = CS.GameFramework.UI.UIRoot.Instance;
        const layerRoot = uiRoot.GetLayerRoot(config.layer);
        goHandle.asset.transform.SetParent(layerRoot, false);

        // ── 从全局 UIClassRegistry 按类名解析 MVC 构造函数 ───────────────────
        // 类在定义处通过 @UIClass 装饰器自动注册，此处只做查找。

        const viewCtor = config.viewClassName
            ? getUIClassCtor(config.viewClassName) as (new () => IViewBase) | undefined
            : undefined;

        if (!viewCtor) {
            this._log?.error(
                `openUI: "${name}" - viewClassName "${config.viewClassName}" not found in registry. ` +
                `Add @UIClass decorator to the class definition and ensure the module is imported.`
            );
            goHandle.release();
            return;
        }

        const modelCtor = config.modelClassName
            ? getUIClassCtor(config.modelClassName) as (new () => IModelBase) | undefined
            : undefined;

        const serviceCtor = config.serviceClassName
            ? getUIClassCtor(config.serviceClassName) as (new () => IServiceBase) | undefined
            : undefined;

        // ── 构建 MVC ──────────────────────────────────────────────────────────

        const view    = new viewCtor()                           as IViewBase;
        const model   = modelCtor   ? new modelCtor()   as IModelBase   : null;
        const service = serviceCtor ? new serviceCtor() as IServiceBase : null;

        const ctx: IUIContext = {
            name,
            config,
            goHandle,
            view,
            model,
            service,
            hideTimestamp : 0,
            isVisible     : false,
        };

        // 注入上下文（必须在 onInit 前完成）
        view._setup(ctx);
        model?._setup(ctx);
        service?._setup(ctx, view, model);

        // ── 按顺序初始化 MVC ──────────────────────────────────────────────────
        // Model 最先，确保 View.onCreate 可读到已就绪的数据
        try { model?._onInit(); }
        catch (e) { this._log?.error(`model.onInit error for "${name}": ${e}`); }

        try { await view._onInit(); }
        catch (e) { this._log?.error(`view.onCreate error for "${name}": ${e}`); }

        try { service?._onInit(); }
        catch (e) { this._log?.error(`service.onInit error for "${name}": ${e}`); }

        // ── 预加载（网络请求等）─────────────────────────────────────────────

        const preloadOk = await this._runPreload(ctx, UIOpenMode.Fresh, onFailed);
        if (!preloadOk) {
            // 预加载失败：销毁已初始化的 MVC，释放 GO，不添加到 _contexts
            this._destroyMVCOrphaned(ctx);
            return;
        }

        // ── 成功 —— 注册到全局表并显示 ───────────────────────────────────────

        this._contexts.set(name, ctx);
        this._showContext(ctx);

        try { await view._onOpen(UIOpenMode.Fresh); }
        catch (e) { this._log?.error(`view.onOpen(Fresh) error for "${name}": ${e}`); }

        this._log?.info(`openUI: "${name}" opened on layer ${config.layer}.`);
    }

    // ── 私有 —— 预加载 ────────────────────────────────────────────────────────

    /**
     * 调用 Service.onPreload()，捕获所有异常并统一触发 onFailed 回调。
     *
     * @returns true = 可以打开；false = 已处理失败（onFailed 已调用）
     */
    private async _runPreload(
        ctx     : IUIContext,
        mode    : UIOpenMode,
        onFailed?: UIOpenFailedCallback,
    ): Promise<boolean> {
        if (!ctx.service) return true;

        try {
            const ok = await ctx.service._onPreload(mode);
            if (!ok) {
                this._log?.warn(
                    `openUI: preload aborted for "${ctx.name}" (onPreload returned false).`
                );
                onFailed?.(ctx.name, UIOpenFailReason.PreloadAborted);
            }
            return ok;
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            this._log?.error(`openUI: preload failed for "${ctx.name}": ${err}`);
            onFailed?.(ctx.name, UIOpenFailReason.PreloadFailed, err);
            return false;
        }
    }

    // ── 私有 —— 显示/隐藏 ────────────────────────────────────────────────────

    private _showContext(ctx: IUIContext): void {
        const go = ctx.goHandle.asset;
        if (go != null) go.SetActive(true);
        ctx.isVisible     = true;
        ctx.hideTimestamp = 0;
        const pushed = this._stages.get(ctx.config.layer)!.push(ctx);
        if (!pushed) {
            this._log?.error(
                `_showContext: Layer ${ctx.config.layer} max panel count exceeded ` +
                `for "${ctx.name}". UI is visible but sortingOrder is unmanaged.`
            );
        }
        this._updateLayerBlocker(ctx.config.layer);
    }

    private _hideContext(ctx: IUIContext): void {
        const go = ctx.goHandle.asset;
        if (go != null) go.SetActive(false);
        ctx.isVisible = false;
        this._stages.get(ctx.config.layer)!.remove(ctx);
        this._updateLayerBlocker(ctx.config.layer);
    }

    // ── 私有 —— 销毁 ──────────────────────────────────────────────────────────

    /**
     * 销毁一个已注册在 _contexts 中的 UI 上下文。
     *
     * @param name         UI 资源名
     * @param skipOnClose  true = 跳过 onClose（shutdown 时使用）
     */
    private _doDestroy(name: string, skipOnClose: boolean): void {
        const ctx = this._contexts.get(name);
        if (!ctx) return;

        if (ctx.isVisible) {
            if (!skipOnClose) {
                try { ctx.view?._onClose(); }
                catch (e) { this._log?.error(`view.onClose error for "${name}": ${e}`); }
            }
            this._stages.get(ctx.config.layer)!.remove(ctx);
            this._updateLayerBlocker(ctx.config.layer);
        }

        this._teardownMVC(ctx, name);
        this._contexts.delete(name);
    }

    /**
     * 销毁一个尚未注册到 _contexts 中的孤立 MVC（预加载失败时使用）。
     * 跳过 onClose（UI 从未显示过）。
     */
    private _destroyMVCOrphaned(ctx: IUIContext): void {
        this._teardownMVC(ctx, ctx.name);
    }

    /** 执行 MVC 的 onDestroy 调用链，然后释放 goHandle。 */
    private _teardownMVC(ctx: IUIContext, logName: string): void {
        try { ctx.service?._onDestroy(); }
        catch (e) { this._log?.error(`service.onDestroy error for "${logName}": ${e}`); }

        try { ctx.view?._onDestroy(); }
        catch (e) { this._log?.error(`view.onDestroy error for "${logName}": ${e}`); }

        try { ctx.model?._onDestroy(); }
        catch (e) { this._log?.error(`model.onDestroy error for "${logName}": ${e}`); }

        ctx.goHandle.release();
    }

    // ── 私有 —— 层间遮罩 ──────────────────────────────────────────────────────

    /**
     * 根据当前层的活跃 UI 数量决定是否激活层间 Blocker。
     * 层有 UI 显示时激活；清空时关闭。
     */
    private _updateLayerBlocker(layer: UILayer): void {
        const uiRoot = CS.GameFramework.UI.UIRoot.Instance as any;
        if (!uiRoot) return;
        uiRoot.SetLayerBlocker(layer, this._stages.get(layer)!.activeCount > 0);
    }

    // ── 私有 —— 延迟操作 ──────────────────────────────────────────────────────

    /**
     * 在加载完成后（_loadingSet 已清理）补执行期间收到的 close/destroy 请求。
     *
     * 优先级：destroy > close。
     * 若加载失败（UI 不在 _contexts 中），pending 条目直接清除即可。
     */
    private _applyPendingActions(name: string): void {
        if (this._pendingDestroySet.delete(name)) {
            if (this._contexts.has(name)) {
                this._doDestroy(name, false);
                this._log?.info(`destroyUI (deferred): "${name}" destroyed after load.`);
            }
        } else if (this._pendingCloseSet.delete(name)) {
            const ctx = this._contexts.get(name);
            if (ctx?.isVisible) {
                this.closeUI(name);
            }
            // UI 不可见（加载失败或预加载中止）说明已被清理，无需再 close
        }
    }

    // ── 私有 —— 缓存超时检测 ──────────────────────────────────────────────────

    /**
     * 遍历所有缓存隐藏的 UI，超过 cacheTimeoutSeconds 的将被自动销毁。
     * onClose 已在 closeUI 时调用，此处静默销毁（skipOnClose=true）。
     */
    private _checkCacheTimeout(): void {
        const now     = Date.now();
        const expired : string[] = [];

        for (const [name, ctx] of this._contexts) {
            // 跳过可见、从未隐藏、以及永不超时（timeout=0）的条目
            if (ctx.isVisible || ctx.hideTimestamp === 0) continue;
            if (ctx.config.cacheTimeoutSeconds <= 0) continue;

            const elapsedSec = (now - ctx.hideTimestamp) / 1000;
            if (elapsedSec >= ctx.config.cacheTimeoutSeconds) {
                expired.push(name);
            }
        }

        for (const name of expired) {
            this._log?.info(
                `Cache timeout: "${name}" ` +
                `(${this._contexts.get(name)?.config.cacheTimeoutSeconds}s elapsed), destroying.`
            );
            this._doDestroy(name, true);
        }
    }
}

/**
 * ResHandle — 资源句柄（Handle Pattern）
 *
 * 职责：持有单次加载或实例化操作的结果，并在 release() 时通过
 * IResController 接口将卸载逻辑委托给系统执行。
 *
 * 依赖倒置：ResHandle 仅依赖 IResController 接口而非 ResSystem 具体类，
 * 消除循环依赖风险，且便于单元测试时注入 Mock 实现。
 */

import type { IResHandle, ResLoadType } from "./ResTypes";

// ─── 内部句柄类型 ─────────────────────────────────────────────────────────────

/**
 * 区分普通共享资产句柄与 Addressable 实例句柄，
 * 以便系统在 release() 时选择正确的卸载策略。
 */
export type ResHandleKind = "asset" | "instance";

// ─── 系统控制接口（仅供 ResHandle 使用）──────────────────────────────────────

/**
 * ResSystem 需实现此接口供 ResHandle 回调。
 * 仅暴露句柄所需的最小操作集，遵循接口隔离原则。
 */
export interface IResController {
    /**
     * 普通共享资产引用归还。
     * 系统内部执行引用计数递减，归零时自动选择正确的 API 卸载资产。
     */
    onAssetHandleRelease(key: string, loadType: ResLoadType): void;

    /**
     * Addressable 实例释放。
     * 系统内部调用 Addressables.ReleaseInstance(go)，销毁 GameObject 并回收引用。
     */
    onInstanceHandleRelease(go: any): void;
}

// ─── 句柄实现 ─────────────────────────────────────────────────────────────────

export class ResHandle<T> implements IResHandle<T> {

    private _released = false;
    private _asset: T | null;

    constructor(
        private readonly _controller: IResController,
        private readonly _kind: ResHandleKind,
        public readonly key: string,
        public readonly loadType: ResLoadType,
        asset: T,
    ) {
        this._asset = asset;
    }

    get asset(): T | null    { return this._asset; }
    get isLoaded(): boolean  { return this._asset !== null && !this._released; }
    get isReleased(): boolean { return this._released; }

    release(): void {
        if (this._released) return;
        this._released = true;

        const asset = this._asset;
        this._asset = null;

        if (this._kind === "instance") {
            this._controller.onInstanceHandleRelease(asset);
        } else {
            this._controller.onAssetHandleRelease(this.key, this.loadType);
        }
    }
}

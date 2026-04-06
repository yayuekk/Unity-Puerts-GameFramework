/**
 * UIStage — 单层 UI 层级管理器
 *
 * 职责：
 *   - 追踪当前层级内所有可见 UI（按显示顺序排列的栈）
 *   - 每当栈发生变化时，重新为所有 UI 分配 Canvas sortingOrder（Panel Distance）
 *
 * Panel Distance 策略：
 *   - 每个 UI 的 sortingOrder = (stackIndex + 1) × STEP
 *   - STEP = 10，最多 MAX_PANELS 个并发面板，则最大值 = MAX_PANELS × STEP = 500
 *   - 值域 [10, 500]，远低于 Unity sortingOrder 上限 32767，完全安全
 *   - 每次栈变化都整体重排，避免历史碎片导致数值漂移或溢出
 *
 * 注意：UIStage 不持有 GameObject 引用，实际的 SetUIPanelDistance 通过 C# UIRoot 静态方法执行。
 */

import type { IUIContext } from "./UITypes";

declare const CS: any;

/** 相邻面板之间的 sortingOrder 间距 */
const PANEL_DISTANCE_STEP = 10;

/**
 * 单层最大并发面板数。
 * 超出后新面板无法入栈，控制台输出警告。
 * 最大 sortingOrder = MAX_PANELS_PER_LAYER × PANEL_DISTANCE_STEP = 500。
 */
const MAX_PANELS_PER_LAYER = 50;

export class UIStage {

    private readonly _layer      : number;
    private readonly _activeStack: IUIContext[] = [];

    constructor(layer: number) {
        this._layer = layer;
    }

    // ── 只读属性 ──────────────────────────────────────────────────────────────

    get layer()       : number               { return this._layer;                                     }
    get activeCount() : number               { return this._activeStack.length;                        }
    get isEmpty()     : boolean              { return this._activeStack.length === 0;                  }
    get topUI()       : IUIContext | undefined { return this._activeStack[this._activeStack.length - 1]; }

    // ── 栈操作 ────────────────────────────────────────────────────────────────

    /**
     * 将一个 UI 推入栈顶（最前方）并重新分配所有 Panel Distance。
     * 若 UI 已在栈中，则将其移到栈顶（bringToFront 语义）。
     * @returns true = 入栈成功；false = 已达最大并发数，未入栈
     */
    push(ctx: IUIContext): boolean {
        const existing = this._activeStack.indexOf(ctx);
        if (existing >= 0) {
            // 已在栈中，直接提到栈顶
            if (existing !== this._activeStack.length - 1) {
                this._activeStack.splice(existing, 1);
                this._activeStack.push(ctx);
                this._reassignDistances();
            }
            return true;
        }

        if (this._activeStack.length >= MAX_PANELS_PER_LAYER) {
            console.warn(
                `[UIStage] Layer ${this._layer} reached max panel count (${MAX_PANELS_PER_LAYER}). ` +
                `Cannot push "${ctx.name}".`
            );
            return false;
        }

        this._activeStack.push(ctx);
        this._reassignDistances();
        return true;
    }

    /**
     * 从栈中移除一个 UI 并重新分配剩余面板的 Panel Distance。
     * 若 UI 不在栈中则静默忽略。
     */
    remove(ctx: IUIContext): void {
        const idx = this._activeStack.indexOf(ctx);
        if (idx < 0) return;
        this._activeStack.splice(idx, 1);
        this._reassignDistances();
    }

    /**
     * 将已入栈的 UI 移到栈顶（视觉最前方）并重排距离。
     * 若 UI 不在栈中则静默忽略。
     */
    bringToFront(ctx: IUIContext): void {
        const idx = this._activeStack.indexOf(ctx);
        if (idx < 0 || idx === this._activeStack.length - 1) return;
        this._activeStack.splice(idx, 1);
        this._activeStack.push(ctx);
        this._reassignDistances();
    }

    // ── 私有辅助 ──────────────────────────────────────────────────────────────

    /**
     * 重新为栈中所有 UI 分配 Canvas sortingOrder（Panel Distance）。
     *
     * 分配规则：
     *   - 栈底（index 0）→ sortingOrder = 1 × STEP = 10（最底层）
     *   - 栈顶（index n-1）→ sortingOrder = n × STEP（最前方）
     *   - 整体重排保证数值紧凑，永远不会漂移或溢出
     */
    private _reassignDistances(): void {
        const uiRoot = CS.GameFramework.UI.UIRoot.Instance as any;
        if (!uiRoot) {
            console.error("[UIStage] UIRoot.Instance is null. Cannot assign panel distances.");
            return;
        }

        for (let i = 0; i < this._activeStack.length; i++) {
            const go = this._activeStack[i].goHandle.asset;
            if (go == null) continue;
            CS.GameFramework.UI.UIRoot.SetUIPanelDistance(go, (i + 1) * PANEL_DISTANCE_STEP);
        }
    }
}

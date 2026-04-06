/**
 * UIDataReader — UIConfig / ComponentConfig 数据读取器
 *
 * 封装对 C# UIDataBlock 的访问，提供类型安全的 key → value 查询接口。
 * 通过 UINodeBase.cfg 属性懒加载获取，业务代码无需直接 new 此类。
 *
 * ─── 使用示例 ──────────────────────────────────────────────────────────────────
 *
 *   // 在 ViewBase / UIComponent 的 onCreate 中：
 *
 *   // 值类型
 *   const speed  = this.cfg.float("moveSpeed", 1.0);
 *   const title  = this.cfg.str("title");
 *   const offset = this.cfg.v2("offset");
 *
 *   // Object 类型（返回 C# Component）
 *   const btnClose = this.cfg.obj("btnClose");   // 返回选中的 Button 组件
 *   const panel    = this.cfg.obj("panel");       // 返回选中的 RectTransform 等
 *
 *   // 若目标是 GameObject 本身
 *   const iconGo = this.cfg.go("icon");
 *
 * ─── C# 侧配置 ────────────────────────────────────────────────────────────────
 *
 *   UIConfig / ComponentConfig 上的 UIDataBlock.data：
 *     - 值类型：在 ints / floats / strings / vector2s / vector3s / colors / curves 列表中添加条目
 *     - Object：在 objects 列表中填写 key，拖入 GameObject，Inspector 下拉选择组件类型
 */

export class UIDataReader {

    /** 对应 C# UIConfig 或 ComponentConfig 实例；null 时所有查询返回默认值。 */
    private readonly _cs: any;

    constructor(csConfig: any) {
        this._cs = csConfig ?? null;
    }

    /** C# 配置是否有效（预制体上存在对应配置组件时为 true）。 */
    get isValid(): boolean { return this._cs != null; }

    // ── 值类型查询 ────────────────────────────────────────────────────────────

    /** 读取 int 配置，找不到返回 defaultValue（默认 0）。 */
    int(key: string, defaultValue = 0): number {
        return this._cs != null ? (this._cs.GetInt(key, defaultValue) as number) : defaultValue;
    }

    /** 读取 float 配置，找不到返回 defaultValue（默认 0）。 */
    float(key: string, defaultValue = 0): number {
        return this._cs != null ? (this._cs.GetFloat(key, defaultValue) as number) : defaultValue;
    }

    /** 读取 string 配置，找不到返回 defaultValue（默认 ""）。 */
    str(key: string, defaultValue = ""): string {
        return this._cs != null ? (this._cs.GetString(key, defaultValue) as string) : defaultValue;
    }

    /** 读取 Vector2 配置，找不到返回 C# Vector2.zero。 */
    v2(key: string): any {
        return this._cs != null ? this._cs.GetVector2(key) : null;
    }

    /** 读取 Vector3 配置，找不到返回 C# Vector3.zero。 */
    v3(key: string): any {
        return this._cs != null ? this._cs.GetVector3(key) : null;
    }

    /** 读取 Color 配置，找不到返回 C# Color.white。 */
    color(key: string): any {
        return this._cs != null ? this._cs.GetColor(key) : null;
    }

    /** 读取 AnimationCurve 配置，找不到返回 null。 */
    curve(key: string): any {
        return this._cs != null ? this._cs.GetAnimCurve(key) : null;
    }

    // ── Object 类型查询 ───────────────────────────────────────────────────────

    /**
     * 读取 Object 绑定，返回在 Inspector 下拉中选中的 C# Component 实例。
     *
     * 返回值类型由 Inspector 中的组件选择决定，可直接转型为目标组件类型：
     * @example
     *   const btn = this.cfg.obj("btnClose") as CS.UnityEngine.UI.Button;
     *   const img = this.cfg.obj("icon")     as CS.UnityEngine.UI.Image;
     *   const rt  = this.cfg.obj("panel")    as CS.UnityEngine.RectTransform;
     */
    obj(key: string): any {
        return this._cs != null ? this._cs.GetObject(key) : null;
    }

    /**
     * 读取 Object 绑定，返回目标 C# GameObject（忽略选中的组件类型）。
     * 适用于需要整个 GameObject 引用的场景。
     */
    go(key: string): any {
        return this._cs != null ? this._cs.GetGameObject(key) : null;
    }
}

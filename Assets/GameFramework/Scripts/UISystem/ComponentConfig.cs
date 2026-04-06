using UnityEngine;

namespace GameFramework.UI
{
    /// <summary>
    /// ComponentConfig — 挂载在 UI 组件预制体根节点上的配置组件。
    ///
    /// 与 UIConfig 对应：UIConfig 用于 View 预制体根节点，
    /// ComponentConfig 用于 UIComponent 预制体根节点。
    ///
    /// 职责：
    ///   - 绑定对应的 TypeScript UIComponent 子类名称，供框架通过注册表反射构造
    ///   - 通过内嵌 UIDataBlock 配置各类型数据，供 TS 层通过 key 查询
    ///
    /// 使用规范：
    ///   1. 每个 UIComponent 预制体根节点挂载一个 ComponentConfig
    ///   2. componentClassName 须与 UISystem.registerComponent() 注册的键名完全一致
    ///   3. Object 类型数据需在 Inspector 中通过下拉框选择目标组件（UIObjectEntryDrawer）
    ///
    /// 创建流程：
    ///   UINodeBase.createComponent(resKey, parent) →
    ///     实例化预制体 → 读取 ComponentConfig.componentClassName →
    ///     从 UISystem 组件注册表查找类 → new 实例 → _setup → _onCreate
    /// </summary>
    [AddComponentMenu("GameFramework/UI/ComponentConfig")]
    [DisallowMultipleComponent]
    public class ComponentConfig : MonoBehaviour
    {
        [Header("TypeScript 脚本绑定")]
        [Tooltip("TypeScript UIComponent 子类名称，需与 UISystem.registerComponent() 注册的 key 一致")]
        public string componentClassName = "";

        [Header("数据配置")]
        [Tooltip("供 TS 层通过 key 查询的数据。值类型直接填写；Object 类型拖入 GameObject 后选择组件。")]
        public UIDataBlock data = new UIDataBlock();

        // ── 数据查询快捷方法（代理到 data 块，TS 层可直接调用） ───────────────────

        public int            GetInt       (string key, int    def = 0)    => data.GetInt(key, def);
        public float          GetFloat     (string key, float  def = 0f)   => data.GetFloat(key, def);
        public string         GetString    (string key, string def = "")   => data.GetString(key, def);
        public Vector2        GetVector2   (string key)                    => data.GetVector2(key);
        public Vector3        GetVector3   (string key)                    => data.GetVector3(key);
        public Color          GetColor     (string key)                    => data.GetColor(key);
        public AnimationCurve GetAnimCurve (string key)                    => data.GetAnimCurve(key);
        public Component      GetObject    (string key)                    => data.GetObject(key);
        public GameObject     GetGameObject(string key)                    => data.GetGameObject(key);
    }
}

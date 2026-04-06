using UnityEngine;

namespace GameFramework.UI
{
    /// <summary>
    /// UIConfig — 挂载在 UI 预制体根节点上的配置组件。
    ///
    /// 职责：
    ///   - 声明该预制体所属的 UI 层级（UILayer）
    ///   - 配置是否启用缓存及缓存超时时长
    ///   - 绑定对应的 TypeScript View / Model / Service 类名，供 TS 层反射构造
    ///   - 通过内嵌 UIDataBlock 配置各类型数据，供 TS 层通过 key 查询
    ///
    /// 使用规范：
    ///   1. 每个 UI 预制体根节点必须且只能挂载一个 UIConfig
    ///   2. viewClassName 必填；modelClassName / serviceClassName 按需填写
    ///   3. 类名须与 TypeScript 中通过 UISystem.register() 注册的键名完全一致
    ///   4. Object 类型数据需在 Inspector 中通过下拉框选择目标组件（UIObjectEntryDrawer）
    /// </summary>
    [AddComponentMenu("GameFramework/UI/UIConfig")]
    [DisallowMultipleComponent]
    public class UIConfig : MonoBehaviour
    {
        [Header("层级配置")]
        [Tooltip("该界面所在的 UI 层级")]
        public UILayer layer = UILayer.Normal;

        [Header("缓存配置")]
        [Tooltip("是否缓存该界面。启用后，关闭时隐藏而不销毁；超时后自动销毁。")]
        public bool isCached = false;

        [Tooltip("缓存超时秒数（isCached=true 时有效）。界面隐藏后超过此时长将被自动销毁。0 = 永不超时。")]
        [Min(0f)]
        public float cacheTimeoutSeconds = 300f;

        [Header("TypeScript 脚本绑定")]
        [Tooltip("TypeScript View 类名（必填），需与 UISystem.register() 的 resName 对应的 View 类一致")]
        public string viewClassName = "";

        [Tooltip("TypeScript Model 类名（选填，留空则 UISystem 不创建 Model 实例）")]
        public string modelClassName = "";

        [Tooltip("TypeScript Service 类名（选填，留空则 UISystem 不创建 Service 实例）")]
        public string serviceClassName = "";

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

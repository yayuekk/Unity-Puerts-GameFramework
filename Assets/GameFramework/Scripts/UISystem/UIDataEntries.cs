using UnityEngine;

namespace GameFramework.UI
{
    // ─── 值类型条目 ────────────────────────────────────────────────────────────────

    [System.Serializable]
    public sealed class UIIntEntry
    {
        public string key;
        public int    value;
    }

    [System.Serializable]
    public sealed class UIFloatEntry
    {
        public string key;
        public float  value;
    }

    [System.Serializable]
    public sealed class UIStringEntry
    {
        public string key;
        public string value;
    }

    [System.Serializable]
    public sealed class UIVector2Entry
    {
        public string  key;
        public Vector2 value;
    }

    [System.Serializable]
    public sealed class UIVector3Entry
    {
        public string  key;
        public Vector3 value;
    }

    [System.Serializable]
    public sealed class UIColorEntry
    {
        public string key;
        public Color  value;
    }

    [System.Serializable]
    public sealed class UIAnimCurveEntry
    {
        public string         key;
        public AnimationCurve value;
    }

    // ─── Object 条目 ───────────────────────────────────────────────────────────────

    /// <summary>
    /// UI Object 绑定条目。
    ///
    /// 使用方式：
    ///   1. 填写 key（TS 侧用于查询的字符串标识符）。
    ///   2. 将目标 GameObject 拖入 target 字段。
    ///   3. 通过 Inspector 下拉框（UIObjectEntryDrawer）选择要导出的组件类型。
    ///      选中后 componentTypeName 由编辑器自动写入，无需手动填写。
    ///
    /// 运行时通过 GetBoundComponent() 获取实际组件实例。
    /// </summary>
    [System.Serializable]
    public sealed class UIObjectEntry
    {
        public string     key;

        [Tooltip("目标 GameObject（包含所需组件）")]
        public GameObject target;

        /// <summary>
        /// 由 UIObjectEntryDrawer 写入的组件 AssemblyQualifiedName。
        /// 不要手动修改此字段。
        /// </summary>
        [HideInInspector]
        public string componentTypeName;

        /// <summary>
        /// 用于 Inspector 展示的组件简称（如 "Image"、"Button"），由编辑器维护，不参与运行时逻辑。
        /// </summary>
        [HideInInspector]
        public string componentDisplayName;

        /// <summary>
        /// 获取绑定的 Component 实例。
        /// 若 target 或 componentTypeName 为空则返回 null。
        /// </summary>
        public Component GetBoundComponent()
        {
            if (target == null || string.IsNullOrEmpty(componentTypeName))
                return null;

            var type = System.Type.GetType(componentTypeName);
            return type != null ? target.GetComponent(type) : null;
        }

        /// <summary>直接获取目标 GameObject（不需要组件时使用）。</summary>
        public GameObject GetGameObject() => target;
    }

    // ─── 数据块（UIConfig / ComponentConfig 共用） ────────────────────────────────

    /// <summary>
    /// UIDataBlock — 可复用的数据配置块，UIConfig 与 ComponentConfig 均内嵌此结构。
    ///
    /// 在 Inspector 中分为两大区域：
    ///   - 值类型（int / float / string / Vector2 / Vector3 / Color / AnimationCurve）
    ///     直接拖拽或填值赋值。
    ///   - Object 类型（GameObject / Component 等）
    ///     填写 key，拖入 GameObject，通过下拉框选择目标组件后由编辑器自动记录类型。
    ///
    /// TS 侧通过 UIDataReader（或 UINodeBase.cfg.xxx）按 key 查询各类型数据。
    /// </summary>
    [System.Serializable]
    public class UIDataBlock
    {
        [Header("值类型数据")]
        public UIIntEntry[]      ints;
        public UIFloatEntry[]    floats;
        public UIStringEntry[]   strings;
        public UIVector2Entry[]  vector2s;
        public UIVector3Entry[]  vector3s;
        public UIColorEntry[]    colors;
        public UIAnimCurveEntry[] curves;

        [Header("Object 数据（组件 / GameObject）")]
        public UIObjectEntry[]   objects;

        // ── 运行时查询 ────────────────────────────────────────────────────────────

        public int GetInt(string key, int defaultValue = 0)
        {
            if (ints != null)
                foreach (var e in ints)
                    if (e.key == key) return e.value;
            return defaultValue;
        }

        public float GetFloat(string key, float defaultValue = 0f)
        {
            if (floats != null)
                foreach (var e in floats)
                    if (e.key == key) return e.value;
            return defaultValue;
        }

        public string GetString(string key, string defaultValue = "")
        {
            if (strings != null)
                foreach (var e in strings)
                    if (e.key == key) return e.value ?? defaultValue;
            return defaultValue;
        }

        public Vector2 GetVector2(string key)
        {
            if (vector2s != null)
                foreach (var e in vector2s)
                    if (e.key == key) return e.value;
            return Vector2.zero;
        }

        public Vector3 GetVector3(string key)
        {
            if (vector3s != null)
                foreach (var e in vector3s)
                    if (e.key == key) return e.value;
            return Vector3.zero;
        }

        public Color GetColor(string key)
        {
            if (colors != null)
                foreach (var e in colors)
                    if (e.key == key) return e.value;
            return Color.white;
        }

        public AnimationCurve GetAnimCurve(string key)
        {
            if (curves != null)
                foreach (var e in curves)
                    if (e.key == key) return e.value;
            return null;
        }

        public Component GetObject(string key)
        {
            if (objects != null)
                foreach (var e in objects)
                    if (e.key == key) return e.GetBoundComponent();
            return null;
        }

        public GameObject GetGameObject(string key)
        {
            if (objects != null)
                foreach (var e in objects)
                    if (e.key == key) return e.GetGameObject();
            return null;
        }
    }
}

using System.Linq;
using UnityEditor;
using UnityEngine;

namespace GameFramework.UI.Editor
{
    /// <summary>
    /// UIObjectEntry 自定义绘制器。
    ///
    /// 效果（选中组件前）：
    ///   ┌────────────────────────────────────────────────────────┐
    ///   │ Key        [ myKey                                 ]   │
    ///   │ Target     [ ○ SomeChildGO            (GameObject)] │
    ///   │ Component  [ ▾ Transform                           ]   │
    ///   └────────────────────────────────────────────────────────┘
    ///
    /// 效果（选中 Image 后，Target 切换为 Image 引用）：
    ///   ┌────────────────────────────────────────────────────────┐
    ///   │ Key        [ myKey                                 ]   │
    ///   │ Target     [ ○ SomeChildGO             (Image)    ] │
    ///   │ Component  [ ▾ Image                               ]   │
    ///   └────────────────────────────────────────────────────────┘
    ///
    /// 行为说明：
    ///   - Target 字段的对象类型随 Component 下拉框联动，选中哪个组件 Target 就显示该组件类型。
    ///   - 也可以直接将 Component 拖入 Target 字段，下拉框会自动跳到对应组件，Target 同步更新。
    ///   - 切换 Target 的 GameObject 时，Component 下拉重置为第一项（Transform）。
    /// </summary>
    [CustomPropertyDrawer(typeof(UIObjectEntry))]
    public class UIObjectEntryDrawer : PropertyDrawer
    {
        private const float k_LineHeight = 20f;
        private const float k_Spacing    = 2f;
        private const float k_TotalLines = 3;

        public override float GetPropertyHeight(SerializedProperty property, GUIContent label)
            => (k_LineHeight + k_Spacing) * k_TotalLines + k_Spacing;

        public override void OnGUI(Rect position, SerializedProperty property, GUIContent label)
        {
            EditorGUI.BeginProperty(position, label, property);

            var keyProp         = property.FindPropertyRelative("key");
            var targetProp      = property.FindPropertyRelative("target");
            var typeNameProp    = property.FindPropertyRelative("componentTypeName");
            var displayNameProp = property.FindPropertyRelative("componentDisplayName");

            float y = position.y + k_Spacing;
            float w = position.width;
            float x = position.x;

            // ── 提前读取当前状态，供 Target 行动态绘制 ─────────────────────────────
            var    targetGo          = targetProp.objectReferenceValue as GameObject;
            string currentTypeName   = typeNameProp.stringValue;
            var    currentType       = string.IsNullOrEmpty(currentTypeName)
                                           ? null
                                           : System.Type.GetType(currentTypeName);
            bool   hasValidComponent = currentType != null
                                       && typeof(Component).IsAssignableFrom(currentType);

            // ── Row 1: Key ────────────────────────────────────────────────────────
            EditorGUI.PropertyField(new Rect(x, y, w, k_LineHeight), keyProp, new GUIContent("Key"));
            y += k_LineHeight + k_Spacing;

            // ── Row 2: Target（类型随选中组件动态切换）────────────────────────────
            var targetRect = new Rect(x, y, w, k_LineHeight);

            if (hasValidComponent && targetGo != null)
            {
                // 用当前选中的组件类型绘制 ObjectField
                Component currentComp = targetGo.GetComponent(currentType);

                EditorGUI.BeginChangeCheck();
                var assigned = EditorGUI.ObjectField(
                    targetRect,
                    new GUIContent("Target"),
                    currentComp,
                    currentType,
                    true
                );
                if (EditorGUI.EndChangeCheck())
                {
                    if (assigned is Component assignedComp)
                    {
                        // 拖入了一个组件：更新 target 为其 GO，更新 componentTypeName
                        targetProp.objectReferenceValue = assignedComp.gameObject;
                        typeNameProp.stringValue        = assignedComp.GetType().AssemblyQualifiedName;
                        displayNameProp.stringValue     = assignedComp.GetType().Name;
                    }
                    else
                    {
                        targetProp.objectReferenceValue = null;
                        typeNameProp.stringValue        = "";
                        displayNameProp.stringValue     = "";
                    }
                }
            }
            else
            {
                // 未选组件或 target 为 null：显示为 GameObject 字段
                EditorGUI.BeginChangeCheck();
                var assignedGo = EditorGUI.ObjectField(
                    targetRect,
                    new GUIContent("Target"),
                    targetProp.objectReferenceValue,
                    typeof(GameObject),
                    true
                ) as GameObject;
                bool goChanged = EditorGUI.EndChangeCheck();

                if (goChanged)
                {
                    targetProp.objectReferenceValue = assignedGo;
                    // 如果拖入的是某个组件（Unity 拖入 Component 时 objectReferenceValue 仍为该组件的 GO）
                    // 此处检查是否直接拖入了 Component（会变成 Object 类型）
                }
            }

            y += k_LineHeight + k_Spacing;

            // ── Row 3: Component 下拉 ──────────────────────────────────────────────
            // 每帧重新读取 target（可能已被 Row 2 更新）
            targetGo = targetProp.objectReferenceValue as GameObject;
            var compRect = new Rect(x, y, w, k_LineHeight);

            if (targetGo == null)
            {
                EditorGUI.BeginDisabledGroup(true);
                EditorGUI.Popup(
                    compRect,
                    new GUIContent("Component"),
                    0,
                    new[] { new GUIContent("— 请先拖入 GameObject —") }
                );
                EditorGUI.EndDisabledGroup();

                typeNameProp.stringValue    = "";
                displayNameProp.stringValue = "";
            }
            else
            {
                Component[] comps        = targetGo.GetComponents<Component>();
                string[]    displayNames = comps.Select(c => c != null ? c.GetType().Name : "(null)").ToArray();
                string[]    typeNames    = comps.Select(c => c != null ? c.GetType().AssemblyQualifiedName : "").ToArray();

                // 找到当前已选中的 index（使用最新的 typeNameProp，可能被 Row 2 修改过）
                string latestTypeName = typeNameProp.stringValue;
                int selectedIdx = 0;
                for (int i = 0; i < typeNames.Length; i++)
                {
                    if (typeNames[i] == latestTypeName)
                    {
                        selectedIdx = i;
                        break;
                    }
                }

                GUIContent[] options = displayNames.Select(n => new GUIContent(n)).ToArray();
                int newIdx = EditorGUI.Popup(compRect, new GUIContent("Component"), selectedIdx, options);

                if (newIdx != selectedIdx || string.IsNullOrEmpty(latestTypeName))
                {
                    typeNameProp.stringValue    = typeNames.Length > 0 ? typeNames[newIdx]    : "";
                    displayNameProp.stringValue = displayNames.Length > 0 ? displayNames[newIdx] : "";
                }
            }

            EditorGUI.EndProperty();
        }
    }
}

using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

/// <summary>
/// 工具箱主窗口：UE5 风格，左侧工具按钮，右侧为当前工具面板容器。
/// 扩展新工具：在 s_Tools 中增加一项，界面逻辑写在各自脚本的 Draw 方法中。
/// 右侧主操作可用 ToolBoxStyles.DrawPrimaryButton / DrawSecondaryButton 保持统一风格。
/// </summary>
public class ToolBox : EditorWindow
{
    private static readonly List<ToolEntry> s_Tools = new List<ToolEntry>();
    private int _selectedIndex;
    private Vector2 _sidebarScroll;
    private Vector2 _panelScroll;

    private const float SidebarWidth = 220f;
    private const float SidebarPadding = 10f;
    private const float ButtonHeight = 36f;
    private const float ButtonSpacing = 6f;
    private const float PanelPadding = 20f;
    private const float PanelHeaderHeight = 40f;
    private const float DividerWidth = 1f;

    // UE5 风格配色
    private static readonly Color SidebarBg = new Color(0.10f, 0.10f, 0.11f, 1f);           // 更深侧栏
    private static readonly Color WindowBg = new Color(0.145f, 0.145f, 0.155f, 1f);
    private static readonly Color SelectedBg = new Color(0.0f, 0.38f, 0.68f, 0.5f);
    private static readonly Color SelectedBorder = new Color(0.0f, 0.5f, 0.88f, 1f);
    private static readonly Color HoverBg = new Color(0.22f, 0.22f, 0.24f, 1f);
    private static readonly Color ButtonBg = new Color(0.18f, 0.18f, 0.19f, 1f);
    private static readonly Color TextPrimary = new Color(0.95f, 0.95f, 0.95f, 1f);
    private static readonly Color TextSecondary = new Color(0.62f, 0.62f, 0.64f, 1f);
    private static readonly Color PanelHeaderBg = new Color(0.12f, 0.12f, 0.13f, 1f);
    private static readonly Color ContentCardBg = new Color(0.14f, 0.14f, 0.15f, 1f);
    private static readonly Color DividerColor = new Color(0.22f, 0.22f, 0.24f, 1f);
    private static readonly Color AccentCyan = new Color(0.0f, 0.72f, 0.88f, 1f);          // 点缀色
    private static readonly Color PrimaryButtonBg = new Color(0.0f, 0.45f, 0.75f, 1f);
    private static readonly Color PrimaryButtonHover = new Color(0.0f, 0.55f, 0.88f, 1f);
    private static readonly Color SecondaryButtonBg = new Color(0.22f, 0.22f, 0.24f, 1f);
    private static readonly Color SecondaryButtonHover = new Color(0.28f, 0.28f, 0.30f, 1f);

    private struct ToolEntry
    {
        public GUIContent Content;  // 支持 icon + 文本，若 null 则仅用 Name
        public string Name;
        public Action DrawPanel;
    }

    [MenuItem("Tools/ToolBox 工具箱")]
    public static void ShowWindow()
    {
        var win = GetWindow<ToolBox>("ToolBox");
        win.minSize = new Vector2(520, 320);
    }

    private void OnEnable()
    {
        RegisterTools();
    }

    /// <summary>
    /// 在此注册所有工具：左边按钮（可带图标）+ 对应右侧绘制委托。
    /// 图标传 null 可避免内置图标名随 Unity 版本不存在导致的 "Unable to load the icon" 警告。
    /// </summary>
    private static void RegisterTools()
    {
        s_Tools.Clear();
        s_Tools.Add(new ToolEntry
        {
            Content = new GUIContent("  JS → JS.txt", null, "Javascript 工具"),
            Name = "JS → JS.txt",
            DrawPanel = Tool_JsToTxt.DrawToolPanel
        });
        s_Tools.Add(new ToolEntry
        {
            Content = new GUIContent("  资源检查", null, "重名与相似贴图检查"),
            Name = "资源检查",
            DrawPanel = Tool_AssetsCheck.DrawToolPanel
        });
        s_Tools.Add(new ToolEntry
        {
            Content = new GUIContent("  Addressable", null, "Addressable 资源管理"),
            Name = "Addressable",
            DrawPanel = Tool_Addressable.DrawToolPanel
        });
    }

    private void OnGUI()
    {
        DrawBackground();
        DrawLayout();
    }

    private void DrawBackground()
    {
        var r = new Rect(0, 0, position.width, position.height);
        EditorGUI.DrawRect(r, WindowBg);
    }

    private void DrawLayout()
    {
        // ========== 左侧边栏 ==========
        var sidebarRect = new Rect(0, 0, SidebarWidth, position.height);
        EditorGUI.DrawRect(sidebarRect, SidebarBg);

        var titleRect = new Rect(SidebarPadding, SidebarPadding + 4, SidebarWidth - SidebarPadding * 2, 28);
        var titleStyle = new GUIStyle(EditorStyles.boldLabel)
        {
            fontSize = 14,
            normal = { textColor = TextPrimary },
            alignment = TextAnchor.MiddleLeft
        };
        // 不传图标避免 "Unable to load the icon"（内置图标名随 Unity 版本可能不存在）
        var titleContent = new GUIContent("  工具", (Texture2D)null);
        GUI.Label(titleRect, titleContent, titleStyle);

        float buttonY = titleRect.y + titleRect.height + 12f;
        var scrollRect = new Rect(0, buttonY, SidebarWidth, position.height - buttonY - SidebarPadding);
        float listHeight = s_Tools.Count * (ButtonHeight + ButtonSpacing) + ButtonSpacing;
        _sidebarScroll = GUI.BeginScrollView(scrollRect, _sidebarScroll, new Rect(0, 0, SidebarWidth - 18, listHeight));

        for (int i = 0; i < s_Tools.Count; i++)
        {
            var entry = s_Tools[i];
            float y = ButtonSpacing + i * (ButtonHeight + ButtonSpacing);
            var btnRect = new Rect(SidebarPadding, y, SidebarWidth - SidebarPadding * 2 - 14, ButtonHeight);
            bool isSelected = _selectedIndex == i;
            bool isHover = btnRect.Contains(Event.current.mousePosition);

            if (isSelected)
            {
                EditorGUI.DrawRect(btnRect, SelectedBg);
                var borderRect = new Rect(btnRect.x, btnRect.y, 4, btnRect.height);
                EditorGUI.DrawRect(borderRect, SelectedBorder);
            }
            else if (isHover)
            {
                EditorGUI.DrawRect(btnRect, HoverBg);
            }
            else
            {
                EditorGUI.DrawRect(btnRect, ButtonBg);
            }

            var style = new GUIStyle(EditorStyles.label)
            {
                alignment = TextAnchor.MiddleLeft,
                padding = new RectOffset(14, 0, 8, 0),
                normal = { textColor = isSelected ? TextPrimary : TextSecondary },
                fontStyle = isSelected ? FontStyle.Bold : FontStyle.Normal
            };
            GUIContent label = entry.Content ?? new GUIContent(entry.Name);
            if (GUI.Button(btnRect, label, style))
            {
                _selectedIndex = i;
                Repaint();
            }
        }

        GUI.EndScrollView();

        // 侧栏与内容区分割线
        var dividerRect = new Rect(SidebarWidth - DividerWidth, 0, DividerWidth, position.height);
        EditorGUI.DrawRect(dividerRect, DividerColor);

        // ========== 右侧工具面板 ==========
        var panelRect = new Rect(SidebarWidth, 0, position.width - SidebarWidth, position.height);
        EditorGUI.DrawRect(panelRect, WindowBg);

        if (_selectedIndex >= 0 && _selectedIndex < s_Tools.Count)
        {
            var contentRect = new Rect(panelRect.x + PanelPadding, panelRect.y + PanelPadding,
                panelRect.width - PanelPadding * 2, panelRect.height - PanelPadding * 2);

            // 面板标题区（带底部分割线与点缀）
            var headerRect = new Rect(contentRect.x, contentRect.y, contentRect.width, PanelHeaderHeight);
            EditorGUI.DrawRect(headerRect, PanelHeaderBg);
            var accentLineRect = new Rect(contentRect.x, contentRect.y + PanelHeaderHeight - 2, contentRect.width, 2);
            EditorGUI.DrawRect(accentLineRect, SelectedBorder);
            var headerStyle = new GUIStyle(EditorStyles.boldLabel)
            {
                fontSize = 13,
                normal = { textColor = TextPrimary },
                alignment = TextAnchor.MiddleLeft,
                padding = new RectOffset(12, 0, 0, 0)
            };
            GUI.Label(headerRect, s_Tools[_selectedIndex].Name, headerStyle);

            // 内容卡片区域：随父窗口缩放，使用足够大的可滚动内容区避免裁切
            var bodyRect = new Rect(contentRect.x, contentRect.y + PanelHeaderHeight + 8, contentRect.width, contentRect.height - PanelHeaderHeight - 8);
            var cardRect = new Rect(bodyRect.x, bodyRect.y, bodyRect.width, bodyRect.height);
            EditorGUI.DrawRect(cardRect, ContentCardBg);

            // 可滚动内容高度取「可视高度+余量」与「最小 1200」的较大值，保证缩小窗口时仍可滚动查看全部
            float scrollContentHeight = Mathf.Max(bodyRect.height + 200f, 1200f);
            float scrollContentWidth = Mathf.Max(bodyRect.width - 22, 200f);
            _panelScroll = GUI.BeginScrollView(bodyRect, _panelScroll, new Rect(0, 0, scrollContentWidth, scrollContentHeight), GUIStyle.none, GUIStyle.none);

            float innerPad = 16f;
            EditorGUILayout.BeginVertical(new GUIStyle(GUI.skin.box) { padding = new RectOffset((int)innerPad, (int)innerPad, (int)innerPad, (int)innerPad) }, GUILayout.MinHeight(Mathf.Max(bodyRect.height - 24, 0)));
            try
            {
                s_Tools[_selectedIndex].DrawPanel?.Invoke();
            }
            catch (Exception ex)
            {
                EditorGUILayout.HelpBox("绘制工具界面时出错: " + ex.Message, MessageType.Error);
            }
            EditorGUILayout.EndVertical();

            GUI.EndScrollView();
        }
        else
        {
            var emptyStyle = new GUIStyle(EditorStyles.label)
            {
                alignment = TextAnchor.MiddleCenter,
                normal = { textColor = TextSecondary },
                fontSize = 13
            };
            GUI.Label(panelRect, "在左侧选择一项工具", emptyStyle);
        }
    }

    /// <summary>
    /// 供各工具在右侧面板使用的统一按钮样式，保持界面一致。
    /// </summary>
    public static class ToolBoxStyles
    {
        private static GUIStyle _primaryButton;
        private static GUIStyle _secondaryButton;
        private static GUIStyle _labelWrap;

        public static bool DrawPrimaryButton(string text, float height = 42f, float? width = null)
        {
            EnsureStyles();
            var opt = width.HasValue ? GUILayout.Width(width.Value) : GUILayout.ExpandWidth(true);
            var rect = GUILayoutUtility.GetRect(GUIContent.none, _primaryButton, GUILayout.Height(height), opt);
            bool hover = rect.Contains(Event.current.mousePosition);
            EditorGUI.DrawRect(rect, hover ? PrimaryButtonHover : PrimaryButtonBg);
            var border = new Rect(rect.x, rect.y + rect.height - 2, rect.width, 2);
            EditorGUI.DrawRect(border, AccentCyan);
            return GUI.Button(rect, text, _primaryButton);
        }

        public static bool DrawSecondaryButton(string text, float height = 36f, float? width = null)
        {
            EnsureStyles();
            var opt = width.HasValue ? GUILayout.Width(width.Value) : GUILayout.ExpandWidth(true);
            var rect = GUILayoutUtility.GetRect(GUIContent.none, _secondaryButton, GUILayout.Height(height), opt);
            bool hover = rect.Contains(Event.current.mousePosition);
            EditorGUI.DrawRect(rect, hover ? SecondaryButtonHover : SecondaryButtonBg);
            return GUI.Button(rect, text, _secondaryButton);
        }

        public static void DrawDescription(string text)
        {
            EnsureStyles();
            GUILayout.Label(text, _labelWrap);
        }

        private static void EnsureStyles()
        {
            if (_primaryButton != null) return;
            _primaryButton = new GUIStyle(GUI.skin.button)
            {
                fontSize = 13,
                fontStyle = FontStyle.Bold,
                alignment = TextAnchor.MiddleCenter,
                normal = { textColor = Color.white },
                hover = { textColor = Color.white },
                active = { textColor = new Color(1f, 1f, 1f, 0.9f) },
                padding = new RectOffset(20, 8, 10, 10),
                border = new RectOffset(0, 0, 0, 0),
                fixedHeight = 0
            };
            _secondaryButton = new GUIStyle(GUI.skin.button)
            {
                fontSize = 12,
                alignment = TextAnchor.MiddleCenter,
                normal = { textColor = TextPrimary },
                hover = { textColor = TextPrimary },
                padding = new RectOffset(16, 6, 8, 8),
                border = new RectOffset(0, 0, 0, 0),
                fixedHeight = 0
            };
            _labelWrap = new GUIStyle(EditorStyles.wordWrappedLabel)
            {
                normal = { textColor = TextSecondary },
                fontSize = 12
            };
        }
    }
}

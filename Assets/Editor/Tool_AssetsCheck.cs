using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEngine;

/// <summary>
/// 资源检查工具：检查指定路径下重复名称、相似贴图资源，UE5 风格面板。
/// </summary>
public class Tool_AssetsCheck : EditorWindow
{
    private const string PrefsKeyPath = "Tool_AssetsCheck_AssetsPath";
    private const string PrefsKeyNamingConfig = "Tool_AssetsCheck_NamingConfig";
    private const string PrefsKeyNamingScanRoot = "Tool_AssetsCheck_NamingScanRoot";
    private const string PrefsKeyFoldoutDuplicateSimilar = "Tool_AssetsCheck_Foldout_DupSim";
    private const string PrefsKeyFoldoutNaming = "Tool_AssetsCheck_Foldout_Naming";
    private const string DefaultRelativePath = "Assets/GameMain";
    private const string NamingScanRootDefault = "Assets";
    /// <summary>.cs 默认不参与命名检测</summary>
    private static readonly string[] DefaultIgnoreExtensions = { ".cs" };

    [Serializable]
    public class NamingRuleDef
    {
        public string extension = ".prefab";  // 如 .prefab, .png, * 表示所有
        public string prefix = "";
        public string suffix = "";
        public bool useRegex;
        public string pattern = "";

        public string DisplaySummary()
        {
            if (useRegex && !string.IsNullOrEmpty(pattern))
                return $"{extension} 匹配正则: {pattern}";
            var parts = new List<string>();
            if (!string.IsNullOrEmpty(prefix)) parts.Add("前缀:" + prefix);
            if (!string.IsNullOrEmpty(suffix)) parts.Add("后缀:" + suffix);
            return $"{extension} " + (parts.Count > 0 ? string.Join(" ", parts) : "(未设)");
        }
    }

    /// <summary>路径规则：该路径下所有资源（不限类型）均按此规则校验</summary>
    [Serializable]
    public class PathRuleDef
    {
        public string pathPrefix = "Assets/";  // 路径前缀，如 Assets/GameMain/UI
        public string prefix = "";
        public string suffix = "";
        public bool useRegex;
        public string pattern = "";
    }

    [Serializable]
    public class NamingConfigData
    {
        public List<NamingRuleDef> rules = new List<NamingRuleDef>();
        public List<PathRuleDef> pathRules = new List<PathRuleDef>();
        public List<string> ignorePathPrefixes = new List<string>();
        public List<string> ignoreExtensions = new List<string>();
    }

    /// <summary>导出/加载用，包含检测根路径与完整命名配置</summary>
    [Serializable]
    public class NamingConfigExport
    {
        public string scanRoot = "Assets";
        public NamingConfigData config;
    }

    /// <summary>命名违规项：路径 + 不符合原因说明</summary>
    public struct NamingViolationEntry
    {
        public string path;
        public string reason;
    }

    private static string s_cachedPath;
    private static Vector2 s_duplicateScroll;
    private static Vector2 s_similarScroll;

    // 重复名称检查结果：按「名称」分组，每组为同一名称的资产路径列表
    private static List<List<string>> s_duplicateGroups = new List<List<string>>();
    // 相似贴图检查结果：每组为相似的一组资产路径
    private static List<List<string>> s_similarGroups = new List<List<string>>();

    // 命名规范：配置与检测结果
    private static NamingConfigData s_namingConfig;
    private static string s_namingScanRoot = NamingScanRootDefault;
    private static List<NamingViolationEntry> s_namingViolations = new List<NamingViolationEntry>();
    private static List<string> s_namingCompliant = new List<string>();
    private static Vector2 s_namingScroll;
    private static Vector2 s_namingCompliantScroll;
    private static bool s_namingConfigFoldout = true;
    private static bool s_namingIgnoreFoldout = true;
    private static bool s_duplicateSimilarFoldout = true;
    private static bool s_namingSectionFoldout = true;
    private static bool s_foldoutStateLoaded;

    // 重命名状态（重名/命名规范共用）
    private static string s_renameTargetPath;
    private static string s_renameNewName = "";
    private static bool s_renameFromNamingSection;

    // UE5 风格配色（丰富一些）
    private static readonly Color HeaderDuplicate = new Color(0.95f, 0.55f, 0.15f, 1f);   // 琥珀色
    private static readonly Color HeaderSimilar = new Color(0.2f, 0.65f, 0.9f, 1f);      // 蓝色
    private static readonly Color HeaderNaming = new Color(0.5f, 0.85f, 0.4f, 1f);       // 绿色
    private static readonly Color RowBgA = new Color(0.16f, 0.16f, 0.18f, 1f);
    private static readonly Color RowBgB = new Color(0.14f, 0.14f, 0.16f, 1f);
    private static readonly Color TextPrimary = new Color(0.95f, 0.95f, 0.95f, 1f);
    private static readonly Color TextSecondary = new Color(0.62f, 0.62f, 0.64f, 1f);
    private static readonly Color AccentCyan = new Color(0.0f, 0.72f, 0.88f, 1f);
    private static readonly Color BtnDelete = new Color(0.75f, 0.28f, 0.28f, 1f);
    private static readonly Color BtnDeleteHover = new Color(0.9f, 0.4f, 0.4f, 1f);
    private static readonly Color BtnRename = new Color(0.25f, 0.5f, 0.7f, 1f);
    private static readonly Color BtnRenameHover = new Color(0.35f, 0.65f, 0.88f, 1f);
    private static readonly Color BtnLocate = new Color(0.3f, 0.6f, 0.5f, 1f);
    private static readonly Color CardBg = new Color(0.12f, 0.12f, 0.14f, 1f);
    private const float BtnActionWidth = 56f;
    private const float BtnActionHeight = 24f;
    private static readonly Color BorderAccent = new Color(0.35f, 0.35f, 0.4f, 1f);
    private static readonly Color ReasonColor = new Color(0.95f, 0.7f, 0.25f, 1f);
    private static Texture2D s_cardBgTex;
    private static Texture2D s_rowBgTexA;
    private static Texture2D s_rowBgTexB;

    private static GUIStyle RowStyle(bool useA)
    {
        if (s_rowBgTexA == null) { s_rowBgTexA = MakeTex(1, 1, RowBgA); s_rowBgTexB = MakeTex(1, 1, RowBgB); }
        var s = new GUIStyle { normal = { background = useA ? s_rowBgTexA : s_rowBgTexB }, padding = new RectOffset(8, 4, 4, 4) };
        return s;
    }

    private static Texture2D MakeTex(int w, int h, Color c)
    {
        var t = new Texture2D(w, h);
        t.SetPixel(0, 0, c);
        t.Apply();
        return t;
    }

    private static GUIStyle CardStyle
    {
        get
        {
            if (s_cardBgTex == null)
                s_cardBgTex = MakeTex(1, 1, CardBg);
            var s = new GUIStyle(GUI.skin.box);
            s.padding = new RectOffset(10, 10, 10, 10);
            s.normal.background = s_cardBgTex;
            s.border = new RectOffset(1, 1, 1, 1);
            return s;
        }
    }

    public static void DrawToolPanel()
    {
        if (string.IsNullOrEmpty(s_cachedPath))
            s_cachedPath = EditorPrefs.GetString(PrefsKeyPath, DefaultRelativePath);

        DrawDescription();
        GUILayout.Space(16);

        if (!s_foldoutStateLoaded)
        {
            s_foldoutStateLoaded = true;
            s_duplicateSimilarFoldout = EditorPrefs.GetBool(PrefsKeyFoldoutDuplicateSimilar, true);
            s_namingSectionFoldout = EditorPrefs.GetBool(PrefsKeyFoldoutNaming, true);
        }
        s_duplicateSimilarFoldout = EditorGUILayout.Foldout(s_duplicateSimilarFoldout, "重名与相似资源检测", true, EditorStyles.foldoutHeader);
        EditorPrefs.SetBool(PrefsKeyFoldoutDuplicateSimilar, s_duplicateSimilarFoldout);
        if (s_duplicateSimilarFoldout)
        {
            EditorGUILayout.BeginVertical(CardStyle);
            EditorGUI.indentLevel++;
            DrawPathSection();
            GUILayout.Space(12);
            DrawDuplicateSection();
            GUILayout.Space(12);
            DrawSimilarSection();
            EditorGUI.indentLevel--;
            EditorGUILayout.EndVertical();
        }
        GUILayout.Space(12);

        s_namingSectionFoldout = EditorGUILayout.Foldout(s_namingSectionFoldout, "命名规范检测", true, EditorStyles.foldoutHeader);
        EditorPrefs.SetBool(PrefsKeyFoldoutNaming, s_namingSectionFoldout);
        if (s_namingSectionFoldout)
        {
            EditorGUILayout.BeginVertical(CardStyle);
            EditorGUI.indentLevel++;
            DrawNamingSection();
            EditorGUI.indentLevel--;
            EditorGUILayout.EndVertical();
        }
        GUILayout.Space(12);

        DrawRenameInline();

        if (GUI.changed)
            EditorPrefs.SetString(PrefsKeyPath, s_cachedPath);
    }

    private static void DrawDescription()
    {
        var style = new GUIStyle(EditorStyles.wordWrappedLabel)
        {
            normal = { textColor = TextSecondary },
            fontSize = 12
        };
        GUILayout.Label("检查指定目录下的资源：① 重名 ② 相似贴图 ③ 命名规范（可配置规则与忽略路径/扩展名，C# 默认不检测）。路径相对于项目根。", style);
    }

    private static void DrawPathSection()
    {
        DrawSectionHeader("检查路径", AccentCyan);
        GUILayout.Space(8);

        EditorGUILayout.BeginHorizontal();
        EditorGUILayout.LabelField("资源根路径", GUILayout.Width(80));
        s_cachedPath = EditorGUILayout.TextField(s_cachedPath);
        if (GUILayout.Button("选择文件夹", GUILayout.Width(88)))
        {
            string start = string.IsNullOrEmpty(s_cachedPath) ? "Assets" : s_cachedPath;
            if (!start.StartsWith("Assets"))
                start = "Assets";
            string absolute = Path.Combine(Application.dataPath, "..", start).Replace('\\', '/');
            string chosen = EditorUtility.OpenFolderPanel("选择资源目录", absolute, "");
            if (!string.IsNullOrEmpty(chosen))
            {
                string dataPath = Application.dataPath.Replace('\\', '/');
                if (chosen.StartsWith(dataPath))
                    s_cachedPath = "Assets" + chosen.Substring(dataPath.Length).Replace('\\', '/');
                else
                    s_cachedPath = chosen;
            }
        }
        EditorGUILayout.EndHorizontal();

        string fullPath = Path.Combine(Application.dataPath, "..", s_cachedPath).Replace('\\', '/');
        bool exists = Directory.Exists(fullPath);
        var helpStyle = new GUIStyle(EditorStyles.helpBox) { normal = { textColor = TextSecondary } };
        if (exists)
            EditorGUILayout.HelpBox("目录存在。将扫描该路径及其子路径下的资源。", MessageType.None);
        else
            EditorGUILayout.HelpBox("目录不存在，请选择有效路径后再执行检查。", MessageType.Warning);
    }

    private static void DrawSectionHeader(string title, Color accent)
    {
        var style = new GUIStyle(EditorStyles.boldLabel)
        {
            fontSize = 12,
            normal = { textColor = accent }
        };
        var rect = GUILayoutUtility.GetRect(20, 22);
        EditorGUI.DrawRect(new Rect(rect.x, rect.y + 10, 4, rect.height - 8), accent);
        GUI.Label(new Rect(rect.x + 10, rect.y, rect.width - 10, rect.height), title, style);
    }

    private static void DrawDuplicateSection()
    {
        DrawSectionHeader("重名检查", HeaderDuplicate);
        GUILayout.Space(8);

        EditorGUILayout.BeginVertical(GUILayout.Height(1));
        if (ToolBox.ToolBoxStyles.DrawPrimaryButton("检查重名资源", 40f))
        {
            s_duplicateGroups = FindDuplicateNames(s_cachedPath);
        }
        EditorGUILayout.EndVertical();

        GUILayout.Space(10);

        if (s_duplicateGroups.Count == 0)
        {
            var style = new GUIStyle(EditorStyles.label) { normal = { textColor = TextSecondary }, fontSize = 11 };
            GUILayout.Label("未执行检查或未发现重名。点击上方按钮开始检查。", style);
            return;
        }

        int totalDup = s_duplicateGroups.Sum(g => g.Count);
        var summaryStyle = new GUIStyle(EditorStyles.label) { normal = { textColor = HeaderDuplicate }, fontSize = 11 };
        GUILayout.Label($"共 {s_duplicateGroups.Count} 组重名，涉及 {totalDup} 个资源。", summaryStyle);
        GUILayout.Space(6);

        EditorGUILayout.BeginVertical(CardStyle, GUILayout.MinHeight(200));
        s_duplicateScroll = EditorGUILayout.BeginScrollView(s_duplicateScroll, GUILayout.MinHeight(200), GUILayout.MaxHeight(420));
        for (int g = 0; g < s_duplicateGroups.Count; g++)
        {
            var group = s_duplicateGroups[g];
            string nameTip = Path.GetFileNameWithoutExtension(group[0]);
            GUILayout.Label($"【{nameTip}】共 {group.Count} 个", EditorStyles.boldLabel);
            for (int i = 0; i < group.Count; i++)
            {
                DrawDuplicateRow(group[i], g, i);
            }
            GUILayout.Space(6);
        }
        EditorGUILayout.EndScrollView();
        EditorGUILayout.EndVertical();
    }

    private static void DrawDuplicateRow(string assetPath, int groupIndex, int rowIndex)
    {
        bool alt = (groupIndex + rowIndex) % 2 == 0;
        var pathStyle = new GUIStyle(EditorStyles.label)
        {
            normal = { textColor = TextPrimary },
            fontSize = 11,
            alignment = TextAnchor.MiddleLeft
        };
        string displayPath = assetPath.Length > 90 ? assetPath.Substring(0, 87) + "..." : assetPath;
        EditorGUILayout.BeginHorizontal(RowStyle(alt), GUILayout.Height(32));
        GUILayout.Label(displayPath, pathStyle, GUILayout.ExpandWidth(true), GUILayout.Height(32));
        EditorGUILayout.BeginHorizontal(GUILayout.Width(BtnActionWidth * 3 + 8));
        GUI.backgroundColor = BtnLocate;
        if (GUILayout.Button("定位", GUILayout.Width(BtnActionWidth), GUILayout.Height(BtnActionHeight)))
            PingAsset(assetPath);
        GUI.backgroundColor = BtnDelete;
        if (GUILayout.Button("删除", GUILayout.Width(BtnActionWidth), GUILayout.Height(BtnActionHeight)))
            DeleteAsset(assetPath, s_duplicateGroups[groupIndex], isSimilarGroup: false);
        GUI.backgroundColor = BtnRenameHover;
        if (GUILayout.Button("重命名", GUILayout.Width(BtnActionWidth), GUILayout.Height(BtnActionHeight)))
        {
            s_renameTargetPath = assetPath;
            s_renameNewName = Path.GetFileNameWithoutExtension(assetPath);
        }
        GUI.backgroundColor = Color.white;
        EditorGUILayout.EndHorizontal();
        EditorGUILayout.EndHorizontal();
    }

    private static void DrawSimilarSection()
    {
        DrawSectionHeader("相似贴图检查", HeaderSimilar);
        GUILayout.Space(8);

        if (ToolBox.ToolBoxStyles.DrawSecondaryButton("检查相似贴图 / Sprite", 38f))
        {
            s_similarGroups = FindSimilarTextures(s_cachedPath);
        }

        GUILayout.Space(10);

        if (s_similarGroups.Count == 0)
        {
            var style = new GUIStyle(EditorStyles.label) { normal = { textColor = TextSecondary }, fontSize = 11 };
            GUILayout.Label("未执行检查或未发现相似贴图。点击上方按钮开始检查（可能需数秒）。", style);
            return;
        }

        int totalSim = s_similarGroups.Sum(g => g.Count);
        var summaryStyle = new GUIStyle(EditorStyles.label) { normal = { textColor = HeaderSimilar }, fontSize = 11 };
        GUILayout.Label($"共 {s_similarGroups.Count} 组相似贴图，涉及 {totalSim} 个资源。", summaryStyle);
        GUILayout.Space(6);

        EditorGUILayout.BeginVertical(CardStyle, GUILayout.MinHeight(200));
        s_similarScroll = EditorGUILayout.BeginScrollView(s_similarScroll, GUILayout.MinHeight(200), GUILayout.MaxHeight(420));
        for (int g = 0; g < s_similarGroups.Count; g++)
        {
            var group = s_similarGroups[g];
            GUILayout.Label($"相似组 #{g + 1}（共 {group.Count} 个资源，以下显示全部路径）", EditorStyles.boldLabel);
            for (int i = 0; i < group.Count; i++)
            {
                DrawSimilarRow(group[i], g, i);
            }
            GUILayout.Space(6);
        }
        EditorGUILayout.EndScrollView();
        EditorGUILayout.EndVertical();
    }

    private static void DrawSimilarRow(string assetPath, int groupIndex, int rowIndex)
    {
        bool alt = (groupIndex + rowIndex) % 2 == 0;
        string displayPath = assetPath.Length > 90 ? assetPath.Substring(0, 87) + "..." : assetPath;
        var pathStyle = new GUIStyle(EditorStyles.label) { normal = { textColor = TextPrimary }, fontSize = 11, wordWrap = false };
        EditorGUILayout.BeginHorizontal(RowStyle(alt), GUILayout.Height(28));
        GUILayout.Label(displayPath, pathStyle, GUILayout.ExpandWidth(true), GUILayout.Height(28));
        EditorGUILayout.BeginHorizontal(GUILayout.Width(BtnActionWidth * 2 + 4));
        GUI.backgroundColor = BtnLocate;
        if (GUILayout.Button("定位", GUILayout.Width(BtnActionWidth), GUILayout.Height(BtnActionHeight)))
            PingAsset(assetPath);
        GUI.backgroundColor = BtnDelete;
        if (GUILayout.Button("删除", GUILayout.Width(BtnActionWidth), GUILayout.Height(BtnActionHeight)))
            DeleteAsset(assetPath, s_similarGroups[groupIndex], isSimilarGroup: true);
        GUI.backgroundColor = Color.white;
        EditorGUILayout.EndHorizontal();
        EditorGUILayout.EndHorizontal();
    }

    private static void DrawNamingSection()
    {
        DrawSectionHeader("命名规范检测", HeaderNaming);
        GUILayout.Space(8);

        if (s_namingConfig == null)
            LoadNamingConfig();

        s_namingConfigFoldout = EditorGUILayout.Foldout(s_namingConfigFoldout, "规则与忽略配置", true, EditorStyles.foldoutHeader);
        if (s_namingConfigFoldout)
        {
            EditorGUI.indentLevel++;
            EditorGUILayout.BeginVertical(CardStyle);

            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField("检测根路径", GUILayout.Width(72));
            s_namingScanRoot = EditorGUILayout.TextField(s_namingScanRoot);
            if (GUILayout.Button("选目录", GUILayout.Width(48)))
            {
                string start = string.IsNullOrEmpty(s_namingScanRoot) ? "Assets" : s_namingScanRoot;
                string absolute = Path.Combine(Application.dataPath, "..", start).Replace('\\', '/');
                string chosen = EditorUtility.OpenFolderPanel("命名检测根路径", absolute, "");
                if (!string.IsNullOrEmpty(chosen))
                {
                    string dataPath = Application.dataPath.Replace('\\', '/');
                    if (chosen.StartsWith(dataPath))
                        s_namingScanRoot = "Assets" + chosen.Substring(dataPath.Length).Replace('\\', '/');
                    else
                        s_namingScanRoot = chosen;
                }
            }
            EditorGUILayout.EndHorizontal();
            EditorGUILayout.BeginHorizontal();
            GUILayout.Space(0);
            if (GUILayout.Button("导出配置", GUILayout.Width(72), GUILayout.Height(22)))
                ExportNamingConfig();
            if (GUILayout.Button("加载配置", GUILayout.Width(72), GUILayout.Height(22)))
                LoadNamingConfigFromFile();
            GUILayout.Label("导出到文件 / 从文件加载，不加载则使用当前编辑器配置。", EditorStyles.miniLabel);
            EditorGUILayout.EndHorizontal();
            GUILayout.Space(4);

            GUILayout.Label("命名规则（按扩展名）：前缀/后缀留空表示不要求；可勾选「用正则」用正则校验文件名。", EditorStyles.miniLabel);
            for (int i = 0; i < s_namingConfig.rules.Count; i++)
            {
                DrawNamingRuleRow(i);
            }
            if (GUILayout.Button("+ 添加规则", GUILayout.Height(22)))
            {
                s_namingConfig.rules.Add(new NamingRuleDef { extension = ".prefab", prefix = "PF_", suffix = "" });
                SaveNamingConfig();
            }

            GUILayout.Space(6);
            GUILayout.Label("路径规则（该路径下所有文件均按此规则，不限类型）：选择路径后添加，该路径及其子路径下资源都按此规则。", EditorStyles.miniLabel);
            for (int i = 0; i < s_namingConfig.pathRules.Count; i++)
            {
                DrawPathRuleRow(i);
            }
            EditorGUILayout.BeginHorizontal();
            if (GUILayout.Button("+ 选择路径并添加路径规则", GUILayout.Height(22)))
            {
                string start = string.IsNullOrEmpty(s_namingScanRoot) ? "Assets" : s_namingScanRoot;
                string absolute = Path.Combine(Application.dataPath, "..", start).Replace('\\', '/');
                string chosen = EditorUtility.OpenFolderPanel("选择要应用命名规则的目录", absolute, "");
                if (!string.IsNullOrEmpty(chosen))
                {
                    string dataPath = Application.dataPath.Replace('\\', '/');
                    string pathPrefix = chosen.StartsWith(dataPath)
                        ? "Assets" + chosen.Substring(dataPath.Length).Replace('\\', '/')
                        : chosen;
                    s_namingConfig.pathRules.Add(new PathRuleDef { pathPrefix = pathPrefix, prefix = "", suffix = "" });
                    SaveNamingConfig();
                }
            }
            EditorGUILayout.EndHorizontal();

            GUILayout.Space(8);
            s_namingIgnoreFoldout = EditorGUILayout.Foldout(s_namingIgnoreFoldout, "忽略项（路径前缀 / 扩展名）", true);
            if (s_namingIgnoreFoldout)
            {
                EditorGUI.indentLevel++;
                GUILayout.Label("忽略路径前缀（该路径下的资源不参与命名检测，如 TS 编译输出目录）：", EditorStyles.miniLabel);
                int pathPrefixToRemove = -1;
                for (int i = 0; i < s_namingConfig.ignorePathPrefixes.Count; i++)
                {
                    EditorGUILayout.BeginHorizontal();
                    s_namingConfig.ignorePathPrefixes[i] = EditorGUILayout.TextField(s_namingConfig.ignorePathPrefixes[i]);
                    GUI.backgroundColor = BtnDelete;
                    if (GUILayout.Button("删除", GUILayout.Width(BtnActionWidth), GUILayout.Height(BtnActionHeight)))
                        pathPrefixToRemove = i;
                    GUI.backgroundColor = Color.white;
                    EditorGUILayout.EndHorizontal();
                }
                if (pathPrefixToRemove >= 0)
                {
                    s_namingConfig.ignorePathPrefixes.RemoveAt(pathPrefixToRemove);
                    SaveNamingConfig();
                }
                if (GUILayout.Button("+ 添加忽略路径前缀", GUILayout.Height(20)))
                {
                    s_namingConfig.ignorePathPrefixes.Add("Assets/Resources/Framework");
                    SaveNamingConfig();
                }
                GUILayout.Space(4);
                GUILayout.Label("忽略扩展名（如 .cs 已默认排除；可加 .js.txt 等）：", EditorStyles.miniLabel);
                int extToRemove = -1;
                for (int i = 0; i < s_namingConfig.ignoreExtensions.Count; i++)
                {
                    EditorGUILayout.BeginHorizontal();
                    s_namingConfig.ignoreExtensions[i] = EditorGUILayout.TextField(s_namingConfig.ignoreExtensions[i]);
                    GUI.backgroundColor = BtnDelete;
                    if (GUILayout.Button("删除", GUILayout.Width(BtnActionWidth), GUILayout.Height(BtnActionHeight)))
                        extToRemove = i;
                    GUI.backgroundColor = Color.white;
                    EditorGUILayout.EndHorizontal();
                }
                if (extToRemove >= 0)
                {
                    s_namingConfig.ignoreExtensions.RemoveAt(extToRemove);
                    SaveNamingConfig();
                }
                if (GUILayout.Button("+ 添加忽略扩展名", GUILayout.Height(20)))
                {
                    s_namingConfig.ignoreExtensions.Add(".js.txt");
                    SaveNamingConfig();
                }
                EditorGUI.indentLevel--;
            }
            EditorGUILayout.EndVertical();
            if (GUI.changed)
                SaveNamingConfig();
            EditorGUI.indentLevel--;
        }

        GUILayout.Space(8);
        if (ToolBox.ToolBoxStyles.DrawPrimaryButton("检测不符合规范的资源", 40f))
        {
            s_namingViolations = FindNamingViolations(s_namingScanRoot, s_namingConfig);
            s_namingCompliant = FindNamingCompliant(s_namingScanRoot, s_namingConfig);
        }

        GUILayout.Space(10);

        if (s_namingViolations.Count == 0 && s_namingCompliant.Count == 0)
        {
            var style = new GUIStyle(EditorStyles.label) { normal = { textColor = TextSecondary }, fontSize = 11 };
            GUILayout.Label("未执行检测或未发现/符合规范的资源。可先添加规则与忽略项，再点击检测。", style);
        }
        else
        {
            if (s_namingViolations.Count > 0)
            {
                var sumStyle = new GUIStyle(EditorStyles.label) { normal = { textColor = HeaderNaming }, fontSize = 11 };
                GUILayout.Label($"不符合规范：{s_namingViolations.Count} 个", sumStyle);
                GUILayout.Space(4);
                EditorGUILayout.BeginVertical(CardStyle, GUILayout.MinHeight(200));
                s_namingScroll = EditorGUILayout.BeginScrollView(s_namingScroll, GUILayout.MinHeight(200), GUILayout.MaxHeight(420));
                for (int i = 0; i < s_namingViolations.Count; i++)
                {
                    DrawNamingViolationRow(s_namingViolations[i], i);
                }
                EditorGUILayout.EndScrollView();
                EditorGUILayout.EndVertical();
                GUILayout.Space(10);
            }

            var compliantStyle = new GUIStyle(EditorStyles.label) { normal = { textColor = TextSecondary }, fontSize = 11 };
            GUILayout.Label($"符合命名规范：{s_namingCompliant.Count} 个（列表可滑动，路径后点击「定位」可选中资源）", compliantStyle);
            GUILayout.Space(4);
            EditorGUILayout.BeginVertical(CardStyle, GUILayout.MinHeight(200));
            s_namingCompliantScroll = EditorGUILayout.BeginScrollView(s_namingCompliantScroll, GUILayout.MinHeight(200), GUILayout.MaxHeight(480));
            for (int i = 0; i < s_namingCompliant.Count; i++)
            {
                DrawNamingCompliantRow(s_namingCompliant[i], i);
            }
            EditorGUILayout.EndScrollView();
            EditorGUILayout.EndVertical();
        }
    }

    private static void DrawNamingRuleRow(int index)
    {
        var r = s_namingConfig.rules[index];
        EditorGUILayout.BeginHorizontal();
        r.extension = EditorGUILayout.TextField(r.extension, GUILayout.Width(72));
        r.prefix = EditorGUILayout.TextField(r.prefix, GUILayout.Width(72));
        r.suffix = EditorGUILayout.TextField(r.suffix, GUILayout.Width(72));
        r.useRegex = EditorGUILayout.Toggle(r.useRegex, GUILayout.Width(20));
        if (r.useRegex)
            r.pattern = EditorGUILayout.TextField(r.pattern, GUILayout.MinWidth(80));
        else
            GUILayout.Space(4);
        GUI.backgroundColor = BtnDelete;
        if (GUILayout.Button("删除", GUILayout.Width(BtnActionWidth), GUILayout.Height(BtnActionHeight)))
        {
            s_namingConfig.rules.RemoveAt(index);
            SaveNamingConfig();
        }
        GUI.backgroundColor = Color.white;
        EditorGUILayout.EndHorizontal();
    }

    private static void DrawPathRuleRow(int index)
    {
        var pr = s_namingConfig.pathRules[index];
        EditorGUILayout.BeginHorizontal();
        pr.pathPrefix = EditorGUILayout.TextField(pr.pathPrefix, GUILayout.Width(140));
        pr.prefix = EditorGUILayout.TextField(pr.prefix, GUILayout.Width(56));
        pr.suffix = EditorGUILayout.TextField(pr.suffix, GUILayout.Width(56));
        pr.useRegex = EditorGUILayout.Toggle(pr.useRegex, GUILayout.Width(20));
        if (pr.useRegex)
            pr.pattern = EditorGUILayout.TextField(pr.pattern, GUILayout.MinWidth(60));
        else
            GUILayout.Space(4);
        GUI.backgroundColor = BtnDelete;
        if (GUILayout.Button("删除", GUILayout.Width(BtnActionWidth), GUILayout.Height(BtnActionHeight)))
        {
            s_namingConfig.pathRules.RemoveAt(index);
            SaveNamingConfig();
        }
        GUI.backgroundColor = Color.white;
        EditorGUILayout.EndHorizontal();
    }

    private static void DrawNamingViolationRow(NamingViolationEntry entry, int rowIndex)
    {
        string assetPath = entry.path;
        bool alt = rowIndex % 2 == 0;
        string displayPath = assetPath.Length > 90 ? assetPath.Substring(0, 87) + "..." : assetPath;
        var pathStyle = new GUIStyle(EditorStyles.label) { normal = { textColor = TextPrimary }, fontSize = 11 };
        var reasonStyle = new GUIStyle(EditorStyles.label) { normal = { textColor = ReasonColor }, fontSize = 10, wordWrap = true };
        EditorGUILayout.BeginVertical(RowStyle(alt), GUILayout.MinHeight(44));
        EditorGUILayout.BeginHorizontal();
        GUILayout.Label(displayPath, pathStyle, GUILayout.ExpandWidth(true), GUILayout.Height(20));
        EditorGUILayout.BeginHorizontal(GUILayout.Width(BtnActionWidth * 3 + 8));
        GUI.backgroundColor = BtnLocate;
        if (GUILayout.Button("定位", GUILayout.Width(BtnActionWidth), GUILayout.Height(BtnActionHeight)))
            PingAsset(assetPath);
        GUI.backgroundColor = BtnDelete;
        if (GUILayout.Button("删除", GUILayout.Width(BtnActionWidth), GUILayout.Height(BtnActionHeight)))
        {
            if (EditorUtility.DisplayDialog("确认删除", "确定删除？\n" + assetPath, "删除", "取消"))
            {
                AssetDatabase.DeleteAsset(assetPath);
                s_namingViolations.RemoveAll(e => e.path == assetPath);
                AssetDatabase.Refresh();
            }
        }
        GUI.backgroundColor = BtnRenameHover;
        if (GUILayout.Button("重命名", GUILayout.Width(BtnActionWidth), GUILayout.Height(BtnActionHeight)))
        {
            s_renameTargetPath = assetPath;
            s_renameNewName = Path.GetFileNameWithoutExtension(assetPath);
            s_renameFromNamingSection = true;
        }
        GUI.backgroundColor = Color.white;
        EditorGUILayout.EndHorizontal();
        EditorGUILayout.EndHorizontal();
        if (!string.IsNullOrEmpty(entry.reason))
            GUILayout.Label(entry.reason, reasonStyle);
        EditorGUILayout.EndVertical();
    }

    private static void DrawNamingCompliantRow(string assetPath, int rowIndex)
    {
        bool alt = rowIndex % 2 == 0;
        string displayPath = assetPath.Length > 90 ? assetPath.Substring(0, 87) + "..." : assetPath;
        var pathStyle = new GUIStyle(EditorStyles.label) { normal = { textColor = TextPrimary }, fontSize = 11 };
        EditorGUILayout.BeginHorizontal(RowStyle(alt), GUILayout.Height(28));
        GUILayout.Label(displayPath, pathStyle, GUILayout.ExpandWidth(true), GUILayout.Height(28));
        EditorGUILayout.BeginHorizontal(GUILayout.Width(BtnActionWidth + 4));
        GUI.backgroundColor = BtnLocate;
        if (GUILayout.Button("定位", GUILayout.Width(BtnActionWidth), GUILayout.Height(BtnActionHeight)))
            PingAsset(assetPath);
        GUI.backgroundColor = Color.white;
        EditorGUILayout.EndHorizontal();
        EditorGUILayout.EndHorizontal();
    }

    private static void LoadNamingConfig()
    {
        string json = EditorPrefs.GetString(PrefsKeyNamingConfig, "");
        if (!string.IsNullOrEmpty(json))
        {
            try
            {
                s_namingConfig = JsonUtility.FromJson<NamingConfigData>(json);
                if (s_namingConfig.rules == null) s_namingConfig.rules = new List<NamingRuleDef>();
                if (s_namingConfig.pathRules == null) s_namingConfig.pathRules = new List<PathRuleDef>();
                if (s_namingConfig.ignorePathPrefixes == null) s_namingConfig.ignorePathPrefixes = new List<string>();
                if (s_namingConfig.ignoreExtensions == null) s_namingConfig.ignoreExtensions = new List<string>();
            }
            catch { s_namingConfig = NewDefaultNamingConfig(); }
        }
        else
            s_namingConfig = NewDefaultNamingConfig();
        s_namingScanRoot = EditorPrefs.GetString(PrefsKeyNamingScanRoot, NamingScanRootDefault);
    }

    private static NamingConfigData NewDefaultNamingConfig()
    {
        var c = new NamingConfigData();
        c.rules.Add(new NamingRuleDef { extension = ".prefab", prefix = "PF_", suffix = "" });
        c.rules.Add(new NamingRuleDef { extension = ".png", prefix = "Tex_", suffix = "" });
        c.rules.Add(new NamingRuleDef { extension = ".asset", prefix = "SO_", suffix = "" });
        c.ignoreExtensions.AddRange(DefaultIgnoreExtensions);
        return c;
    }

    private static void SaveNamingConfig()
    {
        if (s_namingConfig == null) return;
        EditorPrefs.SetString(PrefsKeyNamingConfig, JsonUtility.ToJson(s_namingConfig));
        EditorPrefs.SetString(PrefsKeyNamingScanRoot, s_namingScanRoot ?? NamingScanRootDefault);
    }

    private static void ExportNamingConfig()
    {
        if (s_namingConfig == null) LoadNamingConfig();
        string dir = Path.Combine(Application.dataPath, "..");
        string path = EditorUtility.SaveFilePanel("导出命名配置", dir, "AssetNamingConfig.json", "json");
        if (string.IsNullOrEmpty(path)) return;
        var export = new NamingConfigExport { scanRoot = s_namingScanRoot ?? NamingScanRootDefault, config = s_namingConfig };
        try
        {
            File.WriteAllText(path, JsonUtility.ToJson(export, true));
            EditorUtility.DisplayDialog("导出完成", "配置已导出至：\n" + path, "确定");
        }
        catch (Exception e)
        {
            EditorUtility.DisplayDialog("导出失败", e.Message, "确定");
        }
    }

    private static void LoadNamingConfigFromFile()
    {
        string dir = Path.Combine(Application.dataPath, "..");
        string path = EditorUtility.OpenFilePanel("加载命名配置", dir, "json");
        if (string.IsNullOrEmpty(path)) return;
        try
        {
            string json = File.ReadAllText(path);
            var export = JsonUtility.FromJson<NamingConfigExport>(json);
            if (export.config == null)
            {
                EditorUtility.DisplayDialog("加载失败", "配置文件格式无效。", "确定");
                return;
            }
            s_namingConfig = export.config;
            if (!string.IsNullOrEmpty(export.scanRoot))
                s_namingScanRoot = export.scanRoot;
            if (s_namingConfig.rules == null) s_namingConfig.rules = new List<NamingRuleDef>();
            if (s_namingConfig.pathRules == null) s_namingConfig.pathRules = new List<PathRuleDef>();
            if (s_namingConfig.ignorePathPrefixes == null) s_namingConfig.ignorePathPrefixes = new List<string>();
            if (s_namingConfig.ignoreExtensions == null) s_namingConfig.ignoreExtensions = new List<string>();
            SaveNamingConfig();
            EditorUtility.DisplayDialog("加载完成", "已从文件加载配置并写入编辑器当前配置。", "确定");
        }
        catch (Exception e)
        {
            EditorUtility.DisplayDialog("加载失败", e.Message, "确定");
        }
    }

    private static bool IsPathIgnoredForNaming(string assetPath, NamingConfigData config)
    {
        string path = assetPath.Replace('\\', '/');
        foreach (string prefix in config.ignorePathPrefixes)
        {
            if (string.IsNullOrEmpty(prefix)) continue;
            string p = prefix.TrimEnd('/');
            if (path.StartsWith(p, StringComparison.OrdinalIgnoreCase) || path.StartsWith(p + "/", StringComparison.OrdinalIgnoreCase))
                return true;
        }
        string ext = Path.GetExtension(assetPath);
        if (string.IsNullOrEmpty(ext)) return false;
        foreach (string ignore in DefaultIgnoreExtensions)
        {
            if (string.Equals(ext, ignore, StringComparison.OrdinalIgnoreCase)) return true;
        }
        foreach (string ignore in config.ignoreExtensions)
        {
            if (string.IsNullOrEmpty(ignore)) continue;
            if (string.Equals(ext, ignore.Trim(), StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    private static NamingRuleDef GetRuleForExtension(NamingConfigData config, string extension)
    {
        if (config?.rules == null) return null;
        string ext = (extension ?? "").ToLowerInvariant();
        if (!ext.StartsWith(".")) ext = "." + ext;
        NamingRuleDef fallback = null;
        foreach (var r in config.rules)
        {
            string re = (r.extension ?? "").Trim().ToLowerInvariant();
            if (re == "*") { fallback = r; continue; }
            if (re == ext) return r;
        }
        return fallback;
    }

    private static bool IsNameCompliant(string nameWithoutExtension, NamingRuleDef rule)
    {
        if (rule == null || string.IsNullOrEmpty(nameWithoutExtension)) return true;
        return IsNameCompliantWith(nameWithoutExtension, rule.prefix, rule.suffix, rule.useRegex, rule.pattern);
    }

    private static bool IsNameCompliantWith(string nameWithoutExtension, string prefix, string suffix, bool useRegex, string pattern)
    {
        if (string.IsNullOrEmpty(nameWithoutExtension)) return true;
        if (useRegex && !string.IsNullOrEmpty(pattern))
        {
            try { return Regex.IsMatch(nameWithoutExtension, pattern); }
            catch { return false; }
        }
        prefix = prefix ?? "";
        suffix = suffix ?? "";
        if (prefix.Length > 0 && !nameWithoutExtension.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return false;
        if (suffix.Length > 0 && !nameWithoutExtension.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)) return false;
        return true;
    }

    private static string DescribeRule(string prefix, string suffix, bool useRegex, string pattern)
    {
        if (useRegex && !string.IsNullOrEmpty(pattern))
            return "匹配正则: " + pattern;
        var parts = new List<string>();
        if (!string.IsNullOrEmpty(prefix)) parts.Add("前缀 \"" + prefix + "\"");
        if (!string.IsNullOrEmpty(suffix)) parts.Add("后缀 \"" + suffix + "\"");
        return parts.Count > 0 ? string.Join("、", parts) : "（未设前缀/后缀）";
    }

    private static PathRuleDef GetPathRuleForAsset(NamingConfigData config, string assetPath)
    {
        if (config?.pathRules == null || config.pathRules.Count == 0) return null;
        string path = assetPath.Replace('\\', '/');
        PathRuleDef best = null;
        int bestLen = 0;
        foreach (var pr in config.pathRules)
        {
            string p = (pr.pathPrefix ?? "").Trim().Replace('\\', '/').TrimEnd('/');
            if (string.IsNullOrEmpty(p)) continue;
            if (!path.StartsWith(p, StringComparison.OrdinalIgnoreCase)) continue;
            if (path.Length > p.Length && path[p.Length] != '/') continue;
            if (p.Length > bestLen) { bestLen = p.Length; best = pr; }
        }
        return best;
    }

    private static List<NamingViolationEntry> FindNamingViolations(string rootPath, NamingConfigData config)
    {
        var list = new List<NamingViolationEntry>();
        if (config == null || config.rules == null || config.rules.Count == 0) return list;
        string searchRoot = string.IsNullOrEmpty(rootPath) ? "Assets" : rootPath;
        string[] guids = AssetDatabase.FindAssets("t:Object", new[] { searchRoot });
        foreach (string guid in guids)
        {
            string path = AssetDatabase.GUIDToAssetPath(guid);
            if (string.IsNullOrEmpty(path)) continue;
            if (IsPathIgnoredForNaming(path, config)) continue;
            string nameOnly = Path.GetFileNameWithoutExtension(path);
            if (string.IsNullOrEmpty(nameOnly)) continue;

            var pathRule = GetPathRuleForAsset(config, path);
            if (pathRule != null)
            {
                if (!IsNameCompliantWith(nameOnly, pathRule.prefix, pathRule.suffix, pathRule.useRegex, pathRule.pattern))
                {
                    string reason = $"路径规则「{pathRule.pathPrefix.TrimEnd('/')}」要求：{DescribeRule(pathRule.prefix, pathRule.suffix, pathRule.useRegex, pathRule.pattern)}";
                    list.Add(new NamingViolationEntry { path = path, reason = reason });
                }
                continue;
            }
            string ext = Path.GetExtension(path);
            var rule = GetRuleForExtension(config, ext);
            if (rule == null) continue;
            if (!IsNameCompliant(nameOnly, rule))
            {
                string reason = $"扩展名 {ext} 要求：{DescribeRule(rule.prefix, rule.suffix, rule.useRegex, rule.pattern)}";
                list.Add(new NamingViolationEntry { path = path, reason = reason });
            }
        }
        return list;
    }

    private static List<string> FindNamingCompliant(string rootPath, NamingConfigData config)
    {
        var list = new List<string>();
        if (config == null) return list;
        string searchRoot = string.IsNullOrEmpty(rootPath) ? "Assets" : rootPath;
        string[] guids = AssetDatabase.FindAssets("t:Object", new[] { searchRoot });
        foreach (string guid in guids)
        {
            string path = AssetDatabase.GUIDToAssetPath(guid);
            if (string.IsNullOrEmpty(path)) continue;
            if (IsPathIgnoredForNaming(path, config)) continue;
            string nameOnly = Path.GetFileNameWithoutExtension(path);
            if (string.IsNullOrEmpty(nameOnly)) continue;

            var pathRule = GetPathRuleForAsset(config, path);
            if (pathRule != null)
            {
                if (IsNameCompliantWith(nameOnly, pathRule.prefix, pathRule.suffix, pathRule.useRegex, pathRule.pattern))
                    list.Add(path);
                continue;
            }
            string ext = Path.GetExtension(path);
            var rule = GetRuleForExtension(config, ext);
            if (rule == null) continue;
            if (IsNameCompliant(nameOnly, rule))
                list.Add(path);
        }
        return list;
    }

    private static void DrawRenameInline()
    {
        if (string.IsNullOrEmpty(s_renameTargetPath)) return;

        GUILayout.Space(8);
        EditorGUILayout.BeginVertical(GUI.skin.box);
        GUILayout.Label("重命名资源", EditorStyles.boldLabel);
        EditorGUILayout.BeginHorizontal();
        s_renameNewName = EditorGUILayout.TextField("新名称（不含扩展名）", s_renameNewName);
        if (GUILayout.Button("确定", GUILayout.Width(56)))
        {
            string oldPath = s_renameTargetPath;
            bool fromNaming = s_renameFromNamingSection;
            ApplyRename(s_renameTargetPath, s_renameNewName);
            s_renameTargetPath = null;
            s_renameNewName = "";
            s_renameFromNamingSection = false;
            RefreshDuplicateListAfterRename(oldPath);
            if (fromNaming)
                RefreshNamingListAfterRename(oldPath);
        }
        if (GUILayout.Button("取消", GUILayout.Width(56)))
        {
            s_renameTargetPath = null;
            s_renameNewName = "";
            s_renameFromNamingSection = false;
        }
        EditorGUILayout.EndHorizontal();
        EditorGUILayout.EndVertical();
    }

    private static List<List<string>> FindDuplicateNames(string rootPath)
    {
        var groups = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        string searchRoot = string.IsNullOrEmpty(rootPath) ? "Assets" : rootPath;
        string[] guids = AssetDatabase.FindAssets("t:Object", new[] { searchRoot });
        foreach (string guid in guids)
        {
            string path = AssetDatabase.GUIDToAssetPath(guid);
            if (string.IsNullOrEmpty(path)) continue;
            string name = Path.GetFileNameWithoutExtension(path);
            if (string.IsNullOrEmpty(name)) continue;
            if (!groups.TryGetValue(name, out var list))
            {
                list = new List<string>();
                groups[name] = list;
            }
            list.Add(path);
        }
        return groups.Values.Where(g => g.Count > 1).ToList();
    }

    private static List<List<string>> FindSimilarTextures(string rootPath)
    {
        if (string.IsNullOrEmpty(rootPath)) rootPath = "Assets";
        var pathSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string filter in new[] { "t:Texture2D", "t:Sprite" })
        {
            foreach (string guid in AssetDatabase.FindAssets(filter, new[] { rootPath }))
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                if (!string.IsNullOrEmpty(path))
                    pathSet.Add(path);
            }
        }
        var pathToHash = new Dictionary<string, string>();
        var hashToPaths = new Dictionary<string, List<string>>(StringComparer.Ordinal);

        foreach (string path in pathSet)
        {
            string hash = ComputeTextureContentHash(path);
            if (string.IsNullOrEmpty(hash)) continue;
            pathToHash[path] = hash;
            if (!hashToPaths.TryGetValue(hash, out var list))
            {
                list = new List<string>();
                hashToPaths[hash] = list;
            }
            list.Add(path);
        }

        return hashToPaths.Values.Where(g => g.Count > 1).ToList();
    }

    private static string ComputeTextureContentHash(string assetPath)
    {
        Texture2D tex = AssetDatabase.LoadAssetAtPath<Texture2D>(assetPath);
        if (tex == null)
        {
            var sp = AssetDatabase.LoadAssetAtPath<Sprite>(assetPath);
            if (sp != null && sp.texture != null)
                tex = sp.texture;
        }
        if (tex == null) return null;
        RenderTexture rt = RenderTexture.GetTemporary(32, 32, 0, RenderTextureFormat.ARGB32);
        RenderTexture prev = RenderTexture.active;
        RenderTexture.active = rt;
        Graphics.Blit(tex, rt);
        Texture2D small = new Texture2D(32, 32);
        small.ReadPixels(new Rect(0, 0, 32, 32), 0, 0);
        small.Apply();
        RenderTexture.active = prev;
        RenderTexture.ReleaseTemporary(rt);

        Color32[] pixels = small.GetPixels32();
        DestroyImmediate(small);
        if (pixels == null || pixels.Length == 0) return null;

        ulong hash = 0;
        int step = Mathf.Max(1, pixels.Length / 64);
        for (int i = 0; i < pixels.Length; i += step)
        {
            hash = hash * 31 + pixels[i].r;
            hash = hash * 31 + pixels[i].g;
            hash = hash * 31 + pixels[i].b;
        }
        return hash.ToString("X16");
    }

    private static void DeleteAsset(string assetPath, List<string> groupList, bool isSimilarGroup = false)
    {
        if (!EditorUtility.DisplayDialog("确认删除", "确定要删除资源？\n" + assetPath, "删除", "取消"))
            return;
        AssetDatabase.DeleteAsset(assetPath);
        groupList.Remove(assetPath);
        if (groupList.Count < 2)
        {
            if (isSimilarGroup)
                s_similarGroups.Remove(groupList);
            else
                s_duplicateGroups.Remove(groupList);
        }
        AssetDatabase.Refresh();
    }

    private static void ApplyRename(string assetPath, string newName)
    {
        if (string.IsNullOrEmpty(newName))
        {
            EditorUtility.DisplayDialog("提示", "名称不能为空。", "确定");
            return;
        }
        string dir = Path.GetDirectoryName(assetPath).Replace('\\', '/');
        string ext = Path.GetExtension(assetPath);
        string newPath = dir + "/" + newName + ext;
        if (AssetDatabase.LoadAssetAtPath<UnityEngine.Object>(newPath) != null)
        {
            EditorUtility.DisplayDialog("重命名失败", "已存在同名资源：" + newPath, "确定");
            return;
        }
        string err = AssetDatabase.RenameAsset(assetPath, newName + ext);
        if (!string.IsNullOrEmpty(err))
            EditorUtility.DisplayDialog("重命名失败", err, "确定");
        AssetDatabase.Refresh();
    }

    private static void PingAsset(string assetPath)
    {
        if (string.IsNullOrEmpty(assetPath)) return;
        var obj = AssetDatabase.LoadAssetAtPath<UnityEngine.Object>(assetPath);
        if (obj != null)
        {
            EditorGUIUtility.PingObject(obj);
            Selection.activeObject = obj;
        }
    }

    private static void RefreshDuplicateListAfterRename(string oldPath)
    {
        if (string.IsNullOrEmpty(oldPath)) return;
        for (int i = s_duplicateGroups.Count - 1; i >= 0; i--)
        {
            var g = s_duplicateGroups[i];
            g.Remove(oldPath);
            if (g.Count < 2)
                s_duplicateGroups.RemoveAt(i);
        }
    }

    private static void RefreshNamingListAfterRename(string oldPath)
    {
        if (string.IsNullOrEmpty(oldPath)) return;
        s_namingViolations.RemoveAll(e => e.path == oldPath);
    }
}

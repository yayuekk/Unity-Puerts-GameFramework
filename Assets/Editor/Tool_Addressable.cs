using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.AddressableAssets;
using UnityEditor.AddressableAssets.Settings;
using UnityEditor.AddressableAssets.Settings.GroupSchemas;
using UnityEngine;

/// <summary>
/// Addressable 资源管理工具：在 ToolBox 右侧面板展示，UE5 风格。
/// 功能：创建/删除 Addressable 数据与资源组；树形文件夹勾选 + Labels 配置；一键导出并自动简化地址；配置可保存/加载。
/// </summary>
public class Tool_Addressable : EditorWindow
{
    // ── EditorPrefs keys ─────────────────────────────────────────────────────
    private const string PrefRootPath   = "Tool_Addressable_RootPath";
    private const string PrefConfigPath = "Tool_Addressable_ConfigPath";

    // ── Defaults ──────────────────────────────────────────────────────────────
    private const string DefaultRootPath   = "Assets/GameMain";
    private const string DefaultConfigPath = "Assets/GameMain/Config/AddressableExportConfig.json";

    // ── Runtime state ─────────────────────────────────────────────────────────
    private static string s_rootPath;
    private static string s_configPath;
    private static readonly List<FolderNode> s_rootNodes = new List<FolderNode>();
    private static bool   s_treeLoaded;
    private static string s_statusMsg  = "";
    private static MessageType s_statusType = MessageType.Info;

    // ── UE5 palette ───────────────────────────────────────────────────────────
    private static readonly Color C_TextPrimary    = new Color(0.95f, 0.95f, 0.95f);
    private static readonly Color C_TextSecondary  = new Color(0.62f, 0.62f, 0.64f);
    private static readonly Color C_AccentCyan     = new Color(0.00f, 0.72f, 0.88f);
    private static readonly Color C_AccentGreen    = new Color(0.20f, 0.68f, 0.36f);
    private static readonly Color C_AccentGreenHov = new Color(0.30f, 0.85f, 0.50f);
    private static readonly Color C_AccentOrange   = new Color(0.92f, 0.58f, 0.12f);
    private static readonly Color C_AccentOrangeH  = new Color(1.00f, 0.74f, 0.28f);
    private static readonly Color C_AccentRed      = new Color(0.78f, 0.26f, 0.26f);
    private static readonly Color C_AccentRedHov   = new Color(0.95f, 0.40f, 0.40f);
    private static readonly Color C_RowA           = new Color(0.16f, 0.16f, 0.18f);
    private static readonly Color C_RowB           = new Color(0.14f, 0.14f, 0.155f);
    private static readonly Color C_RowChecked     = new Color(0.06f, 0.18f, 0.30f);
    private static readonly Color C_RowDisabled    = new Color(0.13f, 0.13f, 0.14f);
    private static readonly Color C_SectionHdr     = new Color(0.10f, 0.10f, 0.12f);
    private static readonly Color C_DisabledText   = new Color(0.38f, 0.38f, 0.40f);
    private static readonly Color C_CheckedText    = new Color(0.32f, 0.80f, 1.00f);

    // ── Cached textures ───────────────────────────────────────────────────────
    private static Texture2D s_texRowA, s_texRowB, s_texRowChecked, s_texRowDisabled;

    // ─────────────────────────────────────────────────────────────────────────
    // Data model
    // ─────────────────────────────────────────────────────────────────────────
    private class FolderNode
    {
        public string           path;
        public string           name;
        public bool             isChecked;
        public bool             isExpanded = true;
        public List<FolderNode> children   = new List<FolderNode>();

        // Computed each frame – not persisted
        [NonSerialized] public bool parentIsChecked;
    }

    [Serializable]
    private class ExportConfig
    {
        public string            rootPath = DefaultRootPath;
        public List<ExportEntry> entries  = new List<ExportEntry>();
    }

    [Serializable]
    private class ExportEntry
    {
        public string path;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Entry point – called by ToolBox
    // ─────────────────────────────────────────────────────────────────────────
    public static void DrawToolPanel()
    {
        EnsureInit();

        // ── Description ───────────────────────────────────────────────────────
        DrawSectionHeader("Addressable 资源管理", C_AccentCyan);
        GUILayout.Space(6);
        DrawDesc("管理 Addressable 资源组：创建 / 删除数据、配置文件夹导出规则，将勾选文件夹的资源批量导入对应资源组。\n" +
                 "资源组名 = 文件夹名 ｜ Labels 自动添加（同名） ｜ 地址 = 文件名（不含扩展名）");
        GUILayout.Space(14);

        // ── Path config ───────────────────────────────────────────────────────
        DrawSectionHeader("路径配置", C_AccentOrange, small: true);
        GUILayout.Space(6);
        DrawPathRow("资源根路径", ref s_rootPath, PrefRootPath, () => { s_treeLoaded = false; RefreshTree(); });
        GUILayout.Space(4);
        DrawPathRow("配置文件路径", ref s_configPath, PrefConfigPath, null);
        GUILayout.Space(14);

        // ── System actions ────────────────────────────────────────────────────
        DrawSectionHeader("系统操作", C_AccentCyan, small: true);
        GUILayout.Space(6);
        EditorGUILayout.BeginHorizontal();
        if (DrawColBtn("✚  创建数据", C_AccentGreen, C_AccentGreenHov, 34f))
            OnCreateSettings();
        GUILayout.Space(6);
        if (DrawColBtn("✕  删除所有资源组", C_AccentOrange, C_AccentOrangeH, 34f))
        {
            if (EditorUtility.DisplayDialog("确认操作",
                    "将删除所有 Addressable 资源组（不含 Built-in Data），此操作不可撤销。",
                    "确认删除", "取消"))
                OnDeleteAllGroups();
        }
        GUILayout.Space(6);
        if (DrawColBtn("⚠  删除 Addressable 数据", C_AccentRed, C_AccentRedHov, 34f))
        {
            if (EditorUtility.DisplayDialog("危险操作",
                    "将删除整个 AddressableAssetsData 文件夹，所有配置均会丢失，此操作不可撤销！",
                    "确认删除", "取消"))
                OnDeleteSettings();
        }
        EditorGUILayout.EndHorizontal();
        GUILayout.Space(14);

        // ── Status ────────────────────────────────────────────────────────────
        if (!string.IsNullOrEmpty(s_statusMsg))
        {
            EditorGUILayout.HelpBox(s_statusMsg, s_statusType);
            GUILayout.Space(8);
        }

        // ── Folder tree ───────────────────────────────────────────────────────
        DrawSectionHeader("文件夹选择", C_AccentCyan, small: true);
        GUILayout.Space(4);

        // Toolbar
        EditorGUILayout.BeginHorizontal();
        if (MiniBtn("全选"))     SetAllChecked(s_rootNodes, true);
        if (MiniBtn("全不选"))   SetAllChecked(s_rootNodes, false);
        GUILayout.Space(6);
        if (MiniBtn("展开全部")) SetAllExpanded(s_rootNodes, true);
        if (MiniBtn("折叠全部")) SetAllExpanded(s_rootNodes, false);
        GUILayout.FlexibleSpace();
        if (MiniBtn("⟳ 刷新"))  { s_treeLoaded = false; RefreshTree(); }
        EditorGUILayout.EndHorizontal();
        GUILayout.Space(4);

        // Column header
        DrawTreeColumnHeader();
        GUILayout.Space(2);

        if (s_rootNodes.Count == 0)
        {
            EditorGUILayout.HelpBox(
                "未找到任何子文件夹，请检查「资源根路径」是否正确，或点击「⟳ 刷新」重新扫描。",
                MessageType.Warning);
        }
        else
        {
            UpdateParentFlags(s_rootNodes, false);
            int rowIdx = 0;
            foreach (var node in s_rootNodes)
                DrawFolderNode(node, 0, ref rowIdx);
        }

        GUILayout.Space(14);

        // ── Export / config actions ───────────────────────────────────────────
        DrawSectionHeader("导出操作", C_AccentGreen, small: true);
        GUILayout.Space(6);
        EditorGUILayout.BeginHorizontal();
        if (ToolBox.ToolBoxStyles.DrawPrimaryButton("▶  导出到 Addressable", 40f))
        {
            OnExport();
            SaveConfig(silent: true);
        }
        GUILayout.Space(6);
        if (ToolBox.ToolBoxStyles.DrawSecondaryButton("💾  保存配置", 40f, 110f))
            SaveConfig(silent: false);
        GUILayout.Space(6);
        if (ToolBox.ToolBoxStyles.DrawSecondaryButton("📂  加载配置", 40f, 110f))
            LoadConfig();
        EditorGUILayout.EndHorizontal();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Init / tree build
    // ─────────────────────────────────────────────────────────────────────────
    private static void EnsureInit()
    {
        if (s_rootPath == null)
            s_rootPath   = EditorPrefs.GetString(PrefRootPath,   DefaultRootPath);
        if (s_configPath == null)
            s_configPath = EditorPrefs.GetString(PrefConfigPath, DefaultConfigPath);
        if (!s_treeLoaded)
            RefreshTree();
    }

    private static void RefreshTree()
    {
        s_treeLoaded = true;
        s_rootNodes.Clear();
        if (!AssetDatabase.IsValidFolder(s_rootPath)) return;
        foreach (var sub in AssetDatabase.GetSubFolders(s_rootPath))
            s_rootNodes.Add(BuildNode(sub));
    }

    private static FolderNode BuildNode(string path)
    {
        var node = new FolderNode
        {
            path = path,
            name = Path.GetFileName(path)
        };
        foreach (var sub in AssetDatabase.GetSubFolders(path))
            node.children.Add(BuildNode(sub));
        return node;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tree rendering
    // ─────────────────────────────────────────────────────────────────────────
    private static void DrawTreeColumnHeader()
    {
        var rect = GUILayoutUtility.GetRect(GUIContent.none, GUIStyle.none,
            GUILayout.Height(18), GUILayout.ExpandWidth(true));
        EditorGUI.DrawRect(rect, new Color(0.08f, 0.08f, 0.10f));

        var hdrStyle = new GUIStyle(EditorStyles.miniLabel)
        {
            normal    = { textColor = C_TextSecondary },
            alignment = TextAnchor.MiddleLeft,
            padding   = new RectOffset(10, 0, 0, 0)
        };
        GUI.Label(rect, "文件夹（导出时自动添加同名 Label）", hdrStyle);
    }

    private static void UpdateParentFlags(List<FolderNode> nodes, bool parentChecked)
    {
        foreach (var n in nodes)
        {
            n.parentIsChecked = parentChecked;
            UpdateParentFlags(n.children, parentChecked || n.isChecked);
        }
    }

    private static void DrawFolderNode(FolderNode node, int depth, ref int rowIdx)
    {
        bool isDisabled = node.parentIsChecked;
        int  slot       = rowIdx++ % 2;

        Texture2D bg = isDisabled ? GetTex(ref s_texRowDisabled, C_RowDisabled)
                     : node.isChecked ? GetTex(ref s_texRowChecked, C_RowChecked)
                     : slot == 0 ? GetTex(ref s_texRowA, C_RowA)
                     : GetTex(ref s_texRowB, C_RowB);

        var rowStyle = new GUIStyle(GUIStyle.none)
        {
            normal  = { background = bg },
            padding = new RectOffset(0, 0, 0, 0)
        };
        EditorGUILayout.BeginHorizontal(rowStyle, GUILayout.Height(26));

        // Indent
        GUILayout.Space(depth * 20f + 4f);

        // Expand / collapse arrow
        if (node.children.Count > 0)
        {
            string arrow = node.isExpanded ? "▾" : "▸";
            var arrowS = new GUIStyle(GUIStyle.none)
            {
                alignment = TextAnchor.MiddleCenter,
                fontSize  = 12,
                normal    = { textColor = C_TextSecondary }
            };
            if (GUILayout.Button(arrow, arrowS, GUILayout.Width(16), GUILayout.Height(26)))
                node.isExpanded = !node.isExpanded;
        }
        else
        {
            GUILayout.Space(16);
        }

        GUILayout.Space(3);

        // Checkbox
        using (new EditorGUI.DisabledGroupScope(isDisabled))
        {
            node.isChecked = EditorGUILayout.Toggle(node.isChecked, GUILayout.Width(14));
        }

        GUILayout.Space(4);

        // Folder icon + name
        Texture folderIcon = EditorGUIUtility.IconContent("Folder Icon").image;
        var nameStyle = new GUIStyle(EditorStyles.label)
        {
            alignment = TextAnchor.MiddleLeft,
            fontSize   = 12,
            fontStyle  = node.isChecked ? FontStyle.Bold : FontStyle.Normal,
            normal     = { textColor = isDisabled ? C_DisabledText
                                     : node.isChecked ? C_CheckedText
                                     : C_TextPrimary }
        };
        GUILayout.Label(new GUIContent(" " + node.name, folderIcon), nameStyle,
            GUILayout.MinWidth(80), GUILayout.Height(26));

        // Label tag badge – shows when checked
        if (node.isChecked)
        {
            var badge = new GUIStyle(EditorStyles.miniLabel)
            {
                normal    = { textColor = C_AccentOrange },
                alignment = TextAnchor.MiddleRight,
                fontStyle = FontStyle.Bold
            };
            GUILayout.Label("# " + node.name, badge, GUILayout.Width(120));
        }

        GUILayout.Space(4);
        EditorGUILayout.EndHorizontal();

        // Children
        if (node.isExpanded && node.children.Count > 0)
        {
            foreach (var child in node.children)
                DrawFolderNode(child, depth + 1, ref rowIdx);
        }
    }

    private static void SetAllChecked(List<FolderNode> nodes, bool value)
    {
        foreach (var n in nodes) { n.isChecked = value; SetAllChecked(n.children, value); }
    }

    private static void SetAllExpanded(List<FolderNode> nodes, bool value)
    {
        foreach (var n in nodes) { n.isExpanded = value; SetAllExpanded(n.children, value); }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Addressable operations
    // ─────────────────────────────────────────────────────────────────────────
    private static void OnCreateSettings()
    {
        if (AddressableAssetSettingsDefaultObject.Settings != null)
        {
            SetStatus("Addressable 数据已存在，无需重新创建。", MessageType.Warning);
            return;
        }
        AddressableAssetSettings.Create(
            AddressableAssetSettingsDefaultObject.kDefaultConfigFolder,
            AddressableAssetSettingsDefaultObject.kDefaultConfigAssetName,
            true, true);
        SetStatus("✔  Addressable 数据已创建。", MessageType.Info);
    }

    private static void OnDeleteAllGroups()
    {
        var settings = AddressableAssetSettingsDefaultObject.Settings;
        if (settings == null) { SetStatus("未找到 Addressable 数据，请先创建。", MessageType.Warning); return; }

        int removed = 0;
        foreach (var g in settings.groups.ToList())
        {
            if (g == null || g.IsDefaultGroup()) continue;
            settings.RemoveGroup(g);
            removed++;
        }
        AssetDatabase.SaveAssets();
        SetStatus($"✔  已删除 {removed} 个资源组。", MessageType.Info);
    }

    private static void OnDeleteSettings()
    {
        const string folder = "Assets/AddressableAssetsData";
        if (!AssetDatabase.IsValidFolder(folder))
        {
            SetStatus("未找到 AddressableAssetsData 文件夹。", MessageType.Warning);
            return;
        }
        bool ok = AssetDatabase.DeleteAsset(folder);
        AssetDatabase.Refresh();
        SetStatus(ok ? "✔  Addressable 数据已删除。"
                     : "✘  删除失败，请手动删除 AddressableAssetsData 文件夹。",
                  ok ? MessageType.Info : MessageType.Error);
    }

    private static void OnExport()
    {
        var settings = AddressableAssetSettingsDefaultObject.Settings;
        if (settings == null)
        {
            if (!EditorUtility.DisplayDialog("提示", "未找到 Addressable 数据，是否立即创建？", "创建", "取消"))
                return;
            AddressableAssetSettings.Create(
                AddressableAssetSettingsDefaultObject.kDefaultConfigFolder,
                AddressableAssetSettingsDefaultObject.kDefaultConfigAssetName,
                true, true);
            settings = AddressableAssetSettingsDefaultObject.Settings;
            if (settings == null) { SetStatus("✘  Addressable 数据创建失败。", MessageType.Error); return; }
        }

        var checkedNodes = CollectChecked(s_rootNodes);
        if (checkedNodes.Count == 0)
        {
            SetStatus("请先勾选至少一个文件夹再导出。", MessageType.Warning);
            return;
        }

        int totalEntries = 0;
        foreach (var node in checkedNodes)
        {
            string groupName = node.name;

            // Find or create group
            var group = settings.FindGroup(g => g != null && g.Name == groupName);
            if (group == null)
                group = settings.CreateGroup(groupName, false, false, true, null,
                    typeof(BundledAssetGroupSchema), typeof(ContentUpdateGroupSchema));

            // Always register the label (same name as group / folder)
            settings.AddLabel(groupName);

            // Add all assets in this folder (including sub-folders)
            string[] guids = AssetDatabase.FindAssets("", new[] { node.path });
            foreach (var guid in guids)
            {
                string assetPath = AssetDatabase.GUIDToAssetPath(guid);
                if (string.IsNullOrEmpty(assetPath)) continue;
                if (AssetDatabase.IsValidFolder(assetPath)) continue;

                var entry = settings.CreateOrMoveEntry(guid, group, false, false);
                if (entry == null) continue;

                // Simplify address to filename without extension
                entry.address = Path.GetFileNameWithoutExtension(assetPath);

                // Every asset gets the group-name label automatically
                entry.SetLabel(groupName, true, true, false);

                totalEntries++;
            }
        }

        AssetDatabase.SaveAssets();
        SetStatus($"✔  导出完成！共导入 {totalEntries} 个资源到 {checkedNodes.Count} 个资源组。",
                  MessageType.Info);
    }

    private static List<FolderNode> CollectChecked(List<FolderNode> nodes)
    {
        var result = new List<FolderNode>();
        foreach (var n in nodes)
        {
            if (n.isChecked) result.Add(n);
            else result.AddRange(CollectChecked(n.children));
        }
        return result;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Config save / load
    // ─────────────────────────────────────────────────────────────────────────
    private static void SaveConfig(bool silent = false)
    {
        var config = new ExportConfig { rootPath = s_rootPath };
        CollectEntries(s_rootNodes, config.entries);
        string json = JsonUtility.ToJson(config, true);
        try
        {
            string full = Path.GetFullPath(s_configPath);
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            File.WriteAllText(full, json);
            AssetDatabase.Refresh();
            if (!silent) SetStatus($"✔  配置已保存至 {s_configPath}", MessageType.Info);
        }
        catch (Exception ex)
        {
            SetStatus("✘  保存失败：" + ex.Message, MessageType.Error);
        }
    }

    private static void CollectEntries(List<FolderNode> nodes, List<ExportEntry> entries)
    {
        foreach (var n in nodes)
        {
            if (n.isChecked) entries.Add(new ExportEntry { path = n.path });
            else CollectEntries(n.children, entries);
        }
    }

    private static void LoadConfig()
    {
        string full = Path.GetFullPath(s_configPath);
        if (!File.Exists(full))
        {
            SetStatus("✘  配置文件不存在：" + s_configPath, MessageType.Warning);
            return;
        }
        try
        {
            var config = JsonUtility.FromJson<ExportConfig>(File.ReadAllText(full));
            if (config == null) { SetStatus("✘  配置文件解析失败。", MessageType.Error); return; }

            if (!string.IsNullOrEmpty(config.rootPath) && config.rootPath != s_rootPath)
            {
                s_rootPath = config.rootPath;
                EditorPrefs.SetString(PrefRootPath, s_rootPath);
                s_treeLoaded = false;
                RefreshTree();
            }

            SetAllChecked(s_rootNodes, false);
            var lookup = config.entries.ToDictionary(e => e.path);
            ApplyConfig(s_rootNodes, lookup);
            SetStatus("✔  配置加载成功。", MessageType.Info);
        }
        catch (Exception ex)
        {
            SetStatus("✘  加载失败：" + ex.Message, MessageType.Error);
        }
    }

    private static void ApplyConfig(List<FolderNode> nodes, Dictionary<string, ExportEntry> lookup)
    {
        foreach (var n in nodes)
        {
            if (lookup.TryGetValue(n.path, out _))
            {
                n.isChecked = true;
            }
            else
            {
                ApplyConfig(n.children, lookup);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UI helpers
    // ─────────────────────────────────────────────────────────────────────────
    private static void DrawPathRow(string label, ref string value, string prefsKey, Action onChanged)
    {
        EditorGUILayout.BeginHorizontal();
        var ls = new GUIStyle(EditorStyles.label) { normal = { textColor = C_TextSecondary }, fontSize = 11 };
        GUILayout.Label(label, ls, GUILayout.Width(90));
        string nv = EditorGUILayout.TextField(value);
        if (nv != value)
        {
            value = nv;
            EditorPrefs.SetString(prefsKey, nv);
            onChanged?.Invoke();
        }
        EditorGUILayout.EndHorizontal();
    }

    private static void DrawDesc(string text)
    {
        var s = new GUIStyle(EditorStyles.wordWrappedLabel)
        {
            normal  = { textColor = C_TextSecondary },
            fontSize = 11
        };
        GUILayout.Label(text, s);
    }

    private static void DrawSectionHeader(string title, Color accentColor, bool small = false)
    {
        var rect = GUILayoutUtility.GetRect(GUIContent.none, GUIStyle.none,
            GUILayout.Height(small ? 22 : 28), GUILayout.ExpandWidth(true));
        EditorGUI.DrawRect(rect, C_SectionHdr);
        EditorGUI.DrawRect(new Rect(rect.x, rect.y, 3f, rect.height), accentColor);
        GUI.Label(rect, title, new GUIStyle(EditorStyles.boldLabel)
        {
            fontSize  = small ? 11 : 13,
            normal    = { textColor = accentColor },
            alignment = TextAnchor.MiddleLeft,
            padding   = new RectOffset(10, 0, 0, 0)
        });
    }

    private static bool DrawColBtn(string text, Color bg, Color hov, float height = 34f)
    {
        var s = new GUIStyle(GUI.skin.button)
        {
            fontSize   = 11,
            fontStyle  = FontStyle.Bold,
            alignment  = TextAnchor.MiddleCenter,
            normal     = { textColor = Color.white },
            hover      = { textColor = Color.white },
            padding    = new RectOffset(10, 10, 6, 6),
            border     = new RectOffset(0, 0, 0, 0),
            fixedHeight = 0
        };
        var rect = GUILayoutUtility.GetRect(GUIContent.none, s,
            GUILayout.Height(height), GUILayout.ExpandWidth(true));
        EditorGUI.DrawRect(rect, rect.Contains(Event.current.mousePosition) ? hov : bg);
        return GUI.Button(rect, text, s);
    }

    private static bool MiniBtn(string text)
        => GUILayout.Button(text, EditorStyles.miniButton, GUILayout.Height(22));

    private static void SetStatus(string msg, MessageType type)
    {
        s_statusMsg  = msg;
        s_statusType = type;
    }

    private static Texture2D GetTex(ref Texture2D field, Color c)
    {
        if (field != null) return field;
        field = new Texture2D(1, 1);
        field.SetPixel(0, 0, c);
        field.Apply();
        return field;
    }
}

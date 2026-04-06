using System.IO;
using System.Reflection;
using UnityEditor;
using UnityEngine;

public class Tool_JsToTxt : EditorWindow
{
    private const string PrefsKeyPath = "Tool_JsToTxt_ResourcesPath";
    private const string DefaultRelativePath = "Resources";

    private static string s_cachedRelativePath;

    private void OnGUI()
    {
        DrawToolPanel();
    }

    /// <summary>
    /// 在 ToolBox 右侧面板中绘制的界面，逻辑保持在本脚本中。
    /// </summary>
    public static void DrawToolPanel()
    {
        if (string.IsNullOrEmpty(s_cachedRelativePath))
            s_cachedRelativePath = EditorPrefs.GetString(PrefsKeyPath, DefaultRelativePath);

        // 说明区域
        ToolBox.ToolBoxStyles.DrawDescription("将指定目录下所有 .js 文件重命名为 .js.txt，并删除冲突的 .js.map 文件。路径相对于 Assets 文件夹。");
        GUILayout.Space(20);

        // ========== 路径配置卡片 ==========
        DrawSectionHeader("路径配置");
        GUILayout.Space(6);

        EditorGUILayout.BeginHorizontal();
        EditorGUILayout.LabelField("目标路径 (相对 Assets)", GUILayout.Width(140));
        s_cachedRelativePath = EditorGUILayout.TextField(s_cachedRelativePath);
        if (GUILayout.Button("选择文件夹", GUILayout.Width(80)))
        {
            string assetsPath = Application.dataPath;
            string startPath = Directory.Exists(GetFullPath(s_cachedRelativePath))
                ? GetFullPath(s_cachedRelativePath)
                : assetsPath;
            string chosen = EditorUtility.OpenFolderPanel("选择目标目录", startPath, "");
            if (!string.IsNullOrEmpty(chosen))
            {
                if (chosen.StartsWith(assetsPath))
                    s_cachedRelativePath = chosen.Substring(assetsPath.Length).TrimStart('/', '\\').Replace('\\', '/');
                else
                    s_cachedRelativePath = chosen;
            }
        }
        EditorGUILayout.EndHorizontal();

        string fullPath = GetFullPath(s_cachedRelativePath);
        bool pathExists = Directory.Exists(fullPath);
        if (pathExists)
            EditorGUILayout.HelpBox($"完整路径: {fullPath}", MessageType.None);
        else
            EditorGUILayout.HelpBox("目录不存在，转换或清空时将自动创建或提示。", MessageType.Info);

        if (GUI.changed)
            EditorPrefs.SetString(PrefsKeyPath, s_cachedRelativePath);

        GUILayout.Space(20);

        // ========== 操作区域 ==========
        DrawSectionHeader("操作");
        GUILayout.Space(12);

        if (ToolBox.ToolBoxStyles.DrawPrimaryButton("开始转换", 44f))
        {
            ConvertJsFiles(GetFullPath(s_cachedRelativePath));
        }

        GUILayout.Space(10);

        GUI.backgroundColor = new Color(0.7f, 0.35f, 0.35f);
        if (ToolBox.ToolBoxStyles.DrawSecondaryButton("清空该路径下所有文件", 40f))
        {
            ClearAllFilesInPath(GetFullPath(s_cachedRelativePath));
        }
        GUI.backgroundColor = Color.white;

        GUILayout.Space(20);

        // ========== 常用操作 ==========
        DrawSectionHeader("常用操作");
        GUILayout.Space(12);

        if (ToolBox.ToolBoxStyles.DrawSecondaryButton("清空 Console 打印信息", 36f))
        {
            ClearEditorConsole();
        }
    }

    /// <summary>
    /// 清空 Unity 编辑器 Console 窗口中的日志（通过反射调用内部 API）。
    /// </summary>
    private static void ClearEditorConsole()
    {
        try
        {
            var assembly = Assembly.GetAssembly(typeof(Editor));
            var type = assembly.GetType("UnityEditorInternal.LogEntries") ?? assembly.GetType("UnityEditor.LogEntries");
            if (type == null)
            {
                Debug.LogWarning("无法找到 LogEntries 类型，当前 Unity 版本可能不支持清空 Console。");
                return;
            }
            var method = type.GetMethod("Clear", BindingFlags.Static | BindingFlags.Public);
            if (method == null)
                method = type.GetMethod("Clear", BindingFlags.Static | BindingFlags.NonPublic);
            if (method != null)
            {
                method.Invoke(null, null);
                return;
            }
            Debug.LogWarning("无法找到 LogEntries.Clear 方法。");
        }
        catch (System.Exception e)
        {
            Debug.LogWarning("清空 Console 失败: " + e.Message);
        }
    }

    private static void DrawSectionHeader(string title)
    {
        var style = new GUIStyle(EditorStyles.boldLabel)
        {
            fontSize = 12,
            normal = { textColor = new Color(0.72f, 0.72f, 0.74f, 1f) }
        };
        GUILayout.Label(title, style);
    }

    private static string GetFullPath(string relativePath)
    {
        if (string.IsNullOrEmpty(relativePath)) relativePath = DefaultRelativePath;
        return Path.Combine(Application.dataPath, relativePath.TrimStart('/', '\\').Replace('\\', '/'));
    }

    private static void ConvertJsFiles(string resourcesPath)
    {
        if (!Directory.Exists(resourcesPath))
        {
            EditorUtility.DisplayDialog("错误", "未找到目标文件夹！", "确定");
            return;
        }

        // Delete .js.map files first — they share the same Unity resource path as .js.txt files
        int mapDeleteCount = 0;
        string[] mapFiles = Directory.GetFiles(resourcesPath, "*.js.map", SearchOption.AllDirectories);
        foreach (string mapPath in mapFiles)
        {
            try
            {
                File.Delete(mapPath);
                string mapMeta = mapPath + ".meta";
                if (File.Exists(mapMeta)) File.Delete(mapMeta);
                mapDeleteCount++;
            }
            catch (System.Exception e)
            {
                Debug.LogWarning($"删除失败: {mapPath} -> 错误: {e.Message}");
            }
        }

        string[] jsFiles = Directory.GetFiles(resourcesPath, "*.js", SearchOption.AllDirectories);

        if (jsFiles.Length == 0)
        {
            AssetDatabase.Refresh();
            string msg = mapDeleteCount > 0
                ? $"已删除 {mapDeleteCount} 个 .js.map 文件。目标目录下没有找到任何 .js 文件。"
                : "目标目录下没有找到任何 .js 文件。";
            EditorUtility.DisplayDialog("提示", msg, "确定");
            return;
        }

        int successCount = 0;
        foreach (string filePath in jsFiles)
        {
            try
            {
                string newFilePath = filePath + ".txt";
                File.Move(filePath, newFilePath);
                string metaPath = filePath + ".meta";
                string newMetaPath = newFilePath + ".meta";
                if (File.Exists(metaPath))
                    File.Move(metaPath, newMetaPath);
                successCount++;
            }
            catch (System.Exception e)
            {
                Debug.LogWarning($"重命名失败: {filePath} -> 错误: {e.Message}");
            }
        }

        AssetDatabase.Refresh();
        EditorUtility.DisplayDialog("完成",
            $"转换完成！重命名 {successCount}/{jsFiles.Length} 个 .js 文件，删除 {mapDeleteCount} 个 .js.map 文件。",
            "确定");
    }

    private static void ClearAllFilesInPath(string targetPath)
    {
        if (!Directory.Exists(targetPath))
        {
            EditorUtility.DisplayDialog("提示", "目标目录不存在，无需清空。", "确定");
            return;
        }

        string[] allFiles = Directory.GetFiles(targetPath, "*", SearchOption.AllDirectories);
        int fileCount = allFiles.Length;
        if (fileCount == 0)
        {
            EditorUtility.DisplayDialog("提示", "该目录下没有任何文件。", "确定");
            return;
        }

        bool confirm = EditorUtility.DisplayDialog("确认清空",
            $"将删除该路径下的所有文件（共 {fileCount} 个，含 .meta），且不可恢复。\n\n确定要继续吗？",
            "确定清空",
            "取消");
        if (!confirm) return;

        int deleted = 0;
        foreach (string file in Directory.GetFiles(targetPath, "*", SearchOption.AllDirectories))
        {
            try
            {
                File.Delete(file);
                deleted++;
            }
            catch (System.Exception e)
            {
                Debug.LogWarning($"删除失败: {file} -> {e.Message}");
            }
        }

        AssetDatabase.Refresh();
        EditorUtility.DisplayDialog("完成", $"已删除 {deleted} 个文件。", "确定");
    }
}

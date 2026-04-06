namespace GameFramework.UI
{
    /// <summary>
    /// UI 层级枚举，从下到上依次排列。
    /// 每个层级对应一个独立的 Canvas，并使用专属的 Sorting Layer。
    /// 上层的 Canvas 会通过 Blocker 遮罩下层，拦截输入事件。
    ///
    /// Sorting Layer 名称对应关系（需在 Project Settings → Tags & Layers 中创建）：
    ///   Bottom → UI_Bottom
    ///   Normal → UI_Normal
    ///   Queue  → UI_Queue
    ///   Pop    → UI_Pop
    ///   Top    → UI_Top
    /// </summary>
    public enum UILayer
    {
        /// <summary>底层 —— 地图、背景类 HUD</summary>
        Bottom = 0,
        /// <summary>普通层 —— 主界面、功能界面</summary>
        Normal = 1,
        /// <summary>队列层 —— 排队弹出的通知、公告</summary>
        Queue  = 2,
        /// <summary>弹窗层 —— 对话框、确认框</summary>
        Pop    = 3,
        /// <summary>顶层 —— 全局 Loading、错误提示</summary>
        Top    = 4,
    }
}

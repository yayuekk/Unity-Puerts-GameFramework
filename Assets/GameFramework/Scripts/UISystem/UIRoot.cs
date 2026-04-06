using System;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.EventSystems;

namespace GameFramework.UI
{
    /// <summary>
    /// UIRoot — UI 系统场景根节点管理器。
    ///
    /// 职责：
    ///   - 创建 UICamera（可添加到 URP 主摄像机的 Camera Stack）
    ///   - 确保场景中存在 EventSystem
    ///   - 按照 UILayer 枚举顺序创建五个独立的 Canvas 层级
    ///   - 为每个层级维护层间遮罩 Blocker，上层打开时屏蔽下层输入
    ///   - 提供静态工具方法供 TypeScript 层调用
    ///
    /// 设置步骤：
    ///   1. 在场景中创建空 GameObject 并挂载此脚本（建议命名 "UIRoot"）
    ///   2. 在 Project Settings → Tags &amp; Layers → Sorting Layers 中按顺序创建：
    ///      UI_Bottom、UI_Normal、UI_Queue、UI_Pop、UI_Top
    ///   3. 在主摄像机的 URP Additional Camera Data 的 Camera Stack 中添加 UICamera
    /// </summary>
    [AddComponentMenu("GameFramework/UI/UIRoot")]
    [DisallowMultipleComponent]
    public class UIRoot : MonoBehaviour
    {
        // ── 常量 ──────────────────────────────────────────────────────────────────

        /// <summary>
        /// 每个层级对应的 Sorting Layer 名称，须在 Unity 中手动创建。
        /// 顺序必须与 UILayer 枚举值保持一致。
        /// </summary>
        private static readonly string[] k_SortingLayerNames =
        {
            "UI_Bottom",  // UILayer.Bottom = 0
            "UI_Normal",  // UILayer.Normal = 1
            "UI_Queue",   // UILayer.Queue  = 2
            "UI_Pop",     // UILayer.Pop    = 3
            "UI_Top",     // UILayer.Top    = 4
        };

        private const float k_DefaultReferenceWidth  = 1920f;
        private const float k_DefaultReferenceHeight = 1080f;
        private const float k_UIPlaneDistance        = 100f;

        // ── 单例 ──────────────────────────────────────────────────────────────────

        /// <summary>
        /// UIRoot 全局单例，TypeScript 层通过 CS.GameFramework.UI.UIRoot.Instance 访问。
        /// </summary>
        public static UIRoot Instance { get; private set; }

        // ── Inspector 字段 ────────────────────────────────────────────────────────

        [Header("Canvas Scaler — 参考分辨率")]
        [Tooltip("UI 设计基准宽度，通常为 1920")]
        [SerializeField] private float referenceWidth = k_DefaultReferenceWidth;

        [Tooltip("UI 设计基准高度，通常为 1080")]
        [SerializeField] private float referenceHeight = k_DefaultReferenceHeight;

        [Tooltip("屏幕适配模式")]
        [SerializeField] private CanvasScaler.ScreenMatchMode screenMatchMode =
            CanvasScaler.ScreenMatchMode.MatchWidthOrHeight;

        [Tooltip("0 = 以宽度为基准，1 = 以高度为基准，0.5 = 折中")]
        [Range(0f, 1f)]
        [SerializeField] private float matchWidthOrHeight = 0.5f;

        // ── 运行时状态 ────────────────────────────────────────────────────────────

        /// <summary>
        /// UI 专属摄像机，Screen Space - Camera 模式下所有 UI Canvas 的渲染摄像机。
        /// 获取后将其添加到 URP 主摄像机 Camera Stack 中以正确合并渲染。
        /// </summary>
        public Camera UICamera { get; private set; }

        private readonly Transform[]  _layerRoots    = new Transform[5];
        private readonly Canvas[]     _layerCanvases = new Canvas[5];

        // _blockers[0] 始终为 null（Bottom 层无需对更底层进行遮挡）
        // _blockers[1..4] 分别是 Normal/Queue/Pop/Top 层的半透明遮罩
        private readonly GameObject[] _blockers      = new GameObject[5];

        // ── Unity 生命周期 ────────────────────────────────────────────────────────

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }

            Instance = this;
            DontDestroyOnLoad(gameObject);

            BuildUICamera();
            EnsureEventSystem();
            BuildLayers();
        }

        private void OnDestroy()
        {
            if (Instance == this)
                Instance = null;
        }

        // ── 构建流程 ──────────────────────────────────────────────────────────────

        private void BuildUICamera()
        {
            var camGo = new GameObject("UICamera");
            camGo.transform.SetParent(transform, false);
            camGo.transform.localPosition = new Vector3(0f, 0f, -1000f);
            camGo.layer = LayerMask.NameToLayer("UI");

            UICamera                = camGo.AddComponent<Camera>();
            UICamera.clearFlags     = CameraClearFlags.Depth;
            UICamera.cullingMask    = LayerMask.GetMask("UI");
            UICamera.orthographic   = true;
            UICamera.nearClipPlane  = -1000f;
            UICamera.farClipPlane   = 1000f;
            // depth > 0 确保此摄像机在主摄像机之后渲染（URP Stack 中无需关心此值）
            UICamera.depth          = 100f;
        }

        private static void EnsureEventSystem()
        {
            if (FindObjectOfType<EventSystem>() != null)
                return;

            var esGo = new GameObject("EventSystem");
            DontDestroyOnLoad(esGo);
            esGo.AddComponent<EventSystem>();
            esGo.AddComponent<StandaloneInputModule>();
        }

        private void BuildLayers()
        {
            var names = Enum.GetNames(typeof(UILayer));
            for (int i = 0; i < names.Length; i++)
                BuildLayerCanvas((UILayer)i, names[i]);
        }

        private void BuildLayerCanvas(UILayer layer, string layerName)
        {
            int idx = (int)layer;

            var go  = new GameObject($"Layer_{layerName}");
            go.layer = LayerMask.NameToLayer("UI");
            go.transform.SetParent(transform, false);

            // Canvas — 添加后 Unity 自动将 Transform 升级为 RectTransform
            var canvas = go.AddComponent<Canvas>();
            canvas.renderMode        = RenderMode.ScreenSpaceCamera;
            canvas.worldCamera       = UICamera;
            canvas.planeDistance     = k_UIPlaneDistance;
            canvas.sortingLayerName  = k_SortingLayerNames[idx];
            canvas.sortingOrder      = 0;
            canvas.pixelPerfect      = false;

            // CanvasScaler — Scale With Screen Size
            var scaler = go.AddComponent<CanvasScaler>();
            scaler.uiScaleMode         = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(referenceWidth, referenceHeight);
            scaler.screenMatchMode     = screenMatchMode;
            scaler.matchWidthOrHeight  = matchWidthOrHeight;

            // GraphicRaycaster — 接收输入事件
            go.AddComponent<GraphicRaycaster>();

            _layerRoots[idx]    = go.transform;
            _layerCanvases[idx] = canvas;

            // Bottom 层（idx=0）无需层间遮罩，其余层各自创建一个 Blocker
            if (idx > 0)
                _blockers[idx] = BuildBlocker(go.transform);
        }

        /// <summary>
        /// 创建层间遮罩：全屏半透明黑色 Image，作为该层 Canvas 的最底部子节点。
        /// 激活后将视觉上遮暗下方层级，并拦截所有鼠标/触摸输入。
        /// </summary>
        private static GameObject BuildBlocker(Transform layerRoot)
        {
            var blocker = new GameObject("_Blocker");
            blocker.layer = LayerMask.NameToLayer("UI");
            blocker.transform.SetParent(layerRoot, false);

            // 添加 Image 会自动创建 RectTransform
            var img = blocker.AddComponent<Image>();
            img.color         = new Color(0f, 0f, 0f, 0.4f);
            img.raycastTarget = true;

            // 拉伸填满父 Canvas
            var rt = blocker.GetComponent<RectTransform>();
            rt.anchorMin        = Vector2.zero;
            rt.anchorMax        = Vector2.one;
            rt.sizeDelta        = Vector2.zero;
            rt.anchoredPosition = Vector2.zero;

            // 置为最底部子节点，确保 UI 面板渲染在遮罩之上
            blocker.transform.SetAsFirstSibling();
            blocker.SetActive(false);

            return blocker;
        }

        // ── 公共 API ──────────────────────────────────────────────────────────────

        /// <summary>获取指定层级的根 Transform，供 TS 层实例化 UI 时设置父节点。</summary>
        public Transform GetLayerRoot(UILayer layer) => _layerRoots[(int)layer];

        /// <summary>获取指定层级的 Canvas 组件。</summary>
        public Canvas GetLayerCanvas(UILayer layer) => _layerCanvases[(int)layer];

        /// <summary>
        /// 显示或隐藏指定层级的层间遮罩（Blocker）。
        /// 当某层有界面打开时，该层的遮罩应当激活，以屏蔽下方层级的输入。
        /// </summary>
        /// <param name="layer">目标层级（Bottom 层此操作无效）</param>
        /// <param name="visible">true = 显示遮罩；false = 隐藏遮罩</param>
        public void SetLayerBlocker(UILayer layer, bool visible)
        {
            int idx = (int)layer;
            if (idx > 0 && _blockers[idx] != null)
                _blockers[idx].SetActive(visible);
        }

        /// <summary>
        /// 设置 UI GameObject 根节点 Canvas 的 Override Sorting Order（即 Panel Distance）。
        /// 数值越大，该界面渲染越靠前（视觉上在其他界面之上）。
        /// 若 GameObject 上没有 Canvas 组件，将自动添加 Canvas 与 GraphicRaycaster。
        /// </summary>
        /// <param name="uiGo">UI 预制体根节点 GameObject</param>
        /// <param name="sortingOrder">排序数值，由 UIStage 统一分配，范围 [10, 500]</param>
        public static void SetUIPanelDistance(GameObject uiGo, int sortingOrder)
        {
            if (uiGo == null) return;

            var canvas = uiGo.GetComponent<Canvas>();
            if (canvas == null)
            {
                canvas = uiGo.AddComponent<Canvas>();
                uiGo.AddComponent<GraphicRaycaster>();
            }

            canvas.overrideSorting = true;
            canvas.sortingOrder    = sortingOrder;
        }

        /// <summary>
        /// 读取挂载在 UI 预制体根节点上的 UIConfig 组件。
        /// TS 层在实例化 UI 后通过此方法获取配置数据。
        /// </summary>
        public static UIConfig GetUIConfig(GameObject uiGo)
            => uiGo != null ? uiGo.GetComponent<UIConfig>() : null;
    }
}

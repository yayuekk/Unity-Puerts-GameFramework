using System;
using Puerts;
using UnityEngine;

namespace GameFramework
{
    /// <summary>
/// 项目总启动器 MonoBehaviour。
/// 负责创建 Puerts JS 运行环境，驱动 TypeScript 侧三层框架（Framework / GAS / TD_Game）的完整生命周期。
///
/// 生命周期驱动流程：
///   Start()     → 创建 JsEnv → require('index') 执行 TS Bootstrap → 缓存 onUpdate / onDestroy 钩子
///   Update()    → JsEnv.Tick()（驱动 Promise/async） → onUpdate(Time.deltaTime)
///   OnDestroy() → onDestroy() → JsEnv.Dispose()
/// </summary>
[DisallowMultipleComponent]
public class GameFramework : MonoBehaviour
{
#if UNITY_EDITOR
    [Header("调试设置（仅编辑器生效）")]
    [Tooltip("开启 Puerts 调试端口（9229），可使用 Chrome DevTools 对 TS 代码进行断点调试")]
    [SerializeField] private bool _enableDebug = true;

    [Tooltip("启动时阻塞，直到 Chrome DevTools 连接后才继续执行（需先勾选 EnableDebug）\n" +
             "打开 chrome://inspect 并连接 localhost:9229 即可继续")]
    [SerializeField] private bool _waitForDebugger = false;
#endif

    private JsEnv         _jsEnv;
    private Action<float> _onUpdate;
    private Action        _onDestroy;

    // ── Unity 生命周期 ────────────────────────────────────────────────────────

    void Start()
    {
        try
        {
            CreateJsEnv();
            LoadTsEntry();
        }
        catch (Exception e)
        {
            Debug.LogError($"[GameFramework] TS 环境启动失败：\n{e}");
        }
    }

    void Update()
    {
        // 驱动 JS 侧 Promise / 微任务队列（async/await 依赖此调用）
        _jsEnv?.Tick();
        _onUpdate?.Invoke(Time.deltaTime);
    }

    void OnDestroy()
    {
        try
        {
            _onDestroy?.Invoke();
        }
        catch (Exception e)
        {
            Debug.LogError($"[GameFramework] TS 卸载阶段发生异常：\n{e}");
        }
        finally
        {
            _jsEnv?.Dispose();
            _jsEnv = null;
        }
    }

    // ── 私有实现 ──────────────────────────────────────────────────────────────

    private void CreateJsEnv()
    {
        var loader = new DefaultLoader(UnityEngine.Application.dataPath + "/Resources");

#if UNITY_EDITOR
        if (_enableDebug)
        {
            _jsEnv = new JsEnv(loader, 9229);
            if (_waitForDebugger)
            {
                Debug.Log("[GameFramework] 等待 Chrome DevTools 连接（chrome://inspect → localhost:9229）...");
                _jsEnv.WaitDebugger();
            }
            return;
        }
#endif
        _jsEnv = new JsEnv(loader);
    }

    private void LoadTsEntry()
    {
        // 注册泛型委托桥接器，Puerts 在反射模式下需要显式声明才能将 JS 函数包装为对应委托
        _jsEnv.UsingAction<float>();

        // 加载并执行 TS Bootstrap 入口（Assets/GameMain/Resources/index.cjs）
        // require 会缓存模块，后续多次调用返回同一 exports 对象
        _jsEnv.Eval("require('index')");

        // 缓存 TS 侧暴露的生命周期钩子，避免每帧 Eval 带来的开销
        _onUpdate  = _jsEnv.Eval<Action<float>>("require('index').onUpdate");
        _onDestroy = _jsEnv.Eval<Action>       ("require('index').onDestroy");

        Debug.Log("[GameFramework] TS 环境启动成功。");
    }
}
}

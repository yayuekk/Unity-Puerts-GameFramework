using System;
using UnityEngine;
using UnityEngine.AddressableAssets;
using UnityEngine.ResourceManagement.AsyncOperations;
using UnityEngine.SceneManagement;

/// <summary>
/// 供 Puerts/TS 调用的 Addressables 桥接（Puerts 生成器未为 LoadAssetAsync 等生成绑定时使用）。
/// </summary>
public static class AddressablesBridge
{
    /// <summary>Addressables.LoadAssetAsync(key) → AsyncOperationHandle，TS 侧可用 .Task / .Status / .Result</summary>
    public static AsyncOperationHandle<UnityEngine.Object> LoadAssetAsync(string key)
    {
        return Addressables.LoadAssetAsync<UnityEngine.Object>(key);
    }

    /// <summary>Addressables.InstantiateAsync(key [, parent])</summary>
    public static AsyncOperationHandle<GameObject> InstantiateAsync(string key, Transform parent = null)
    {
        return parent != null
            ? Addressables.InstantiateAsync(key, parent)
            : Addressables.InstantiateAsync(key);
    }

    /// <summary>Addressables.Release(handle)，handle 为 LoadAssetAsync/InstantiateAsync 返回的句柄（TS 传回时以 object 接收）</summary>
    public static void Release(object handle)
    {
        if (handle == null) return;
        if (handle is AsyncOperationHandle aoh)
        {
            Addressables.Release(aoh);
            return;
        }
        if (handle is AsyncOperationHandle<UnityEngine.Object> aohObj)
        {
            Addressables.Release(aohObj);
            return;
        }
        if (handle is AsyncOperationHandle<GameObject> aohGo)
        {
            Addressables.Release(aohGo);
            return;
        }
        UnityEngine.Debug.LogWarning("[AddressablesBridge] Release received unknown handle type: " + handle.GetType().FullName);
    }

    /// <summary>Addressables.ReleaseInstance(go)</summary>
    public static void ReleaseInstance(GameObject go)
    {
        Addressables.ReleaseInstance(go);
    }

    /// <summary>Addressables.LoadSceneAsync(key, loadMode)，loadMode: 0=Single, 1=Additive</summary>
    public static AsyncOperationHandle<UnityEngine.ResourceManagement.ResourceProviders.SceneInstance> LoadSceneAsync(string key, int loadMode)
    {
        var mode = loadMode == 1 ? LoadSceneMode.Additive : LoadSceneMode.Single;
        return Addressables.LoadSceneAsync(key, mode);
    }

    /// <summary>Addressables.UnloadSceneAsync(sceneInstance)，sceneInstance 为 LoadSceneAsync 返回的 handle.Result（TS 传回时以 object 接收）</summary>
    public static AsyncOperationHandle<UnityEngine.ResourceManagement.ResourceProviders.SceneInstance> UnloadSceneAsync(object sceneInstance)
    {
        if (sceneInstance is UnityEngine.ResourceManagement.ResourceProviders.SceneInstance si)
            return Addressables.UnloadSceneAsync(si);
        throw new ArgumentException("UnloadSceneAsync requires SceneInstance (e.g. LoadSceneAsync result's .Result)", nameof(sceneInstance));
    }
}

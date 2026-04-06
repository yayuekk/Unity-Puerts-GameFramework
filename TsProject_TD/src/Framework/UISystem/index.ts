/**
 * UISystem 模块公共出口
 *
 * 推荐通过此文件统一导入，避免直接依赖各子文件路径。
 *
 * 使用示例：
 *   import {
 *     UIClass, UISystem,
 *     ViewBase, ModelBase, ServiceBase,
 *     UIComponent, UIDataReader,
 *     UILayer, UIOpenMode,
 *   } from "../Framework/UISystem";
 */

export { UISystem }                    from "./UISystem";
export { UIClass, getUIClassCtor }     from "./UIClassRegistry";
export { UIStage }                     from "./UIStage";
export { UINodeBase }                  from "./UINodeBase";
export { ViewBase }                    from "./ViewBase";
export { ModelBase }                   from "./ModelBase";
export { ServiceBase }                 from "./ServiceBase";
export { UIComponent }                 from "./UIComponent";
export { UIDataReader }                from "./UIDataReader";

export {
    UILayer,
    UIOpenMode,
    UIOpenFailReason,
} from "./UITypes";

export type {
    UIOpenFailedCallback,
    IUIRuntimeConfig,
    IUIContext,
    IViewBase,
    IModelBase,
    IServiceBase,
    ViewConstructor,
    ModelConstructor,
    ServiceConstructor,
    ClassConstructor,
} from "./UITypes";

export type { IUIChildNode } from "./UINodeBase";

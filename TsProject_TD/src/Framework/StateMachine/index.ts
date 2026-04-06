/**
 * StateMachine 模块公共 API 出口
 *
 * 使用方式：
 *   import { StateMachine, StateBase } from "../Framework/StateMachine";
 *   import type { IStateMachine, IStateBase, TransitionGuard } from "../Framework/StateMachine";
 *
 * 或通过 Framework 统一入口：
 *   import { StateMachine, StateBase } from "../Framework";
 */

export { StateMachine }  from "./StateMachine";
export { StateBase }     from "./StateBase";

export type {
    IStateBase,
    IState,
    IStateMachine,
    ITransitionHandle,
    StateConstructor,
    TransitionGuard,
    TransitionCallback,
} from "./StateMachineTypes";

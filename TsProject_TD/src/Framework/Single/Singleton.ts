/**
 * Singleton<T> — 泛型单例基类
 *
 * 用法：
 *   class MyManager extends Singleton<MyManager> {
 *       doSomething() { ... }
 *   }
 *
 *   // 获取单例（首次调用时自动创建）
 *   MyManager.getInstance().doSomething();
 *
 *   // 销毁单例
 *   MyManager.destroyInstance();
 *
 * 注意：
 *   - 子类必须提供无参构造函数（或不声明构造函数）。
 *   - 如需在构造函数中执行初始化逻辑，请重写 onInit()，在 getInstance() 首次调用后由框架或业务代码主动调用。
 */
export abstract class Singleton<T extends Singleton<T>> {

    private static readonly _instances = new Map<Function, Singleton<any>>();

    protected constructor() {}

    /**
     * 获取子类单例实例。
     * 首次调用时自动通过无参构造函数创建实例并缓存。
     */
    static getInstance<T extends Singleton<T>>(this: new () => T): T {
        const key = this as unknown as Function;
        let inst = Singleton._instances.get(key);
        if (inst == null) {
            inst = new this();
            Singleton._instances.set(key, inst);
        }
        return inst as T;
    }

    /**
     * 销毁子类单例，释放缓存引用。
     */
    static destroyInstance(this: abstract new (...args: any[]) => any): void {
        Singleton._instances.delete(this as unknown as Function);
    }

    /**
     * 判断子类单例是否已创建。
     */
    static hasInstance(this: abstract new (...args: any[]) => any): boolean {
        return Singleton._instances.has(this as unknown as Function);
    }
}

import { UnityEngine } from "csharp";
import { GameFramework, ITimerSystem } from "../../Framework";
import { IEventSystem } from "../../Framework/EventModule";
import { IPoolSystem } from "../../Framework/PoolModule";
import { ILogSystem, LogSystem } from "../../Framework/LogModule"
import { IResSystem } from "../../Framework/ResModule"
import { GASLayer, GAS_MODULE_NAME } from "../../GameplayAbilitySystem";






export class ExampleDemo{

    private _framework!: GameFramework;
    private _gas!: GASLayer;

    private _log !: ILogSystem;

    private _event !: IEventSystem;

    private _pool !: IPoolSystem

    private _res !: IResSystem

    private _timer !: ITimerSystem

    constructor(_framework : GameFramework, _gas : GASLayer)
    {
        this._framework = _framework
        this._gas = _gas
        this._log = this._framework.log
        this._event = this._framework.event
        this._pool = this._framework.pool
        this._res = this._framework.res
        this._timer = this._framework.timer
    }


    public Init() : void {

        // 监听事件（必须传 { context: this }，否则回调内 this 会丢失，this._log 为空）
        const handle = this._event.on("player:levelUp", this.method1, { context: this })

        this._event.emit("player:levelUp", 5);

        
        this.LoadGo()
    }

    private async LoadGo() : Promise<any>  {
        const bulletPool = await this._pool.createGoPoolAsync("Cube", {
            name              : "Cube_Pool",
            initialCapacity   : 10,   // 初始预热数量
            maxCapacity       : 50,    // 最大容量（0=不限）
            autoDestroyDelay  : 60000,    // 空闲多少秒后自动销毁池（可选）
        });

        const bullet = bulletPool.get();
        bullet.SetActive(true);
    }

    private async LoadSprite() : Promise<any> {
        // 异步加载（返回句柄，用完必须 release）
        const handle = await this._res.loadAsync<UnityEngine.Sprite>("main");
        const sprite = handle.asset; // 实际的 C# Sprite 对象
        this._log.info("====>资源" + sprite.name + "====>" + typeof(sprite));
        // 用完后释放（计数归零时真正卸载）
        handle.release();
    }


    private method1(newLevel: number) : void {
    
        console.log(`玩家升级到====> ${newLevel} 级！`);
        this._log.info(`玩家升级到====> ${newLevel} 级！`);

        // 3 秒后执行一次
        const handle = this._timer.addSecondTimer(3, () => {
        console.log("====>3秒到！");
        this.LoadSprite();
        })
        
    }

}
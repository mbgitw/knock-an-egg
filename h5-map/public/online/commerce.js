import {productOf} from '../gameplay/commerce/catalog.js';
import {purchaseContext} from '../gameplay/commerce/state.js';
import {encode,decode} from '../gameplay/commerce/cloud-save.js';
import {OP} from './protocol.js';
const KEY='pasture_room_purchase',unwrap=r=>{if(!r?.ok)throw Error(r?.error?.code||'HOST_UNAVAILABLE');return r.data;};
export function installRoomCommerce(game,connection){
  const c=game.commerce;
  let paidInMemory=null;
  const rpc=(action,values={})=>new Promise((resolve,reject)=>{
    if(!connection.session.ready){reject(Error('ROOM_UNAVAILABLE'));return;}
    const key=crypto.randomUUID(),off=connection.observe((type,data)=>{if(type!=='payment'||data.key!==key)return;clearTimeout(timer);off();data.ok?resolve(data):reject(Error(data.reason));});
    const timer=setTimeout(()=>{off();reject(Error('PAYMENT_PENDING'));},10000);
    try{connection.session.room.sendReliable(OP.PAYMENT,new TextEncoder().encode(JSON.stringify({key,action,...values})));}catch(e){clearTimeout(timer);off();reject(e);}
  });
  c.exclusive=async(action,{silent=false}={})=>{if(c.busy)return {ok:false,error:'PAY_BUSY'};c.busy=true;if(!silent)c.onBusy(true);try{if(!c.sdk?.iap||!c.sdk?.privateKV)throw Error('HOST_UNAVAILABLE');const result=await action();c.onChange();return {ok:true,...result};}catch(e){if(!silent)c.onMessage(e.message);return {ok:false,error:e.message};}finally{c.busy=false;if(!silent)c.onBusy(false);}};
  const store=async value=>{unwrap(await c.sdk.privateKV.set(KEY,encode(value)));paidInMemory=value;};
  const saved=async()=>{
    const record=paidInMemory||decode(unwrap(await c.sdk.privateKV.get(KEY)));
    // Retire legacy preparation only; real payment receipts remain recoverable.
    if(record&&!record.orderId&&!record.applied){await store(null);return null;}
    return record;
  };
  const deliver=async record=>{
    if(record.grantBy!=='room')throw Error('ORDER_REQUIRES_CLIENT');
    for(let i=0;i<4;i++){
      let result;
      try{result=await rpc('deliver',{orderId:record.orderId,options:record.options||{}});}
      catch(error){if(error?.message!=='SAVE_PENDING')throw error;}
      if(result?.delivered){await store(null);return {delivered:true};}
      await new Promise(resolve=>setTimeout(resolve,500*(i+1)));
    }throw Error('PAYMENT_PENDING');
  };
  c.buy=(id,options={})=>c.exclusive(async()=>{
    const product=productOf(id);if(!product)throw Error('UNKNOWN_PRODUCT');
    const prior=await saved();if(prior?.orderId){await store(prior);return deliver(prior);}
    if(!connection.session.ready)throw Error('ROOM_UNAVAILABLE');
    purchaseContext(connection.account||game.account.data,product,options);
    const payment=unwrap(await c.sdk.iap.showPayPanel(product.payId,{grantBy:'room'}));
    if(!payment.success)return {cancelled:true};
    if(typeof payment.orderId!=='string'||!payment.orderId||payment.orderId.length>512)throw Error('INVALID_ORDER');
    const record={orderId:payment.orderId,payId:product.payId,grantBy:payment.grantBy||'client',options:typeof options.eggId==='string'?{eggId:options.eggId}:{}};
    paidInMemory=record;await store(record);
    return deliver(record);
  });
  c.recover=({silent=false}={})=>c.exclusive(async()=>{
    const record=await saved();
    if(record?.orderId){await store(record);await deliver(record);return {recovered:1,unknown:0};}
    // Pending ids do not carry grantBy. Never forward an unidentified legacy
    // client-granted order to the Room or locally claim a Room-granted order.
    const pending=unwrap(await c.sdk.iap.getPendingOrderIds());
    if(pending.orderIds?.length){if(!silent)c.onMessage('UNKNOWN_PENDING_ORDER');return {recovered:0,unknown:pending.orderIds.length,unresolved:true};}
    return {recovered:0,unknown:0};
  },{silent});
  // Resume a known paid receipt once after a usable baseline. This does not
  // query the host's pending list on entry and never creates a purchase.
  let recoveryScheduled=false;
  const schedule=()=>{
    if(recoveryScheduled||!connection.session.ready)return;
    recoveryScheduled=true;
    const timer=setTimeout(()=>{
      if(c.busy){recoveryScheduled=false;return;}
      void c.exclusive(async()=>{
        const record=await saved();if(!record?.orderId)return {recovered:0};
        await store(record);await deliver(record);return {recovered:1};
      },{silent:true});
    },1500);
    timer.unref?.();
  };
  connection.observe(type=>{if(type==='account'||type==='status')schedule();});schedule();
}

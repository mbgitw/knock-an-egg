import {productOf} from './catalog.js';
import {restoreCommerce,purchaseContext,deliveryContext,makePaidEggs,grant} from './state.js';
import {orderKey} from './cloud-save.js';
const unwrap=r=>{if(!r?.ok)throw Error(r?.error?.code||'HOST_UNAVAILABLE');return r.data;};
export class Commerce {
  constructor(account,{sdk=globalThis.Builda,now=()=>Date.now(),random=Math.random,onChange=()=>{},onBusy=()=>{},onMessage=()=>{}}={}){
    Object.assign(this,{account,sdk,now,random,onChange,onBusy,onMessage});account.data.commerce=restoreCommerce(account.data.commerce);this.busy=false;account.commerce=this;
  }
  get available(){return !!this.sdk?.iap&&!!this.account.storage?.cloud;}
  async checkpoint(){
    if(!this.account.save())throw Error('SAVE_FAILED');
    await this.account.storage.flush();
  }
  async exclusive(action){
    if(this.busy)return {ok:false,error:'PAY_BUSY'};
    this.busy=true;this.onBusy(true);
    try{
      if(!this.available)throw Error('HOST_UNAVAILABLE');
      await this.account.storage.retry();
      const result=await action();this.onChange();return {ok:true,...result};
    }catch(e){this.onMessage(e.message);return {ok:false,error:e.message};}
    finally{this.busy=false;this.onBusy(false);}
  }
  async buy(id,options={}){return this.exclusive(async()=>{
    const p=productOf(id);if(!p)throw Error('UNKNOWN_PRODUCT');
    const s=this.account.data.commerce;
    for(const receipt of Object.values(s.orders))if(!receipt.claimed)await this.deliver(receipt);
    const context=purchaseContext(this.account.data,p,options,this.now());
    const trial=JSON.parse(JSON.stringify(this.account.data)),probe={payId:p.payId,context,applied:false};
    if(p.kind==='egg')probe.eggs=makePaidEggs(p.amount,'pay_order_capacity_check',()=>.5);
    trial.commerce.orders.preflight=probe;grant(trial,probe,this.now());
    this.account.storage.assertCapacity?.(JSON.stringify(trial));
    // Save ordinary progress only. No preparation, nonce, or purchase context is persisted.
    await this.checkpoint();
    const payment=unwrap(await this.sdk.iap.showPayPanel(p.payId,{grantBy:'client'}));
    if(!payment.success)return {cancelled:true};
    if(typeof payment.orderId!=='string'||!payment.orderId)throw Error('INVALID_ORDER');
    const key=await orderKey(payment.orderId);
    let receipt=s.orders[key];
    if(receipt&&(receipt.orderId!==payment.orderId||receipt.payId!==p.payId))throw Error('ORDER_MISMATCH');
    if(!receipt){
      receipt={orderId:payment.orderId,payId:p.payId,grantBy:payment.grantBy||'client',context:deliveryContext(this.account.data,p,options,this.now()),applied:false};
      if(p.kind==='egg')receipt.eggs=makePaidEggs(p.amount,key,this.random);
      s.orders[key]=receipt;
    }
    await this.checkpoint();
    await this.deliver(receipt);return {delivered:true};
  });}
  async deliver(receipt){
    // A room-granted or unknown order must never be locally granted/claimed.
    if(receipt.grantBy!=='client')throw Error('ORDER_REQUIRES_ROOM');
    grant(this.account.data,receipt,this.now());
    await this.checkpoint(); // Inventory and idempotency marker in the SAME committed snapshot.
    if(!receipt.claimed){
      const result=unwrap(await this.sdk.iap.claim(receipt.orderId));
      if(result?.success===false)throw Error('CLAIM_FAILED');
      receipt.claimed=true;delete receipt.eggs;await this.checkpoint();
    }
  }
  async recover(){return this.exclusive(async()=>{
    const pending=unwrap(await this.sdk.iap.getPendingOrderIds());let recovered=0,unknown=0;
    const orders=this.account.data.commerce.orders;
    for(const id of pending.orderIds||[]){const r=orders[await orderKey(id)];if(!r||r.orderId!==id){unknown++;continue;}await this.deliver(r);recovered++;}
    if(unknown)this.onMessage('UNKNOWN_PENDING_ORDER');
    return {recovered,unknown};
  });}
}

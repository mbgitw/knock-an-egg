import {productOf} from './rules/gameplay/commerce/catalog.ts';
import {purchaseContext,deliveryContext,makePaidEggs,grant,restoreCommerce} from './rules/gameplay/commerce/state.ts';
import {restoreState} from './rules/treadmill-state.ts';
import {relocateAccount} from './economy.ts';
import {OP} from './rules/online/protocol.ts';
import type {Player} from './world.ts';
const SAVE='pasture_account_v1';
const copy=(v:any)=>JSON.parse(JSON.stringify(v));
// Only actual fulfillment serializes account writes. A payment panel creates no gate.
export const paymentPending=(p:Player)=>!!((p as any).paymentBusy||(p as any).freeGiftBusy||p.account.commerce?.delivery);
export const paymentBlocksAction=(p:Player,_action:string)=>paymentPending(p);
export function payment(room:any,p:Player,request:any){
  if(!p.loaded||!p.connected||typeof request?.key!=='string'||request.key.length>80)return;
  const reply=(data:any)=>room.sendToUserJson(p.id,String(OP.PAYMENT_RESULT),{key:request.key,...data});
  if((p as any).paymentBusy||(p as any).freeGiftBusy){reply({ok:false,reason:'PAY_BUSY'});return;}
  const now=Number(room.unixTimeMillis());
  try{
    // Legacy messages are accepted without retaining any preparation.
    if(request.action==='prepare'){
      purchaseContext(p.account,productOf(request.payId),request.options||{},now);
      reply({ok:true});return;
    }
    if(request.action==='cancel'){reply({ok:true});return;}
    if(request.action!=='deliver'||typeof request.orderId!=='string'||!request.orderId||request.orderId.length>512)throw Error('INVALID_ORDER');
    const orderId=request.orderId;
    if(p.account.commerce.delivery&&p.account.commerce.delivery!==orderId)throw Error('RECOVER_PENDING_PURCHASE');
    const known=Object.values(p.account.commerce.orders||{}).find((r:any)=>r.orderId===orderId) as any;
    if(known?.grantBy==='room'&&known?.completed){reply({ok:true,delivered:true});return;}
    // Earlier ordinary writes must not overwrite fulfilled goods.
    if(room.state.saving?.[p.id]||room.state.pendingSaves?.[p.id]){reply({ok:false,reason:'SAVE_PENDING'});return;}
    (p as any).paymentBusy=true;
    room.doOrder(orderId,(result:any)=>{
      if(result.status==='already_delivered'){
        room.cloudLoadSnapshot(p.id,(snapshot:any)=>{
          if(snapshot.status!=='ready'){(p as any).paymentBusy=false;reply({ok:false,reason:'SAVE_LOAD_FAILED'});return;}
          try{
            const value=snapshot.entries.find((e:any)=>e.key===SAVE&&e.live)?.value;
            if(value?.kind!=='string')throw Error('SAVE_LOAD_FAILED');
            const saved=JSON.parse(value.value);
            p.account=restoreState(saved.account,Number(room.unixTimeMillis()));
            p.account.baseId=saved.account.baseId;relocateAccount(p);
            p.revision=Math.max(p.revision,saved.revision||0);p.receipts={...saved.receipts,...p.receipts};
            p.account.commerce.delivery=null;
            const receipt=Object.values(p.account.commerce.orders).find((r:any)=>r.orderId===orderId) as any;
            if(receipt){receipt.completed=true;delete receipt.eggs;}
            (p as any).paymentBusy=false;p.dirty=true;room.save(p);room.account(p);room.pasture(p);room.profiles();reply({ok:true,delivered:true});
          }catch(e:any){(p as any).paymentBusy=false;reply({ok:false,reason:e.message});}
        });return;
      }
      if(result.status!=='allowed'){(p as any).paymentBusy=false;reply({ok:false,reason:result.status});return;}
      try{
        const product=productOf(result.order.payId);if(!product)throw Error('UNKNOWN_PRODUCT');
        const account=copy(p.account);account.commerce=restoreCommerce(account.commerce);
        let receipt=Object.values(account.commerce.orders).find((r:any)=>r.orderId===orderId) as any;
        if(receipt&&receipt.payId!==product.payId)throw Error('ORDER_MISMATCH');
        if(!receipt){
          receipt={orderId,payId:product.payId,grantBy:'room',context:deliveryContext(account,product,request.options||{},Number(room.unixTimeMillis())),applied:false};
          if(product.kind==='egg')receipt.eggs=makePaidEggs(product.amount,`pay_order_${room.state.namespace}-${p.slot}-${room.state.elapsed}`,()=>room.random());
          account.commerce.orders[`room_${orderId}`]=receipt;
        }
        grant(account,receipt,Number(room.unixTimeMillis()));account.commerce.delivery=orderId;
        room.fulfill([{roleId:p.id,key:SAVE,operation:'set',value:{kind:'string',value:JSON.stringify({account,revision:p.revision,receipts:p.receipts})}}]);
        p.account=account;delete room.state.pendingSaves[p.id];p.dirty=false;(p as any).paymentBusy=false;
        reply({ok:true,pending:true});
      }catch(e:any){
        (p as any).paymentBusy=false;reply({ok:false,reason:e.code||e.message});
        // Never let the pinned SDK finish an empty/failed allowed callback.
        throw e;
      }
    });
  }catch(e:any){(p as any).paymentBusy=false;reply({ok:false,reason:e.code||e.message});}
}

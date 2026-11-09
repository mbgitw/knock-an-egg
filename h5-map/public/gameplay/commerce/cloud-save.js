// Platform byte saves use Godot's STRING Variant (var_to_bytes), not a custom binary format.
export function encode(value){
  const bytes=new TextEncoder().encode(JSON.stringify(value)),out=new Uint8Array(8+Math.ceil(bytes.length/4)*4),view=new DataView(out.buffer);
  view.setUint32(0,4,true);view.setUint32(4,bytes.length,true);out.set(bytes,8);return out;
}
export function decode(bytes){
  if(bytes==null)return null;
  const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),v=new DataView(b.buffer,b.byteOffset,b.byteLength);
  if(b.length<8||v.getUint32(0,true)!==4||v.getUint32(4,true)>b.length-8)throw Error('INVALID_CLOUD_SAVE');
  return JSON.parse(new TextDecoder().decode(b.subarray(8,8+v.getUint32(4,true))));
}
export const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),n=>n.toString(16).padStart(2,'0')).join('');
export const orderKey=async id=>'pay_order_'+(await digest(id)).slice(0,48);
const HEAD='egg_account_head',key=(bank,i)=>`egg_account_${bank}_${i}`,CHUNK=6000,MAX=30;
const unwrap=r=>{if(!r?.ok)throw Object.assign(Error(r?.error?.code||'HOST_UNAVAILABLE'),{code:r?.error?.code});return r.data;};
export class CloudSave {
  static async open(sdk){const store=new CloudSave(sdk);await store.load();return store;}
  constructor(sdk){this.sdk=sdk;this.text=null;this.bank='b';this.dirty=false;this.cloud=true;this.queue=Promise.resolve();this.error=null;}
  async load(){
    const head=decode(unwrap(await this.sdk.privateKV.get(HEAD)));
    if(!head)return;
    if(!['a','b'].includes(head.bank)||!Number.isInteger(head.count)||head.count<1||head.count>MAX)throw Error('INVALID_CLOUD_SAVE');
    const keys=Array.from({length:head.count},(_,i)=>key(head.bank,i));
    const {entries}=unwrap(await this.sdk.privateKV.getMany(keys));
    const chunks=keys.map(k=>decode(entries[k]));if(chunks.some(v=>typeof v!=='string'))throw Error('INCOMPLETE_CLOUD_SAVE');
    const text=chunks.join('');if(await digest(text)!==head.hash)throw Error('INCOMPLETE_CLOUD_SAVE');
    JSON.parse(text);this.text=text;this.bank=head.bank;
  }
  getItem(){return this.text;}
  assertCapacity(text){if(text.length+4096>CHUNK*MAX)throw Error('SAVE_TOO_LARGE');}
  setItem(_,text){
    if(this.error)throw this.error;
    if(text===this.text)return;
    this.text=text;this.dirty=true;
    // Coalesce existing frequent gameplay saves. Payment checkpoints call flush explicitly.
    if(!this.timer)this.timer=setTimeout(()=>{this.timer=null;void this.flush().catch(()=>{});},15000);
  }
  async flush(){
    clearTimeout(this.timer);this.timer=null;
    const work=this.queue.catch(()=>{}).then(async()=>{
      if(!this.dirty)return;
      const text=this.text,bank=this.bank==='a'?'b':'a',chunks=[];
      for(let i=0;i<text.length;i+=CHUNK)chunks.push(text.slice(i,i+CHUNK));
      if(chunks.length>MAX)throw Error('SAVE_TOO_LARGE');
      const entries=Object.fromEntries(chunks.map((part,i)=>[key(bank,i),encode(part)]));
      if(Object.values(entries).some(v=>v.byteLength>32768))throw Error('SAVE_TOO_LARGE');
      unwrap(await this.sdk.privateKV.setMany(entries));
      // setMany is best-effort, NOT atomic. Verify inactive bank before committing its head.
      const read=unwrap(await this.sdk.privateKV.getMany(Object.keys(entries))).entries;
      if(chunks.some((part,i)=>decode(read[key(bank,i)])!==part))throw Error('INCOMPLETE_CLOUD_SAVE');
      unwrap(await this.sdk.privateKV.set(HEAD,encode({bank,count:chunks.length,hash:await digest(text)})));
      this.bank=bank;this.error=null;if(this.text===text)this.dirty=false;
    });
    this.queue=work;
    try{await work;}catch(e){this.error=e;throw e;}
  }
  // Explicit user recovery only; never a background retry loop.
  async retry(){
    if(this.error){
      // A timed-out head write may have committed. Never overwrite that active bank.
      const head=decode(unwrap(await this.sdk.privateKV.get(HEAD)));
      if(head){if(!['a','b'].includes(head.bank))throw Error('INVALID_CLOUD_SAVE');this.bank=head.bank;}
    }
    this.error=null;await this.flush();
  }
}

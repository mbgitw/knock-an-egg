// A narrow diagnostic endpoint. All identity comes from the authenticated Room client.
const kinds=new Set(['ready','first_frame','heartbeat','frame_stall','frame_resumed','webgl_lost','webgl_restored','script_error','promise_error','module_error','startup_error','connect_error','frame_error']);
const stages=new Set(['boot','environment','map-data','map-model','world','player','connecting','treadmills','plots','pickaxes','weapons','guards','ready']);
const phases=new Set(['boot','gate','online','begin','player','gameplay','render']);
const notable=new Set(['ready','first_frame','frame_stall','webgl_lost','webgl_restored','script_error','promise_error','module_error','startup_error','connect_error','frame_error']);
const integer=(value:any,max:number)=>Number.isInteger(value)&&value>=0&&value<=max?value:0;
const short=(value:any,max:number)=>typeof value==='string'?value.replace(/https?:\/\/\S+/gi,'<url>').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'<email>').replace(/\b(?:token|password|secret|auth|key|user|role|name|id)\s*[:=]\s*\S+/gi,'<redacted>').replace(/(['"`])[^'"`\r\n]{0,120}\1/g,'<value>').replace(/\b[0-9a-f]{16,}\b/gi,'<id>').replace(/\b\d{5,}\b/g,'<n>').replace(/[\r\n\t\x00-\x1f]/g,' ').slice(0,max):'';
export function logRuntimeHealth(room:any,p:any,data:any){
  try{
    if(!data||typeof data!=='object'||!kinds.has(data.kind))return;
    const now=Number(room.unixTimeMillis()),stats=room.networkStats(p);
    const fields:any={player:p.id,kind:data.kind,run:/^[0-9a-f]{8}$/.test(data.run)?data.run:'',stage:stages.has(data.stage)?data.stage:'unknown',phase:phases.has(data.phase)?data.phase:'unknown',ms:integer(data.ms,3600000),width:integer(data.width,10000),height:integer(data.height,10000),dpr:integer(Math.round(data.dpr*100),400)/100};
    if(Number.isFinite(now)&&Number.isFinite(data.at)&&data.at<=now+60000&&data.at>=now-86400000)fields.ageMs=integer(Math.round(now-data.at),86400000);
    if(data.kind==='heartbeat'){fields.textures=integer(data.textures,100000);fields.geometries=integer(data.geometries,100000);fields.programs=integer(data.programs,100000);fields.glError=integer(data.glError,65535);fields.contextLost=data.contextLost===true;}
    if(data.kind==='frame_stall')fields.lagMs=integer(data.lagMs,600000);
    if(data.kind.endsWith('_error')){fields.name=short(data.name,30);fields.message=short(data.message,140);fields.file=short(data.file,50).replace(/[/\\]/g,'');fields.line=integer(data.line,100000);fields.column=integer(data.column,100000);}
    stats.runtime={kind:fields.kind,stage:fields.stage,phase:fields.phase,run:fields.run,at:now,firstFrame:fields.kind==='first_frame'||stats.runtime?.firstFrame||false,width:fields.width,height:fields.height,dpr:fields.dpr,glError:fields.glError||0,contextLost:fields.contextLost||false};
    if(!notable.has(data.kind)&&!(data.kind==='heartbeat'&&(fields.glError||fields.contextLost)))return;
    const state=room.state as any;
    const budget=(owner:any,key:string,limit:number,span:number)=>{const b=owner[key]??={until:now+span,count:0};if(now>=b.until){b.until=now+span;b.count=0;}return b.count++<limit;};
    if(!budget(p,'runtimeLogBudget',12,60000)||!budget(state,'runtimeLogBudget',35,60000)||!budget(state,'runtimeLogBurst',4,1000))return;
    room.log(data.kind.endsWith('_error')||data.kind==='webgl_lost'||data.kind==='frame_stall'||fields.glError||fields.contextLost?'warn':'info',`client_runtime ${JSON.stringify(fields)}`);
  }catch{/* Diagnostics cannot affect the Room. */}
}

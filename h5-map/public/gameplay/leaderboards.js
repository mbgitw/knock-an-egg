import {t,onLanguageChange} from '../i18n.js';
import * as THREE from 'three';
import {BOARDS,encodeScore,decodeScore,formatRank,cleanEntries} from './leaderboard-data.js';

const ROWS=6,W=660,H=870;
export class Leaderboards{
  constructor(game,parts,sdk=window.Builda){
    this.game=game;this.sdk=sdk;this.images=new Map();this.boards=[];this.nextSubmit=0;this.nextRead=0;this.nextCheck=0;this.busy=false;this.alive=true;
    this.ray=new THREE.Raycaster();this.abort=new AbortController();this.lastScores=new Map();
    for(const def of BOARDS){
      const part=parts.find(p=>p.path===`/Workspace/Leaderboards/${def.model}/Board`),top=parts.find(p=>p.path===`/Workspace/Leaderboards/${def.model}/TopBar`);if(!part||!top)continue;
      const board={...def,page:0,entries:[],self:null,status:game.offlinePreview?'Offline preview — rankings disabled':'加载中',part};
      board.header=this.surface(top,18,2.4,1080,144);board.body=this.surface(part,10.8,14.4,W,H);
      this.boards.push(board);this.draw(board);
    }
    this.offLanguage=onLanguageChange(()=>{for(const b of this.boards)this.draw(b);});
    const opts={capture:true,signal:this.abort.signal};
    window.addEventListener('pointerdown',e=>{
      if(e.target!==game.canvas||e.button!==0||this.blocked())return;
      const hit=this.hit(e);if(!hit)return;
      this.down={id:e.pointerId,x:e.clientX,y:e.clientY,hit};game.canvas.dataset.worldUiPointer=String(e.pointerId);e.stopImmediatePropagation();
    },opts);
    window.addEventListener('pointerup',e=>{
      const d=this.down;this.down=null;delete game.canvas.dataset.worldUiPointer;if(!d||d.id!==e.pointerId)return;
      e.stopImmediatePropagation();if(Math.hypot(d.x-e.clientX,d.y-e.clientY)>8||this.blocked())return;
      const h=this.hit(e);if(!h||h.board!==d.hit.board)return;
      const b=h.board,pages=Math.max(1,Math.ceil(b.entries.length/ROWS));b.page=(b.page+(h.uv.x<.5?-1:1)+pages)%pages;this.draw(b);
    },opts);
    window.addEventListener('pointercancel',()=>{this.down=null;delete game.canvas.dataset.worldUiPointer;},opts);
  }
  blocked(){const g=this.game;return g.player.inputLocked||g.backpack?.opened||g.inventoryUI?.opened||g.shopUI?.opened||g.settingsUI?.opened;}
  surface(part,width,height,cw,ch){
    const canvas=document.createElement('canvas');canvas.width=cw;canvas.height=ch;
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false});
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,height),material);
    mesh.rotation.y=Math.PI/2;mesh.position.set(part.matrix[3]+(part.path.endsWith('/TopBar')?.77:.27),part.matrix[7],part.matrix[11]);mesh.updateMatrixWorld();mesh.matrixAutoUpdate=false;this.game.scene.add(mesh);
    return {canvas,ctx:canvas.getContext('2d'),texture,mesh};
  }
  image(url){
    if(!url)return null;
    let key;try{key=new URL(url,location.href);if(!['https:','http:'].includes(key.protocol))return null;}catch{return null;}
    if(!this.images.has(key.href)){
      if(this.images.size>=256)return null;
      const img=new Image();img.crossOrigin='anonymous';img.referrerPolicy='no-referrer';this.images.set(key.href,img);
      img.onload=()=>{if(this.alive)for(const b of this.boards)this.draw(b);};img.onerror=()=>{};img.src=key.href;
    }
    const img=this.images.get(key.href);return img.complete&&img.naturalWidth?img:null;
  }
  text(c,value,x,y,size,color,align='left',maxWidth){
    value=t(value);
    c.font=`900 ${size}px "Arial", "Microsoft YaHei", sans-serif`;c.textAlign=align;c.textBaseline='middle';c.lineJoin='round';c.lineWidth=Math.max(3,size*.12);c.strokeStyle='#000';c.fillStyle=color;
    c.strokeText(value,x,y,maxWidth);c.fillText(value,x,y,maxWidth);
  }
  icon(c,b,x,y,size){
    const img=this.image(b.icon);if(img)c.drawImage(img,x,y,size,size);
    else if(b.key==='playtime'){c.fillStyle='#fff';c.strokeStyle='#fc467b';c.lineWidth=size*.1;c.beginPath();c.arc(x+size/2,y+size/2,size*.42,0,Math.PI*2);c.fill();c.stroke();c.strokeStyle='#111';c.lineWidth=size*.07;c.beginPath();c.moveTo(x+size/2,y+size*.22);c.lineTo(x+size/2,y+size/2);c.lineTo(x+size*.68,y+size*.61);c.stroke();}
  }
  draw(b){
    const h=b.header.ctx;h.clearRect(0,0,1080,144);h.fillStyle=b.key==='income'?'#08762a':b.key==='power'?'#0065b4':'#a91440';h.strokeStyle='#10121b';h.lineWidth=7;h.beginPath();h.moveTo(5,5);h.lineTo(1075,5);h.lineTo(1035,139);h.lineTo(45,139);h.closePath();h.fill();h.stroke();this.icon(h,b,12,13,118);this.icon(h,b,950,13,118);this.text(h,b.title,540,72,91,b.color,'center',810);b.header.texture.needsUpdate=true;
    const c=b.body.ctx;c.clearRect(0,0,W,H);const rows=b.entries.slice(b.page*ROWS,(b.page+1)*ROWS);
    if(!rows.length)this.text(c,b.status||'暂无排名',W/2,H/2,38,'#fff','center',W-30);
    for(let i=0;i<rows.length;i++){
      const e=rows[i],y=22+i*122,rankColor=['#ffc800','#cdd6e2','#cd762d'][e.rank-1]||'#fff';
      c.fillStyle='rgba(113,130,160,.92)';c.fillRect(7,y,W-14,116);c.strokeStyle='#10121b';c.lineWidth=3;c.strokeRect(7,y,W-14,116);
      const img=this.image(e.player.avatar);if(img)c.drawImage(img,12,y+5,100,106);else{c.fillStyle='#60728e';c.beginPath();c.arc(62,y+37,21,0,Math.PI*2);c.fill();c.fillRect(26,y+64,72,40);}
      this.text(c,`#${e.rank}`,15,y+95,33,rankColor);
      this.icon(c,b,144,y+10,42);this.text(c,formatRank(decodeScore(e.score,b.key),b.key),W-18,y+33,38,b.color,'right',W-210);
      this.text(c,'@'+String(e.player.name||e.player.id).slice(0,28),W-18,y+86,33,rankColor,'right',W-144);
    }
    c.fillStyle='#26364b';c.fillRect(7,760,W-14,100);
    const pages=Math.max(1,Math.ceil(b.entries.length/ROWS));
    this.text(c,`‹     ${b.page+1} / ${pages}     ›`,W/2,790,33,'#fff','center');
    this.text(c,b.self?`我的排名 #${b.self.rank}`:b.status==='加载失败'?'加载失败，稍后重试':'我的排名：未上榜',W/2,836,25,'#fff','center',W-20);
    b.body.texture.needsUpdate=true;
  }
  hit(e){
    const rect=this.game.canvas.getBoundingClientRect();this.ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),this.game.camera);
    const hit=this.ray.intersectObjects(this.boards.map(b=>b.body.mesh))[0];if(!hit||hit.distance>90||hit.uv.y>.13)return null;
    const wall=this.game.player.world.rayIntersect(this.ray.ray);if(wall&&wall.distance<hit.distance-.1)return null;
    return {...hit,board:this.boards.find(b=>b.body.mesh===hit.object)};
  }
  async refresh(submit,read){
    if(this.busy||!this.sdk?.rank)return;this.busy=true;
    try{
      const a=this.game.account.data;
      if(submit&&this.game.online?.session.ready){
        const values={income:a.rankStats?.income,power:a.power,playtime:a.rankStats?.playtime};
        await Promise.all(this.boards.map(async b=>{const score=encodeScore(values[b.key],b.key);if(score===null||this.lastScores.get(b.id)===score)return;try{const r=await this.sdk.rank.submitScore(b.id,score,{timeoutMs:5000});if(r.ok)this.lastScores.set(b.id,score);}catch{}}));
      }
      if(read)await Promise.all(this.boards.map(async b=>{
        try{const r=await this.sdk.rank.getRankList(b.id,{limit:100,timeoutMs:5000});if(!r.ok)throw Error(r.error?.code);b.entries=cleanEntries(r.data.list);b.self=Number.isSafeInteger(r.data.self?.rank)&&r.data.self.rank>0?r.data.self:null;b.status='暂无排名';}
        catch(e){b.status=e.message==='RANK_NOT_FOUND'?'排行榜待发布':'加载失败';}
        b.page=Math.min(b.page,Math.max(0,Math.ceil(b.entries.length/ROWS)-1));this.draw(b);
      }));
    }finally{this.busy=false;}
  }
  update(){
    const now=performance.now();if(now<this.nextCheck||this.busy)return;this.nextCheck=now+1000;
    if(document.hidden||window.gameHostState?.paused||!this.game.online?.session.ready)return;
    const nearby=this.boards.some(b=>b.body.mesh.position.distanceTo(this.game.player.motor.position)<160);
    const submit=now>=this.nextSubmit,read=nearby&&now>=this.nextRead;if(submit)this.nextSubmit=now+30000;if(read)this.nextRead=now+300000;
    if(submit||read)void this.refresh(submit,read);
  }
  dispose(){this.offLanguage?.();this.alive=false;this.abort.abort();for(const b of this.boards)for(const s of [b.header,b.body]){s.mesh.removeFromParent();s.mesh.geometry.dispose();s.mesh.material.dispose();s.texture.dispose();}this.images.clear();}
}

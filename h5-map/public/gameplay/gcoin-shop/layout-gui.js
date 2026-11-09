import {onLanguageChange} from '../../i18n.js';
// Layout adapter for the archived Shop GuiObjects. Units are source canvas pixels.
const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const child=(node,type)=>node.children.find(c=>c.className===type)?.props;
export const guiChildren=node=>node.children.filter(c=>!c.className.startsWith('UI')&&c.props.Visible!=='false');
export const rgb=(c={R:1,G:1,B:1},a=1)=>`rgba(${Math.round(num(c.R)*255)},${Math.round(num(c.G)*255)},${Math.round(num(c.B)*255)},${a})`;
export function dimensions(node,pw,ph){
  const p=node.props,s=p.Size||{};let w=pw*num(s.XS)+num(s.XO),h=ph*num(s.YS)+num(s.YO);
  const ar=child(node,'UIAspectRatioConstraint');
  if(ar){const r=num(ar.AspectRatio,1);if(num(ar.AspectType)===1){if(num(ar.DominantAxis)===0)h=w/r;else w=h*r;}else {w=Math.min(w,h*r);h=w/r;}}
  return {w,h};
}
export function childRects(node,w,h){
  const children=guiChildren(node),layout=child(node,'UIListLayout');
  if(!layout)return children.map(n=>{const {w:cw,h:ch}=dimensions(n,w,h),p=n.props,a=p.AnchorPoint||{},pos=p.Position||{};return {node:n,x:w*num(pos.XS)+num(pos.XO)-cw*num(a.X),y:h*num(pos.YS)+num(pos.YO)-ch*num(a.Y),w:cw,h:ch};});
  const vertical=num(layout.FillDirection)===1,main=vertical?h:w,cross=vertical?w:h,gap=num(layout.Padding?.S)*main+num(layout.Padding?.O);
  const rows=[[]];let used=0;
  for(const n of [...children].sort((a,b)=>num(a.props.LayoutOrder)-num(b.props.LayoutOrder))){
    const d=dimensions(n,w,h),length=vertical?d.h:d.w;
    if(layout.Wraps==='true'&&rows.at(-1).length&&used+gap+length>main+.01){rows.push([]);used=0;}
    rows.at(-1).push({node:n,...d});used+=(used?gap:0)+length;
  }
  let crossOffset=0;const result=[];
  for(const row of rows){
    const length=row.reduce((s,r)=>s+(vertical?r.h:r.w),0)+gap*(row.length-1),breadth=Math.max(...row.map(r=>vertical?r.w:r.h));
    // Vertical Center=0, Top=1, Bottom=2.
    const mainAlign=num(vertical?layout.VerticalAlignment:layout.HorizontalAlignment),crossAlign=num(vertical?layout.HorizontalAlignment:layout.VerticalAlignment);
    let offset=mainAlign===0?(main-length)/2:mainAlign===2?main-length:0;
    for(const r of row){const available=layout.Wraps==='true'?breadth:cross,extent=vertical?r.w:r.h,c=crossOffset+(crossAlign===0?(available-extent)/2:crossAlign===2?available-extent:0);result.push({...r,x:vertical?c:offset,y:vertical?offset:c});offset+=(vertical?r.h:r.w)+gap;}
    crossOffset+=breadth+gap;
  }
  return result;
}
export function gradient(props,base={R:1,G:1,B:1}){
  const a=String(props.Color||'').trim().split(/\s+/).map(Number),t=String(props.Transparency||'0 0 0 1 0 0').trim().split(/\s+/).map(Number),stops=[];
  const alpha=x=>{for(let i=3;i<t.length;i+=3)if(x<=t[i])return 1-(t[i-2]+(t[i+1]-t[i-2])*(x-t[i-3])/Math.max(.0001,t[i]-t[i-3]));return 1;};
  for(let i=0;i<a.length;i+=5)stops.push(`${rgb({R:a[i+1]*num(base.R,1),G:a[i+2]*num(base.G,1),B:a[i+3]*num(base.B,1)},alpha(a[i]))} ${a[i]*100}%`);
  return `linear-gradient(${90+num(props.Rotation)}deg,${stops.join(',')})`;
}
function richText(text){
  const fragment=document.createDocumentFragment(),stack=[fragment];
  for(const token of String(text).split(/(<[^>]+>)/g)){
    const color=token.match(/^<font\s+color=["'](#[\da-f]{6})["']\s*>$/i);
    if(color){const span=document.createElement('span');span.style.color=color[1];stack.at(-1).append(span);stack.push(span);}
    else if(/^<\/font>$/.test(token)){if(stack.length>1)stack.pop();}
    else if(/^<br\s*\/?\s*>$/.test(token))stack.at(-1).append(document.createElement('br'));
    else if(!token.startsWith('<'))stack.at(-1).append(document.createTextNode(token));
  }
  return fragment;
}
export class SourceGui {
  constructor(root,assets,{plainText=false}={}){this.plainText=plainText;this.source=root;this.assets=assets;this.nodes=[];this.texts=[];this.byPath=new Map();this.context=document.createElement('canvas').getContext('2d');onLanguageChange(()=>queueMicrotask(()=>this.fitAll()));}
  create(node,rect,path=''){
    const p=node.props;path+='/'+p.Name;
    const button=/Button$/.test(node.className),el=document.createElement(button?'button':'div');el.className='source-gui';el.dataset.sourceName=p.Name;el.dataset.sourcePath=path;
    const {x,y,w,h}=rect;Object.assign(el.style,{left:`${x}px`,top:`${y}px`,width:`${w}px`,height:`${h}px`,zIndex:String(num(p.ZIndex)),backgroundColor:rgb(p.BackgroundColor3,1-num(p.BackgroundTransparency,1)),transform:num(p.Rotation)?`rotate(${p.Rotation}deg)`:'',overflow:p.ClipsDescendants==='true'?'hidden':'visible'});
    if(button){el.type='button';el.setAttribute('aria-label',p.Name);el.style.pointerEvents='auto';}
    const grad=child(node,'UIGradient'),corner=child(node,'UICorner');
    if(corner)el.style.borderRadius=`${num(corner.CornerRadius?.S)*Math.min(w,h)+num(corner.CornerRadius?.O)}px`;
    const strokes=node.children.filter(c=>c.className==='UIStroke'&&c.props.Enabled!=='false');
    const isText=/^Text/.test(node.className)&&!!p.Text;
    const shadows=[];
    for(const {props:s} of strokes){
      const thickness=num(s.Thickness,1),color=rgb(s.Color,1-num(s.Transparency));
      if(isText&&num(s.ApplyStrokeMode)===0)continue;
      shadows.push(`${num(s.BorderStrokePosition)===2?'inset ':''}0 0 0 ${thickness}px ${color}`);
    }
    for(const {props:s} of node.children.filter(c=>c.className==='UIShadow'))shadows.push(`0 0 ${num(s.BlurRadius?.S)*Math.min(w,h)+num(s.BlurRadius?.O)}px ${rgb(s.Color,1-num(s.Transparency))}`);
    if(shadows.length&&!(isText&&this.plainText))el.style.boxShadow=shadows.join(',');
    if(grad&&!isText&&num(p.BackgroundTransparency)<1)el.style.backgroundImage=gradient(grad,p.BackgroundColor3);
    const record={node,el,rect,path};this.nodes.push(record);this.byPath.set(path,record);
    if(isText){
      const span=document.createElement('span');span.className='source-text';span.append(richText(p.Text));span.style.color=rgb(p.TextColor3,1-num(p.TextTransparency));
      Object.assign(span.style,{fontFamily:p.FontFace?.Family?.url?.includes('Merriweather')?'ShopMerriweather':p.FontFace?.Family?.url?.includes('Rubik')?'ShopRubik':'ShopGotham',fontWeight:p.FontFace?.Weight||'800',textAlign:['left','right','center'][num(p.TextXAlignment,2)],whiteSpace:p.TextWrapped==='true'?'normal':'nowrap'});
      el.style.display='flex';el.style.alignItems=['flex-start','center','flex-end'][num(p.TextYAlignment,1)];
      const stroke=strokes.find(c=>num(c.props.ApplyStrokeMode)===0)?.props;
      if(stroke){span.style.webkitTextStroke=`${num(stroke.Thickness,1)}px ${rgb(stroke.Color,1-num(stroke.Transparency))}`;span.style.paintOrder='stroke fill';}
      if(grad&&!this.plainText){span.style.backgroundImage=gradient(grad,p.TextColor3);span.style.backgroundClip='text';span.style.color='transparent';if(stroke){span.style.webkitTextStroke='0';const c=rgb(stroke.Color),t=num(stroke.Thickness,1)/2;span.style.filter=`drop-shadow(${t}px 0 ${c}) drop-shadow(-${t}px 0 ${c}) drop-shadow(0 ${t}px ${c}) drop-shadow(0 -${t}px ${c})`;}}
      if(this.plainText){
        // Shop text uses real black outlines, never offset duplicate lettering.
        span.style.webkitTextStroke='clamp(1.5px, .075em, 4px) #000';span.style.paintOrder='stroke fill';
        if(grad){const stops=String(grad.Color||'').trim().split(/\s+/).map(Number);if(stops.length>=5)span.style.color=rgb({R:stops[1]*num(p.TextColor3?.R,1),G:stops[2]*num(p.TextColor3?.G,1),B:stops[3]*num(p.TextColor3?.B,1)});}
        if(node.children.some(c=>/^Text/.test(c.className)&&c.props.Visible!=='false'&&c.props.Text===p.Text))span.hidden=true;
      }
      el.append(span);record.text=span;this.texts.push(record);
    }
    const id=p.Image?.url?.split('://').at(-1),src=this.assets[id];
    if(src){
      const art=document.createElement('div');art.className='source-image';art.dataset.assetId=id;const url=new URL(src,import.meta.url).href;
      const tile=num(p.ScaleType)===2,fit=num(p.ScaleType)===3?'contain':num(p.ScaleType)===4?'cover':'100% 100%';
      const size=tile?`${w*num(p.TileSize?.XS)+num(p.TileSize?.XO)}px ${h*num(p.TileSize?.YS)+num(p.TileSize?.YO)}px`:fit;
      Object.assign(art.style,{opacity:String(1-num(p.ImageTransparency)),backgroundImage:`url("${url}")`,backgroundSize:size,backgroundRepeat:tile?'repeat':'no-repeat'});
      const col=p.ImageColor3||{R:1,G:1,B:1};
      if(num(col.R)===0&&num(col.G)===0&&num(col.B)===0)art.style.filter='brightness(0)';
      else if(Math.min(num(col.R),num(col.G),num(col.B))<.99){art.style.backgroundColor=rgb(col);art.style.backgroundBlendMode='multiply';art.style.maskImage=`url("${url}")`;art.style.maskSize=size;art.style.maskPosition='center';art.style.maskRepeat=tile?'repeat':'no-repeat';art.style.webkitMaskImage=art.style.maskImage;art.style.webkitMaskSize=size;art.style.webkitMaskPosition='center';art.style.webkitMaskRepeat=tile?'repeat':'no-repeat';}
      el.append(art);record.image=art;el.classList.add('has-source-image');
    }
    if(node.className==='ScrollingFrame'){
      el.classList.add('source-scroll');el.tabIndex=0;el.setAttribute('aria-label','Shop 商品列表');
      const content=document.createElement('div');content.className='source-content';const rects=childRects(node,w,h);content.style.height=`${Math.max(h,...rects.map(r=>r.y+r.h))}px`;el.append(content);this.scroll=el;
      for(const r of rects)content.append(this.create(r.node,r,path));
    }else for(const r of childRects(node,w,h))el.append(this.create(r.node,r,path));
    return el;
  }
  setText(record,text){if(!record?.text)return;record.text.replaceChildren(richText(text));record.override=text;this.fit(record);for(const r of this.texts)if(r.path.startsWith(record.path+'/')&&r.node.props.Text===record.node.props.Text){r.text.replaceChildren(richText(text));r.override=text;this.fit(r);}}
  fit(record){
    const {node,text,rect}=record;if(!text)return;const p=node.props;
    if(p.TextScaled!=='true'){text.style.fontSize=`${p.TextSize||14}px`;return;}
    let low=2,high=Math.max(2,rect.h*1.12);const family=text.style.fontFamily,weight=text.style.fontWeight,words=text.textContent.split(/\s+/);
    for(let n=0;n<10;n++){
      const size=(low+high)/2;this.context.font=`${weight} ${size}px ${family}`;let line='',count=1,max=0;
      for(const word of words){const next=line?line+' '+word:word;if(p.TextWrapped==='true'&&line&&this.context.measureText(next).width>rect.w){max=Math.max(max,this.context.measureText(line).width);line=word;count++;}else line=next;}
      max=Math.max(max,this.context.measureText(line).width);
      if(max<=rect.w&&count*size*1.06<=rect.h)low=size;else high=size;
    }
    text.style.fontSize=`${low}px`;
  }
  fitAll(){for(const record of this.texts)this.fit(record);}
}

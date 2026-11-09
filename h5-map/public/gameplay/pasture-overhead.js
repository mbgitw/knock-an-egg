import {t,currentLanguage} from '../i18n.js';
import {PastureCashLabel} from './pasture-cash-label.js';
import {speciesOf} from './pickaxe-state.js';
import {pastureRate} from './pasture-economy.js';
import {animalVisualScale} from './animal-attributes.js';
import {shopNumber} from './pickaxe-shop.js';

// AnimalOverhead + OverheadVisibilityController: inside this plot's Hitbox,
// max camera distance 150, bottom-aligned 7.5-stud BillboardGui.
export const OVERHEAD_MAX_DISTANCE=150;
export function overheadVisible(insidePlot,cameraPosition,anchor){
  return insidePlot&&cameraPosition.distanceToSquared(anchor)<=OVERHEAD_MAX_DISTANCE**2;
}
export function overheadRows(pet){
  const rows=[{text:'$'+shopNumber(pastureRate(pet))+'/s',color:'#8bff37'},
    {text:speciesOf(pet.name)?.rarity||'',color:'#fff'}];
  if(pet.variant==='Gold'||pet.variant==='Diamond')rows.unshift({text:pet.variant,color:pet.variant==='Gold'?'#ffd43b':'#73e8ff'});
  return rows;
}
export class PastureOverhead extends PastureCashLabel {
  constructor(scene,model,pet){
    super(scene,model);this.canvas.width=this.canvas.height=1024;
    this.sprite.name='AnimalOverhead';this.sprite.center.set(.5,0);this.sprite.renderOrder=9999;
    this.pet=pet;this.rowsKey='';this.refresh();
  }
  refresh(){
    const rows=overheadRows(this.pet),key=currentLanguage()+JSON.stringify(rows);if(key===this.rowsKey)return;this.rowsKey=key;
    const c=this.context;c.clearRect(0,0,1024,1024);c.font='bold 118px sans-serif';c.textAlign='center';c.textBaseline='middle';c.lineJoin='round';c.lineWidth=12;c.strokeStyle='#000';
    rows.forEach((row,i)=>{const y=1024-(rows.length-i-.5)*153.6;c.fillStyle=row.color;c.strokeText(t(row.text),512,y,980);c.fillText(t(row.text),512,y,980);});
    this.texture.needsUpdate=true;
  }
  update(camera,insidePlot){
    this.model.getWorldPosition(this.anchor);camera.getWorldPosition(this.cameraPosition);
    this.sprite.visible=this.model.visible&&overheadVisible(insidePlot,this.cameraPosition,this.anchor);
    this.sprite.position.copy(this.anchor);this.sprite.position.y+=this.headHeight+.25;
    const scale=Math.min(2.2,Math.max(.85,animalVisualScale(this.pet)));this.sprite.scale.set(7.5*scale,7.5*scale,1);this.refresh();
  }
}

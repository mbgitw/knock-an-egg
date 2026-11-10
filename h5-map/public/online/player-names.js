import * as THREE from 'three';
import {PLAYER_HEIGHT} from '../world-physics.js';

export const NAME_SHOW_DISTANCE=45;

// Share the pasture profile cache and projection/occlusion path. Names never
// enter Room state and cannot intercept movement or attack input.
export class PlayerNames{
  constructor(labels){
    this.labels=labels;this.entries=new Map();this.position=new THREE.Vector3();
    const css=document.createElement('style');
    css.textContent='.player-name{position:absolute;left:0;top:0;pointer-events:none;color:#000;font:bold 10px sans-serif;-webkit-text-stroke:0;white-space:nowrap;max-width:110px;overflow:hidden;text-overflow:ellipsis;transform-origin:center}html.compat-text-outline body .player-name{-webkit-text-stroke-width:0!important}';
    labels.layer.append(css);
  }
  update(){
    const {game,connection,profiles,layer}=this.labels;
    const wanted=new Set(connection.players.filter(p=>p.connected&&p.id!==connection.self).map(p=>p.id));
    for(const [id,v] of this.entries)if(!wanted.has(id)){v.el.remove();this.entries.delete(id);}
    for(const id of wanted){
      let v=this.entries.get(id);
      if(!v){const el=document.createElement('div');el.className='player-name';el.hidden=true;layer.append(el);v={el};this.entries.set(id,v);}
      const name=String(profiles.get(id)?.name||'').trim();
      if(v.el.textContent!==name)v.el.textContent=name;
      const root=connection.remote?.actors.get(id)?.root;
      if(!root||!root.visible||!name){if(!v.el.hidden)v.el.hidden=true;continue;}
      const distance=game.player.motor.position.distanceTo(root.position);
      if(distance>NAME_SHOW_DISTANCE){if(!v.el.hidden)v.el.hidden=true;continue;}
      this.position.copy(root.position);this.position.y+=PLAYER_HEIGHT+.9;
      this.labels.place(v.el,this.position,2.2,20,1);
    }
  }
}

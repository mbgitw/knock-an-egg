import {OP} from './protocol.js';

// Presentation traffic must never abort the local movement/camera frame.
export class AppearanceSender {
  constructor(onError=()=>{}){this.pet='';this.swing=0;this.nextAt=0;this.failures=0;this.onError=onError;}
  update(session,pet,swing,now){
    if(!session.ready||!session.active||!session.room||now<this.nextAt||(pet===this.pet&&swing===this.swing))return;
    try{
      session.room.sendReliable(OP.APPEARANCE,new TextEncoder().encode(JSON.stringify({pet,swing:swing!==this.swing})));
      this.pet=pet;this.swing=swing;this.failures=0;this.nextAt=now+150;
    }catch(error){
      this.failures++;this.nextAt=now+Math.min(2000,250*2**Math.min(this.failures-1,3));
      if(this.failures===1)this.onError(error);
    }
  }
}

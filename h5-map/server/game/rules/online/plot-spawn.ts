// @ts-nocheck
// Generated from public/online/plot-spawn.js; run node tools/build-online-rules.mjs.
// Original /Workspace/Plots/Base_3/SpawnPoint, transformed to the assigned pasture.
export function plotSpawn(m){
  const x=-13.8073769,y=1,z=52.4749374;
  return {x:m[0]*x+m[1]*y+m[2]*z+m[3],y:m[4]*x+m[5]*y+m[6]*z+m[7],z:m[8]*x+m[9]*y+m[10]*z+m[11],yaw:-Math.PI/2+Math.atan2(m[2],m[0]),flags:0,sequence:0};
}

function roomRandomRequired():number{throw Error("Room必须注入可恢复随机源");}
function roomTimeRequired():number{throw Error("Room必须注入可信时间");}

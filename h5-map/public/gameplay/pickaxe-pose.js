import * as THREE from 'three';

// Keeping only Grip.Position makes the broad pickaxe face turn sideways.
export function inverseToolGrip(grip){
  return new THREE.Matrix4().set(
    +grip.R00,+grip.R01,+grip.R02,+grip.X,
    +grip.R10,+grip.R11,+grip.R12,+grip.Y,
    +grip.R20,+grip.R21,+grip.R22,+grip.Z,
    0,0,0,1).invert();
}

export function heldPickaxePose(phase,active){
  // Raise for the wind-up, strike forward, then return to the upright hold.
  const p=active?Math.max(0,Math.min(1,phase)):1;
  const smooth=t=>t*t*(3-2*t);
  let pitch=0;
  if(p<.28)pitch=-.85*smooth(p/.28);
  else if(p<.62)pitch=THREE.MathUtils.lerp(-.85,1.25,smooth((p-.28)/.34));
  else if(p<.9)pitch=1.25*(1-smooth((p-.62)/.28));
  const arm=new THREE.Vector3(0,-.12,1).normalize();
  arm.applyAxisAngle(new THREE.Vector3(1,0,0),pitch*.65);
  return {pitch,arm};
}

import * as THREE from 'three';

const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const range = value => String(value || '0 0').trim().split(/\s+/).map(Number);
const randomRange = value => { const r = range(value); return r[0] + Math.random() * ((r[1] ?? r[0]) - r[0]); };
const vector = data => new THREE.Vector3(...'XYZ'.split('').map(k => number(data?.[k])));
const matrix = values => new THREE.Matrix4().set(...values);
const numericCurve = value => {
  const values = range(value), points = [];
  for (let i = 0; i + 2 < values.length; i += 3) points.push([values[i], values[i + 1], values[i + 2]]);
  return points;
};
function sample(points, time, envelope = 0) {
  if (!points.length) return 0;
  let next = points.findIndex(p => p[0] >= time);
  if (next < 0) next = points.length - 1;
  const b = points[next], a = points[Math.max(0, next - 1)];
  const t = b[0] === a[0] ? 0 : THREE.MathUtils.clamp((time - a[0]) / (b[0] - a[0]), 0, 1);
  return THREE.MathUtils.lerp(a[1] + (a[2] || 0) * envelope, b[1] + (b[2] || 0) * envelope, t);
}
function colorCurve(value) {
  const values = range(value), channels = [[], [], []];
  for (let i = 0; i + 4 < values.length; i += 5) {
    for (let channel = 0; channel < 3; channel++) channels[channel].push([values[i], values[i + channel + 1], 0]);
  }
  return channels;
}
function colorAt(channels, progress) {
  return new THREE.Color().setRGB(...channels.map(points => sample(points, progress)), THREE.SRGBColorSpace);
}
function gridFor(p) {
  const layout = number(p.FlipbookLayout);
  return layout === 4 ? [number(p.FlipbookSizeX, 1), number(p.FlipbookSizeY, 1)]
    : layout ? [2 ** layout, 2 ** layout] : [1, 1];
}
const textureCache = new Map();

async function textureFor(node) {
  if (!node.texture) throw new Error(`Missing original weapon effect texture: ${node.textureId}`);
  if (!textureCache.has(node.texture)) textureCache.set(node.texture, new THREE.TextureLoader().loadAsync(node.texture).then(texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }));
  return textureCache.get(node.texture);
}

const fragment = `
  uniform sampler2D uMap;
  uniform vec2 uGrid;
  uniform float uBrightness;
  varying vec2 vUv;
  varying vec4 vTint;
  varying float vFrame;
  vec4 tile(float f) {
    vec2 cell = vec2(mod(f,uGrid.x),uGrid.y-1.0-floor(f/uGrid.x));
    return texture2D(uMap,(cell+vUv)/uGrid);
  }
  void main() {
    float f = floor(vFrame);
    vec4 texel = mix(tile(f),tile(min(f+1.0,uGrid.x*uGrid.y-1.0)),fract(vFrame));
    gl_FragColor = vec4(texel.rgb*vTint.rgb*uBrightness,texel.a*vTint.a);
    if(gl_FragColor.a < .003) discard;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

class Emitter {
  constructor(node, texture) {
    this.node = node;
    this.p = node.properties;
    this.world = matrix(node.matrix);
    this.rotation = new THREE.Quaternion().setFromRotationMatrix(this.world);
    this.center = new THREE.Vector3().setFromMatrixPosition(this.world);
    this.rate = this.p.Enabled === 'true' ? number(this.p.Rate) : 0;
    this.capacity = Math.max(32, Math.min(512, Math.max(number(node.emitCount), Math.ceil(this.rate * Math.max(...range(this.p.Lifetime))) + 3)));
    this.sizeCurve = numericCurve(this.p.Size);
    this.alphaCurve = numericCurve(this.p.Transparency);
    this.colors = colorCurve(this.p.Color);
    this.acceleration = vector(this.p.Acceleration);
    this.grid = gridFor(this.p);
    this.particles = Array.from({length: this.capacity}, () => ({age: Infinity}));
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 4), 4);
    this.frames = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1);
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.setAttribute('aTint', this.tint);
    geometry.setAttribute('aFrame', this.frames);
    const material = new THREE.ShaderMaterial({
      uniforms: {uMap: {value: texture}, uGrid: {value: new THREE.Vector2(...this.grid)},
        uBrightness: {value: Math.max(1, Math.sqrt(number(this.p.Brightness, 1)))}},
      vertexShader: `attribute vec4 aTint; attribute float aFrame;
        varying vec2 vUv; varying vec4 vTint; varying float vFrame;
        void main(){vUv=uv;vTint=aTint;vFrame=aFrame;
          gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}`,
      fragmentShader: fragment, transparent: true, depthWrite: false,
      blending: number(this.p.LightEmission) >= .8 ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, this.capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.name = node.name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.userData.effect = true;
    this.next = 0; this.accumulator = 0;
    for (let i = 0; i < Math.floor(this.rate * Math.max(...range(this.p.Lifetime))); i++) {
      const particle = this.spawn();
      this.integrate(particle, Math.random() * particle.life);
    }
  }
  spawn() {
    const p = this.p, particle = this.particles[this.next++ % this.capacity];
    particle.age = 0; particle.life = randomRange(p.Lifetime);
    particle.position = this.center.clone();
    const size = this.node.sourceSize || [0, 0, 0];
    particle.position.add(new THREE.Vector3(...size.map(n => (Math.random() - .5) * n)).applyQuaternion(this.rotation));
    const axes = [[1,0,0],[0,1,0],[0,0,1],[-1,0,0],[0,-1,0],[0,0,-1]];
    const direction = new THREE.Vector3(...axes[number(p.EmissionDirection, 1)]);
    const spreadX = Math.min(360, Math.abs(number(p.SpreadAngle?.X)));
    const spreadY = Math.min(360, Math.abs(number(p.SpreadAngle?.Y)));
    direction.applyEuler(new THREE.Euler(THREE.MathUtils.degToRad((Math.random() - .5) * spreadX),
      0, THREE.MathUtils.degToRad((Math.random() - .5) * spreadY))).applyQuaternion(this.rotation);
    particle.velocity = direction.multiplyScalar(randomRange(p.Speed));
    particle.normal = particle.velocity.lengthSq() > .0001 ? particle.velocity.clone().normalize()
      : new THREE.Vector3(0, 1, 0).applyQuaternion(this.rotation);
    particle.rotation = THREE.MathUtils.degToRad(randomRange(p.Rotation));
    particle.rotSpeed = THREE.MathUtils.degToRad(randomRange(p.RotSpeed));
    particle.envelope = Math.random() * 2 - 1;
    particle.frameStart = p.FlipbookStartRandom === 'true' ? Math.floor(Math.random() * this.grid[0] * this.grid[1]) : 0;
    particle.fps = randomRange(p.FlipbookFramerate);
    return particle;
  }
  integrate(particle, dt) {
    particle.age += dt;
    particle.position.addScaledVector(particle.velocity, dt).addScaledVector(this.acceleration, .5 * dt * dt);
    particle.velocity.addScaledVector(this.acceleration, dt).multiplyScalar(Math.exp(-number(this.p.Drag) * dt));
  }
  update(dt, cameraQuaternion, cameraRight, cameraUp) {
    dt *= Math.max(0, number(this.p.TimeScale, 1));
    this.accumulator += dt * this.rate;
    while (this.accumulator >= 1) { this.spawn(); this.accumulator--; }
    const transform = new THREE.Matrix4(), quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(), z = new THREE.Vector3(0, 0, 1);
    this.particles.forEach((particle, i) => {
      if (!particle.position || particle.age >= particle.life) {
        transform.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, transform); return;
      }
      this.integrate(particle, dt);
      const progress = THREE.MathUtils.clamp(particle.age / particle.life, 0, 1);
      let angle = particle.rotation + particle.rotSpeed * particle.age;
      if (number(this.p.Orientation) === 3) quaternion.setFromUnitVectors(z, particle.normal);
      else {
        quaternion.copy(cameraQuaternion);
        if (number(this.p.Orientation) === 2) angle += Math.atan2(-particle.velocity.dot(cameraRight), particle.velocity.dot(cameraUp));
      }
      quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(z, angle));
      const size = Math.max(0, sample(this.sizeCurve, progress, particle.envelope));
      scale.set(size, size, size);
      transform.compose(particle.position, quaternion, scale);
      this.mesh.setMatrixAt(i, transform);
      const color = colorAt(this.colors, progress);
      this.tint.setXYZW(i, color.r, color.g, color.b, 1 - THREE.MathUtils.clamp(sample(this.alphaCurve, progress), 0, 1));
      const total = this.grid[0] * this.grid[1];
      let frame = this.p.FlipbookMode === '1' ? progress * (total - 1) : (particle.age * particle.fps + particle.frameStart) % total;
      if (this.p.FlipbookBlendFrames !== 'true') frame = Math.floor(frame);
      this.frames.setX(i, frame);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.tint.needsUpdate = this.frames.needsUpdate = true;
  }
}

class Beam {
  constructor(node, texture) {
    this.node = node;
    this.a = new THREE.Vector3().setFromMatrixPosition(matrix(node.attachment0));
    this.b = new THREE.Vector3().setFromMatrixPosition(matrix(node.attachment1));
    this.segments = Math.max(12, number(node.properties.Segments));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((this.segments + 1) * 6), 3));
    const uv = [], tint = [], indices = [];
    const colors = colorCurve(node.properties.Color), alpha = numericCurve(node.properties.Transparency);
    for (let i = 0; i <= this.segments; i++) {
      const t = i / this.segments, color = colorAt(colors, t);
      const repeat = (number(node.properties.TextureMode) === 0 ? 1 : this.a.distanceTo(this.b)) /
        Math.max(.001, number(node.properties.TextureLength, 1));
      uv.push(t*repeat, 0, t*repeat, 1);
      for (let side = 0; side < 2; side++) tint.push(color.r, color.g, color.b, 1 - sample(alpha, t));
      if (i < this.segments) { const j = i * 2; indices.push(j,j+1,j+2,j+2,j+1,j+3); }
    }
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 4));
    geometry.setIndex(indices);
    const map = texture.clone(); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.needsUpdate = true;
    this.material = new THREE.ShaderMaterial({
      uniforms: {uMap:{value:map},uTime:{value:0},uSpeed:{value:number(node.properties.TextureSpeed)},uBrightness:{value:Math.max(1, Math.sqrt(number(node.properties.Brightness, 1)))}},
      vertexShader:'attribute vec4 aTint; varying vec4 vTint; varying vec2 vUv; void main(){vTint=aTint;vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:`uniform sampler2D uMap;uniform float uTime,uSpeed,uBrightness;varying vec4 vTint;varying vec2 vUv;
        void main(){vec4 t=texture2D(uMap,vec2(vUv.x-uTime*uSpeed,vUv.y));gl_FragColor=vec4(t.rgb*vTint.rgb*uBrightness,t.a*vTint.a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent:true,depthWrite:false,side:THREE.DoubleSide,
      blending:number(node.properties.LightEmission)>.8?THREE.AdditiveBlending:THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = node.name;
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 9; this.mesh.userData.effect = true;
  }
  update(dt, cameraPosition) {
    this.material.uniforms.uTime.value += dt;
    const positions = this.mesh.geometry.attributes.position;
    const direction = this.b.clone().sub(this.a).normalize();
    for (let i = 0; i <= this.segments; i++) {
      const t = i / this.segments, center = this.a.clone().lerp(this.b, t);
      const side = new THREE.Vector3().crossVectors(direction, cameraPosition.clone().sub(center)).normalize();
      const width = THREE.MathUtils.lerp(number(this.node.properties.Width0), number(this.node.properties.Width1), t) * .5;
      const left = center.clone().addScaledVector(side, -width), right = center.clone().addScaledVector(side, width);
      positions.setXYZ(i*2,left.x,left.y,left.z); positions.setXYZ(i*2+1,right.x,right.y,right.z);
    }
    positions.needsUpdate = true;
  }
}

export async function createWeaponEffects(nodes) {
  const root = new THREE.Group(), emitters = [], beams = [];
  root.name = '武器原参数粒子与光束';
  await Promise.all(nodes.filter(n => n.class === 'ParticleEmitter' || (n.class === 'Beam' && n.properties.Enabled === 'true')).map(async node => {
    const texture = await textureFor(node, node.class === 'Beam' ? [1,1] : gridFor(node.properties));
    const effect = node.class === 'Beam' ? new Beam(node, texture) : new Emitter(node, texture);
    (node.class === 'Beam' ? beams : emitters).push(effect); root.add(effect.mesh);
  }));
  return {
    root,
    stats() { return {emitters:emitters.length, beams:beams.length, particles:emitters.reduce((n,e)=>n+e.particles.filter(p=>p.age<p.life).length,0), beamTime:beams[0]?.material.uniforms.uTime.value ?? 0}; },
    burst() { for(const emitter of emitters) if(emitter.p.Enabled !== 'true') for(let i=0;i<20;i++) emitter.spawn(); },
    emitOriginal(multiplier=1) { for(const emitter of emitters) for(let i=0;i<Math.max(1,Math.ceil(number(emitter.node.emitCount,20)*multiplier));i++) emitter.spawn(); },
    stop() { for(const emitter of emitters) emitter.rate=0; },
    dispose() { root.removeFromParent();for(const effect of [...emitters,...beams]){effect.mesh.geometry.dispose();effect.mesh.material.dispose();} },
    update(dt, camera) {
      root.updateWorldMatrix(true, false);
      const inverseRotation = new THREE.Matrix4().extractRotation(root.matrixWorld).invert();
      const quaternion = new THREE.Quaternion().setFromRotationMatrix(inverseRotation).multiply(camera.quaternion);
      const right = new THREE.Vector3(1,0,0).applyQuaternion(quaternion);
      const up = new THREE.Vector3(0,1,0).applyQuaternion(quaternion);
      const position = root.worldToLocal(camera.position.clone());
      for (const emitter of emitters) emitter.update(dt, quaternion, right, up);
      for (const beam of beams) beam.update(dt, position);
    },
  };
}

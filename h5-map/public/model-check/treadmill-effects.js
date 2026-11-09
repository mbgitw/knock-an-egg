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

function proceduralTexture(name, grid) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const [columns, rows] = grid;
  const width = canvas.width / columns, height = canvas.height / rows;
  for (let frame = 0; frame < columns * rows; frame++) {
    const phase = frame / Math.max(1, columns * rows - 1);
    ctx.save();
    ctx.translate((frame % columns + .5) * width, (Math.floor(frame / columns) + .5) * height);
    ctx.scale(width / 100, height / 100);
    ctx.strokeStyle = 'white';
    ctx.fillStyle = 'white';
    if (/lightning/i.test(name)) {
      ctx.lineWidth = 2.5;
      ctx.shadowBlur = 8;
      ctx.shadowColor = 'white';
      ctx.beginPath(); ctx.moveTo(-20, -44);
      for (let j = 0; j < 8; j++) ctx.lineTo(Math.sin(j * 3.1 + phase * 17) * 23, -40 + j * 12);
      ctx.stroke();
    } else if (/crack|debris|shard|drops/i.test(name)) {
      ctx.lineWidth = 1.7;
      for (let j = 0; j < 9; j++) {
        const angle = j * 2.4 + phase * .5, radius = 12 + (j % 4) * 8;
        ctx.beginPath(); ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        ctx.lineTo(Math.cos(angle + .3) * (radius + 13), Math.sin(angle + .3) * (radius + 13)); ctx.stroke();
      }
    } else if (/swirl|portal|wave|plasma|wobble|images/i.test(name)) {
      ctx.rotate(phase * 1.3);
      for (let j = 0; j < 3; j++) {
        ctx.lineWidth = 1.5 + j;
        ctx.globalAlpha = .8 - j * .2;
        ctx.shadowBlur = 6; ctx.shadowColor = 'white';
        ctx.beginPath(); ctx.ellipse(0, 0, 19 + j * 8, 17 + j * 9, phase + j, .3 + j, 5.5 + j); ctx.stroke();
      }
    } else if (/flame/i.test(name)) {
      const glow = ctx.createRadialGradient(0, 12, 1, 0, 0, 47);
      glow.addColorStop(0, '#ffffffff'); glow.addColorStop(.4, '#ffffffaa'); glow.addColorStop(1, '#ffffff00');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.moveTo(-27, 40);
      ctx.bezierCurveTo(-45, 0, -2, -4, -7 + Math.sin(phase * 10) * 12, -47);
      ctx.bezierCurveTo(25, -11, 47, 17, 24, 42); ctx.closePath(); ctx.fill();
    } else {
      for (let j = 0; j < 5; j++) {
        const x = Math.sin(j * 3.7 + phase * 2) * 14, y = Math.cos(j * 1.4 + phase * 3) * 14;
        const glow = ctx.createRadialGradient(x, y, 1, x, y, 30);
        glow.addColorStop(0, '#ffffffa0'); glow.addColorStop(1, '#ffffff00');
        ctx.fillStyle = glow; ctx.fillRect(-50, -50, 100, 100);
      }
    }
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

async function textureFor(node, grid) {
  if (node.class === 'Beam' && !node.textureId) {
    const texture = new THREE.DataTexture(new Uint8Array([255,255,255,255]), 1, 1);
    texture.needsUpdate = true;
    return texture;
  }
  const key = node.texture || `${node.name}:${grid.join('x')}`;
  if (!textureCache.has(key)) textureCache.set(key, (async () => {
    if (node.texture) {
      const texture = await new THREE.TextureLoader().loadAsync(node.texture);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    }
    return proceduralTexture(node.name, grid);
  })());
  return textureCache.get(key);
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
    this.rate = number(this.p.Rate);
    this.capacity = Math.min(256, Math.ceil(this.rate * Math.max(...range(this.p.Lifetime))) + 3);
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
      uv.push(t, 0, t, 1);
      for (let side = 0; side < 2; side++) tint.push(color.r, color.g, color.b, 1 - sample(alpha, t));
      if (i < this.segments) { const j = i * 2; indices.push(j,j+1,j+2,j+2,j+1,j+3); }
    }
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 4));
    geometry.setIndex(indices);
    const map = texture.clone(); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.needsUpdate = true;
    this.material = new THREE.ShaderMaterial({
      uniforms: {uMap:{value:map},uTime:{value:0},uSpeed:{value:number(node.properties.TextureSpeed)}},
      vertexShader:'attribute vec4 aTint; varying vec4 vTint; varying vec2 vUv; void main(){vTint=aTint;vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:`uniform sampler2D uMap;uniform float uTime,uSpeed;varying vec4 vTint;varying vec2 vUv;
        void main(){vec4 t=texture2D(uMap,vec2(vUv.x-uTime*uSpeed,vUv.y));gl_FragColor=t*vTint;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent:true,depthWrite:false,side:THREE.DoubleSide,
      blending:number(node.properties.LightEmission)>.8?THREE.AdditiveBlending:THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
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

export async function createTreadmillEffects(nodes) {
  const root = new THREE.Group(), emitters = [], beams = [];
  root.name = '参数特效';
  await Promise.all(nodes.filter(n => n.properties.Enabled === 'true').map(async node => {
    const texture = await textureFor(node, node.class === 'Beam' ? [1,1] : gridFor(node.properties));
    const effect = node.class === 'Beam' ? new Beam(node, texture) : new Emitter(node, texture);
    (node.class === 'Beam' ? beams : emitters).push(effect); root.add(effect.mesh);
  }));
  return {
    root,
    dispose() {
      root.traverse(object => { if (object.isMesh) { object.geometry.dispose(); object.material.dispose(); } });
      root.clear();
    },
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

import { disposePetModel } from "./pet-animation.js";
import * as THREE from "three";
const HATCH_REVEAL_DURATION_SECONDS = 2.8;
function hatchEggPose(progress, targetRatio, elapsed, seed = 0) {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  const cycle = ((elapsed + seed * 0.37) % 2.55 + 2.55) % 2.55;
  const burst = p >= 1 && cycle < 0.72 ? Math.sin(cycle / 0.72 * Math.PI) : 0;
  return {
    scale: 1 + (targetRatio - 1) * p,
    tiltX: burst ? Math.sin(elapsed * 19 + seed) * 0.11 * burst : 0,
    tiltZ: burst ? Math.sin(elapsed * 23 + seed * 0.8) * 0.16 * burst : 0,
    lift: burst * 0.09
  };
}
const HATCH_CRACK_CYCLE = 0.8;
const HATCH_CRACK_DURATION = HATCH_CRACK_CYCLE * 3;
function hatchCrackPose(elapsed) {
  const done = elapsed + 1e-8 >= HATCH_CRACK_DURATION;
  const cycle = elapsed % HATCH_CRACK_CYCLE;
  const phase = cycle / 0.32;
  const wave = !done && phase < 1 ? Math.sin(phase * Math.PI * 6) * Math.sin(phase * Math.PI) : 0;
  return {
    tiltX: wave * 0.035,
    tiltZ: wave * 0.085,
    beat: Math.min(2, Math.floor(elapsed / HATCH_CRACK_CYCLE)),
    done
  };
}
const HATCH_REVEAL_HOLD = HATCH_REVEAL_DURATION_SECONDS;
const HATCH_REVEAL_FLIGHT = 0.7;
function hatchAnimalGrowth(elapsed) {
  const p = THREE.MathUtils.clamp(elapsed / 1.3, 0, 1);
  const eased = p === 0 ? 0 : p === 1 ? 1 : 2 ** (-10 * p) * Math.sin((p - 0.075) * (2 * Math.PI) / 0.3) + 1;
  return 0.5 + 0.5 * eased;
}
function hatchFlightDuration(_distance) {
  return HATCH_REVEAL_FLIGHT;
}
function hatchFlightPose(elapsed, origin, target) {
  const t = elapsed + 1e-8 >= HATCH_REVEAL_HOLD + HATCH_REVEAL_FLIGHT ? 1 : THREE.MathUtils.clamp((elapsed - HATCH_REVEAL_HOLD) / HATCH_REVEAL_FLIGHT, 0, 1);
  const lift = THREE.MathUtils.clamp(origin.distanceTo(target) * 0.6, 2, 36);
  const position = origin.clone().lerp(target, t);
  position.y += 2 * lift * t * (1 - t);
  const q = THREE.MathUtils.clamp((t - 0.6) / 0.4, 0, 1);
  const fade = q === 0 ? 0 : q === 1 ? 1 : 2 ** (10 * (q - 1));
  return { position, scale: 1 - fade, opacity: 1 - fade, arrived: t >= 1, done: t >= 1 };
}
class HatchReveal {
  constructor(animal, origin, baseScale, shellHeight, color, playerHeight = 2.7) {
    this.animal = animal;
    this.origin = origin;
    this.baseScale = baseScale;
    this.playerHeight = playerHeight;
    this.root.name = "hatch-reveal";
    this.shardMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.6, side: THREE.DoubleSide, transparent: true });
    animal.position.copy(origin);
    animal.scale.setScalar(this.baseScale * 0.5);
    this.root.add(animal);
    animal.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const original = object.material;
      const temporary = (Array.isArray(original) ? original : [original]).map((source) => {
        const material = source.clone();
        material.onBeforeCompile = (shader, renderer) => {
          source.onBeforeCompile(shader, renderer);
          shader.uniforms.hatchFlash = this.flash;
          shader.fragmentShader = "uniform float hatchFlash;\n" + shader.fragmentShader.replace(
            "#include <dithering_fragment>",
            "gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), hatchFlash);\n#include <dithering_fragment>"
          );
        };
        material.customProgramCacheKey = () => source.customProgramCacheKey() + "|hatch-flash";
        return material;
      });
      object.material = Array.isArray(original) ? temporary : temporary[0];
      this.flashMeshes.push({ mesh: object, original, temporary });
    });
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI * 2 / 12;
      const mesh = new THREE.Mesh(this.shardGeometry, this.shardMaterial);
      const size = shellHeight * (0.08 + i % 3 * 0.025);
      mesh.scale.set(size, size * 1.25, size);
      const start = origin.clone().add(new THREE.Vector3(
        Math.cos(angle) * shellHeight * 0.2,
        shellHeight * (0.25 + i % 3 * 0.2),
        Math.sin(angle) * shellHeight * 0.2
      ));
      mesh.position.copy(start);
      mesh.rotation.set(angle, i * 0.9, i * 0.6);
      const speed = Math.max(2.5, shellHeight * 0.7);
      const velocity = new THREE.Vector3(Math.cos(angle) * speed, 2.5 + i % 3, Math.sin(angle) * speed);
      this.shards.push({ mesh, start, velocity });
      this.root.add(mesh);
    }
  }
  root = new THREE.Group();
  elapsed = 0;
  shardGeometry = new THREE.SphereGeometry(1, 4, 3, 0, Math.PI / 2, Math.PI / 4, Math.PI / 3);
  shardMaterial;
  shards = [];
  flash = { value: 1 };
  flashMeshes = [];
  update(delta, playerPosition) {
    this.elapsed += Math.max(0, delta);
    this.flash.value = 1 - THREE.MathUtils.smoothstep(this.elapsed, 0.04, 0.32);
    const target = playerPosition.clone();
    target.y += this.playerHeight * 0.5;
    const pose = hatchFlightPose(this.elapsed, this.origin, target);
    this.animal.position.copy(pose.position);
    const growth = hatchAnimalGrowth(this.elapsed);
    this.animal.scale.setScalar(Math.max(1e-3, this.baseScale * growth * pose.scale));
    for (const entry of this.flashMeshes) {
      const originals = Array.isArray(entry.original) ? entry.original : [entry.original];
      entry.temporary.forEach((material, i) => {
        material.opacity = originals[i].opacity * pose.opacity;
        if (pose.opacity < 1 && !material.transparent) {
          material.transparent = true;
          material.needsUpdate = true;
        }
      });
    }
    if (pose.position.distanceToSquared(target) > 0.01) {
      this.animal.rotation.y = Math.atan2(pose.position.x - target.x, pose.position.z - target.z);
    }
    this.shardMaterial.opacity = 1 - THREE.MathUtils.smoothstep(this.elapsed, 0.18, 0.65);
    for (const shard of this.shards) {
      shard.mesh.visible = this.elapsed < 0.65;
      if (!shard.mesh.visible) continue;
      shard.mesh.position.copy(shard.start).addScaledVector(shard.velocity, this.elapsed);
      shard.mesh.position.y -= 7 * this.elapsed * this.elapsed;
      shard.mesh.rotation.x += delta * 5;
      shard.mesh.rotation.z += delta * 3;
    }
    return pose.done;
  }
  clearFlash() {
    for (const entry of this.flashMeshes) {
      entry.mesh.material = entry.original;
      entry.temporary.forEach((material) => material.dispose());
    }
    this.flashMeshes.length = 0;
  }
  dispose() {
    disposePetModel(this.animal);
    this.clearFlash();
    this.root.removeFromParent();
    this.shardGeometry.dispose();
    this.shardMaterial.dispose();
  }
}
export {
  HATCH_CRACK_CYCLE,
  HATCH_CRACK_DURATION,
  HATCH_REVEAL_FLIGHT,
  HATCH_REVEAL_HOLD,
  HatchReveal,
  hatchAnimalGrowth,
  hatchCrackPose,
  hatchEggPose,
  hatchFlightDuration,
  hatchFlightPose
};

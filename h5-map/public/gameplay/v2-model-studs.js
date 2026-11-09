import * as THREE from 'three';



/** Original MaterialService/Studs.StudsPerTile, in native world units. */

export const MODEL_STUD_WORLD_SPACING = 0.5;



/** Square plastic studs in bind-pose coordinates: movement and cache skinning

 * must not make a world-projected pattern slide across an animal's body. */

export function prepareModelStudGeometry(geometry) {

  if (geometry.hasAttribute('studPosition')) return;

  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');

  if (!position || !normal) return;

  geometry.setAttribute('studPosition', position.clone());

  geometry.setAttribute('studNormal', normal.clone());

}



export function applyModelStudMaterial(material, spacing = MODEL_STUD_WORLD_SPACING) {

  if (!(material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial)) return;

  if (material.userData.modelStudSpacing) return;

  material.userData.modelStudSpacing = spacing;

  const scaleCorrection = { value: 1 };

  material.userData.modelStudScaleCorrection = scaleCorrection;

  const compile = material.onBeforeCompile, key = material.customProgramCacheKey();

  material.onBeforeCompile = (shader, renderer) => {

    compile.call(material, shader, renderer);

    shader.uniforms.modelStudSpacing = { value: spacing };

    shader.uniforms.modelStudScaleCorrection = scaleCorrection;

    shader.vertexShader = `attribute vec3 studPosition;

attribute vec3 studNormal;

uniform float modelStudScaleCorrection;

varying vec3 vStudPosition;

varying vec3 vStudNormal;

` + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>

// Keep the bind-pose coordinates attached to the animal, but express their

// distances in actual world units. Translation/rotation must not move the grid.

// modelMatrix includes species normalization, part scale and instance growth.

vec3 studWorldScale = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));

#ifdef USE_INSTANCING

  studWorldScale *= vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));

#endif

vStudPosition = studPosition * studWorldScale * modelStudScaleCorrection;

vStudNormal = studNormal;`);

    shader.fragmentShader = `varying vec3 vStudPosition;

varying vec3 vStudNormal;

uniform float modelStudSpacing;

// Analytic bevel and derivative filtering keep distant studs from sparkling.

vec2 modelStud(vec2 uv) {

  vec2 cell = abs(fract(uv + 0.5) - 0.5);

  float edge = max(cell.x, cell.y);

  float aa = max(max(fwidth(uv.x), fwidth(uv.y)), 0.002);

  float top = 1.0 - smoothstep(0.22 - aa, 0.29 + aa, edge);

  float shadow = (1.0 - smoothstep(0.29 - aa, 0.35 + aa, edge)) - top;

  float fade = 1.0 - smoothstep(0.3, 0.8, aa);

  return vec2(top * fade, shadow * fade);

}

` + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>

vec3 studWeights = pow(abs(normalize(vStudNormal)), vec3(12.0));

studWeights /= max(dot(studWeights, vec3(1.0)), 0.0001);

vec3 studCoord = vStudPosition / modelStudSpacing;

vec2 studDetail = modelStud(studCoord.yz) * studWeights.x

  + modelStud(studCoord.xz) * studWeights.y

  + modelStud(studCoord.xy) * studWeights.z;

diffuseColor.rgb *= 1.0 + 0.035 * studDetail.x - 0.2 * studDetail.y;`);

    if (material instanceof THREE.MeshStandardMaterial) {

      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>

// Screen derivatives produce a shallow raised bevel under the actual lights.

vec3 studDx = dFdx(-vViewPosition), studDy = dFdy(-vViewPosition);

vec3 studR1 = cross(studDy, normal), studR2 = cross(normal, studDx);

float studDet = dot(studDx, studR1);

float studHeight = studDetail.x * modelStudSpacing * 0.045;

vec3 studGradient = sign(studDet) * (dFdx(studHeight) * studR1 + dFdy(studHeight) * studR2);

normal = normalize(abs(studDet) * normal - studGradient);`);

    }

  };

  // Spacing is a uniform, not a shader source variant. Including it in the key

  // recompiles the same program for every differently sized animal.

  material.customProgramCacheKey = () => `${key}|model-square-studs-world-density-v3`;

  material.needsUpdate = true;

}



/** Fallback GLBs share geometry; only immutable bind-pose attributes are added.

 * Materials belong to the instance, preserving cached models and other users. */

export function applyModelStuds(root, spacing = MODEL_STUD_WORLD_SPACING) {

  const copies = new Map();

  root.traverse(object => {

    if (!(object instanceof THREE.Mesh)) return;

    prepareModelStudGeometry(object.geometry);

    const materials = (Array.isArray(object.material) ? object.material : [object.material]).map(source => {

      if (!copies.has(source)) {

        const copy = source.clone();

        applyModelStudMaterial(copy, spacing);

        copies.set(source, copy);

      }

      return copies.get(source);

    });

    object.material = Array.isArray(object.material) ? materials : materials[0];

  });

}



/** Cancel placed-egg growth in texture coordinates so studs stay on the shell. */

export function setModelStudScaleCorrection(root, correction) {

  root.traverse(object => {

    if (!(object instanceof THREE.Mesh)) return;

    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {

      const uniform = material.userData.modelStudScaleCorrection;

      if (uniform) uniform.value = correction;

    }

  });

}


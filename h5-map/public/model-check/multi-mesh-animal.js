import * as THREE from 'three';

export function buildMultiMeshAnimal(data, materials) {
  const root = new THREE.Group();
  const bones = data.bones.map(source => {
    const bone = new THREE.Bone();
    bone.name = source.name;
    bone.position.fromArray(source.position);
    bone.quaternion.fromArray(source.quaternion).normalize();
    bone.userData.restPosition = bone.position.clone();
    bone.userData.restQuaternion = bone.quaternion.clone();
    return bone;
  });
  data.bones.forEach((source, i) => (source.parent < 0 ? root : bones[source.parent]).add(bones[i]));
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const meshes = data.meshes.map(source => {
    const geometry = new THREE.BufferGeometry();
    for (const [attribute, key, size, Type] of [
      ['position','positions',3,Float32Array],['normal','normals',3,Float32Array],
      ['uv','uvs',2,Float32Array],['skinIndex','skinIndices',4,Uint16Array],['skinWeight','skinWeights',4,Float32Array],
    ]) geometry.setAttribute(attribute,new THREE.BufferAttribute(new Type(source[key]),size));
    geometry.setIndex(source.indices);
    const material=materials.get(source.material);
    if(!material)throw Error('缺少多部件材质 '+source.material);
    const mesh=new THREE.SkinnedMesh(geometry,material);
    mesh.frustumCulled=false;
    root.add(mesh);
    mesh.bind(skeleton,new THREE.Matrix4());
    return mesh;
  });
  root.updateMatrixWorld(true);skeleton.update();
  const bounds=new THREE.Box3().setFromObject(root),center=bounds.getCenter(new THREE.Vector3());
  root.position.set(-center.x,-bounds.min.y,-center.z);
  root.updateMatrixWorld(true);skeleton.update();
  return {root,mesh:root,meshes,skeleton,bones,mixer:new THREE.AnimationMixer(root),actions:new Map()};
}

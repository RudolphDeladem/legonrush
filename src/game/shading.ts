import * as THREE from 'three';

/**
 * Cheap ambient occlusion: surfaces darken as they get close to the ground, the way walls,
 * tree trunks, kerbs and car bodies do in real light. One smoothstep per pixel, no extra pass.
 * `reach` is how high (m) the darkening goes; `strength` how dark it is at the ground.
 */
export function groundShade<T extends THREE.Material>(mat: T, reach = 1.4, strength = 0.38, key = 'gs'): T {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vGsY;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n{ vec4 gsW = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n gsW = instanceMatrix * gsW;\n#endif\n vGsY = (modelMatrix * gsW).y; }');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGsY;')
      .replace('#include <map_fragment>', `#include <map_fragment>\ndiffuseColor.rgb *= 1.0 - ${strength.toFixed(3)} * (1.0 - smoothstep(0.0, ${reach.toFixed(3)}, vGsY));`);
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey()}|${key}${reach}${strength}`;
  return mat;
}

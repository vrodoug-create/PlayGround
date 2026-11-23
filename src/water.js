import * as THREE from 'three'
import { MAX_AMP, waveShaderChunk, waveUniforms } from './waves.js'

function makeWaterNormalTexture(size = 256) {
  const height = new Float32Array(size * size)
  const waves = []
  for (let i = 0; i < 16; i++) {
    waves.push({
      fx: Math.round(1 + Math.random() * 9),
      fy: Math.round(1 + Math.random() * 9),
      amp: 0.7 / (1 + i * 0.28),
      phase: Math.random() * Math.PI * 2,
    })
  }
  const TAU = Math.PI * 2
  for (let y = 0; y < size; y++) {
    const v = (y / size) * TAU
    for (let x = 0; x < size; x++) {
      const u = (x / size) * TAU
      const warp = Math.sin(u * 2 + Math.sin(v * 2.0) * 1.4) + Math.cos(v * 3 - Math.sin(u * 1.5) * 1.2)
      let h = 0
      for (const w of waves) {
        h += w.amp * Math.sin(u * w.fx + v * w.fy + w.phase + warp * 0.55)
      }
      height[y * size + x] = h
    }
  }
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xl = (x - 1 + size) % size
      const xr = (x + 1) % size
      const yu = (y - 1 + size) % size
      const yd = (y + 1) % size
      const dx = (height[y * size + xr] - height[y * size + xl]) * 3.2
      const dy = (height[yd * size + x] - height[yu * size + x]) * 3.2
      const inv = 1 / Math.hypot(dx, dy, 1)
      const i = (y * size + x) * 4
      data[i] = Math.round(((-dx * inv) * 0.5 + 0.5) * 255)
      data[i + 1] = Math.round(((-dy * inv) * 0.5 + 0.5) * 255)
      data[i + 2] = Math.round(((inv) * 0.5 + 0.5) * 255)
      data[i + 3] = 255
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = true
  tex.needsUpdate = true
  return tex
}

const vertexHead = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vCrest;
varying vec2 vXZ;
`

const fragmentHead = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uCam;
uniform vec3 uPlayer;
uniform float uDawn;
uniform float uSpeed;
uniform sampler2D uNormalMap;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vCrest;
varying vec2 vXZ;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.04 + vec2(17.0, 9.0);
    a *= 0.5;
  }
  return v;
}
vec3 skyTint(vec3 r) {
  float h = max(r.y, 0.0);
  vec3 horizon = mix(vec3(0.38, 0.17, 0.19), vec3(1.15, 0.48, 0.22), uDawn);
  vec3 zenith = mix(vec3(0.014, 0.028, 0.072), vec3(0.045, 0.10, 0.22), uDawn);
  vec3 c = mix(horizon, zenith, smoothstep(0.0, 0.55, h));
  float sd = max(dot(r, uSunDir), 0.0);
  c += vec3(1.0, 0.44, 0.16) * (pow(sd, 7.0) * 0.22 + pow(sd, 90.0) * 0.9 + pow(sd, 900.0) * 2.6);
  return c;
}
`

const fragmentMain = /* glsl */ `
void main() {
  vec3 V = normalize(uCam - vWorld);
  vec3 N = normalize(vNormalW);

  // Wind chop: two scrolling bands of a hand-built normal map, plus a slow swell wobble.
  vec2 rp = vWorld.xz;
  float t = uTime;
  vec2 nA = texture2D(uNormalMap, rp * 0.034 + vec2(t * 0.0038, -t * 0.0026)).xy * 2.0 - 1.0;
  vec2 nB = texture2D(uNormalMap, rp * 0.095 + vec2(-t * 0.0075, t * 0.0055)).xy * 2.0 - 1.0;
  vec2 nC = texture2D(uNormalMap, rp * 0.21 + vec2(t * 0.014, t * 0.009)).xy * 2.0 - 1.0;
  float wob = sin(rp.x * 0.09 + rp.y * 0.05 + t * 0.22);
  N.x += nA.x * 0.20 + nB.x * 0.15 + nC.x * 0.075 + wob * 0.010;
  N.z += nA.y * 0.20 + nB.y * 0.15 + nC.y * 0.075 + wob * 0.010;
  N = normalize(N);
  N = normalize(N);

  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
  fres = 0.05 + 0.88 * fres;

  vec3 R = reflect(-V, N);
  vec3 sky = skyTint(R);

  vec3 deep = mix(vec3(0.0035, 0.021, 0.040), vec3(0.006, 0.050, 0.076), uDawn);
  vec3 shallow = mix(vec3(0.008, 0.125, 0.145), vec3(0.026, 0.265, 0.255), uDawn);
  float crestT = smoothstep(-2.0, 7.5, vCrest);
  vec3 body = mix(deep, shallow, crestT * 0.5);
  float shade = clamp(dot(N, normalize(vec3(-0.30, 0.55, -0.78))), 0.0, 1.0);
  body *= 0.72 + 0.58 * shade;
  body += shallow * 0.12;
  vec3 ambient = mix(vec3(0.020, 0.030, 0.055), vec3(0.075, 0.075, 0.115), uDawn);
  body += ambient * (0.55 + 0.45 * clamp(N.y, 0.0, 1.0));
  float trans = pow(max(dot(-N, uSunDir), 0.0), 1.5);
  body += shallow * trans * 0.42;
  body += vec3(1.0, 0.52, 0.22) * trans * 0.035;
  sky *= 0.68;

  vec3 col = mix(body, sky, fres * 0.62);

  // Sun glitter path + crisp sparkles on the faces.
  vec3 sunCol = vec3(1.0, 0.62, 0.30);
  float sd = max(dot(R, uSunDir), 0.0);
  float sparkle = vnoise(rp * 4.6 + vec2(t * 0.9, -t * 0.6));
  sparkle *= vnoise(rp * 11.0 - vec2(t * 1.4, t * 0.8));
  float glint = pow(sd, 500.0) * (1.5 + 14.0 * sparkle);
  float sheen = pow(sd, 55.0) * 0.28;
  col += sunCol * (glint + sheen) * (0.6 + 0.5 * uDawn);

  // Light bleeding through the crests when looking into the sunrise.
  float back = pow(max(dot(-V, uSunDir), 0.0), 2.5);
  col += shallow * back * crestT * 0.30;
  col += vec3(1.0, 0.58, 0.26) * back * crestT * crestT * 0.13;

  // Foam: sparse lace on the lip, not a blanket.
  float crestN = vCrest / (${MAX_AMP.toFixed(4)} * 0.92);
  float lip = smoothstep(0.72, 0.99, crestN);
  float steep = 1.0 - clamp(normalize(vNormalW).y, 0.0, 1.0);
  float lace = fbm(vec2(rp.x * 0.38 + rp.y * 0.14, rp.y * 2.6) + vec2(t * 0.05, -t * 0.2));
  float lace2 = fbm(rp * 7.0 + vec2(t * 0.4, -t * 0.25));
  float cell = smoothstep(0.34, 0.66, lace * 0.9 + lace2 * 0.3);
  float feather = smoothstep(0.0, 0.30, steep * 1.7 + lace2 * 0.15);
  float foam = lip * cell * (0.3 + 0.7 * feather);
  float whitecap = smoothstep(0.14, 0.30, steep) * smoothstep(0.46, 0.72, lace2 * 0.7 + lace * 0.4);
  foam = clamp(foam + whitecap * 0.30, 0.0, 1.0);

  // Thin white streaks running down the steep faces.
  float streak = smoothstep(0.58, 0.9, fbm(vec2(rp.x * 0.16 + rp.y * 0.06, rp.y * 1.9) + t * 0.06));
  streak *= smoothstep(0.10, 0.24, steep) * (1.0 - lip) * 0.22;
  foam = clamp(foam + streak, 0.0, 1.0);

  float wd = distance(vWorld.xz, uPlayer.xz);
  float ring = smoothstep(3.0, 0.3, wd) * smoothstep(0.3, 0.95, lace2 + 0.3);
  ring *= 0.25 + 0.25 * smoothstep(0.0, 8.0, uSpeed);
  foam = clamp(foam + ring * 0.4, 0.0, 1.0);

  vec3 foamCol = mix(vec3(0.46, 0.50, 0.58), vec3(0.96, 0.86, 0.75), uDawn);
  foamCol *= 0.7 + 0.42 * max(dot(N, uSunDir), 0.0);
  col = mix(col, foamCol, foam * 0.78);

  // Atmospheric haze towards the horizon.
  float dist = distance(uCam, vWorld);
  vec3 haze = mix(vec3(0.35, 0.18, 0.21), vec3(0.92, 0.44, 0.26), uDawn);
  haze = mix(haze, skyTint(normalize(vec3(V.x, 0.02, V.z))), 0.35) * 0.88;
  col = mix(col, haze, smoothstep(300.0, 860.0, dist));

  gl_FragColor = vec4(col, 1.0);
}
`

export function createOcean() {
  const normalMap = makeWaterNormalTexture(256)
  const uniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 0.05, -1).normalize() },
    uCam: { value: new THREE.Vector3() },
    uPlayer: { value: new THREE.Vector3() },
    uDawn: { value: 0.15 },
    uSpeed: { value: 0 },
    uNormalMap: { value: normalMap },
  }
  const waves = waveUniforms()
  waves.forEach((w, i) => {
    uniforms[`w${i}Dir`] = { value: new THREE.Vector2(w.uDir.value[0], w.uDir.value[1]) }
    uniforms[`w${i}K`] = { value: w.uK.value }
    uniforms[`w${i}Amp`] = { value: w.uAmp.value }
    uniforms[`w${i}Omega`] = { value: w.uOmega.value }
    uniforms[`w${i}Phase`] = { value: w.uPhase.value }
    uniforms[`w${i}Chop`] = { value: w.uChop.value }
  })

  const decl = []
  for (let i = 0; i < waves.length; i++) {
    decl.push(`uniform vec2 w${i}Dir; uniform float w${i}K; uniform float w${i}Amp; uniform float w${i}Omega; uniform float w${i}Phase; uniform float w${i}Chop;`)
  }

  const chunk = waveShaderChunk('w')

  const vertexShader = vertexHead + decl.join('\n') + /* glsl */ `
void main() {
  vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 disp = vec3(0.0);
  float crest = 0.0;
  vec3 tangentX = vec3(1.0, 0.0, 0.0);
  vec3 tangentZ = vec3(0.0, 0.0, 1.0);
${chunk.body}
  p += disp;
  vWorld = p;
  vXZ = p.xz;
  vCrest = crest;
  vNormalW = normalize(cross(tangentZ, tangentX));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader: fragmentHead + fragmentMain,
    side: THREE.DoubleSide,
  })

  const geometry = new THREE.PlaneGeometry(1150, 1150, 340, 340)
  geometry.rotateX(-Math.PI / 2)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = -1

  const snap = 1150 / 340
  return {
    mesh,
    uniforms,
    update(playerPos, time, dawn, speed) {
      uniforms.uTime.value = time
      uniforms.uPlayer.value.copy(playerPos)
      uniforms.uDawn.value = dawn
      uniforms.uSpeed.value = speed
      mesh.position.x = Math.round(playerPos.x / snap) * snap
      mesh.position.z = Math.round(playerPos.z / snap) * snap
    },
  }
}

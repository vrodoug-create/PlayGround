// Shared wave field: the same directional swell sum drives the water shader
// (GPU, with Gerstner horizontal displacement) and the surf physics (CPU).

// A crossed sea: no single swell owns the horizon, so crests form peaks,
// saddles and breaking lips instead of one endless wall.
export const WAVES = [
  { len: 150, amp: 1.55, dir: [0.10, 0.995], speed: 0.80, phase: 0.4,  chop: 0.22 },
  { len: 96,  amp: 2.55, dir: [0.46, 0.888], speed: 0.98, phase: 2.1,  chop: 0.32 },
  { len: 73,  amp: 2.05, dir: [-0.54, 0.842], speed: 1.00, phase: 4.4, chop: 0.34 },
  { len: 47,  amp: 1.10, dir: [0.84, 0.542], speed: 1.08, phase: 1.2,  chop: 0.32 },
  { len: 29,  amp: 0.48, dir: [-0.22, 0.975], speed: 1.15, phase: 5.3, chop: 0.26 },
]

const G = 9.81
export const MAX_AMP = WAVES.reduce((s, w) => s + w.amp, 0)

for (const w of WAVES) {
  const n = Math.hypot(w.dir[0], w.dir[1])
  w.dir[0] /= n
  w.dir[1] /= n
  w.k = (Math.PI * 2) / w.len
  w.omega = Math.sqrt(G * w.k) * w.speed
}

export function waterHeight(x, z, t) {
  let h = 0
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i]
    h += w.amp * Math.sin(w.k * (w.dir[0] * x + w.dir[1] * z) - w.omega * t + w.phase)
  }
  return h
}

export function waterGradient(x, z, t, out) {
  let gx = 0
  let gz = 0
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i]
    const ph = w.k * (w.dir[0] * x + w.dir[1] * z) - w.omega * t + w.phase
    const c = Math.cos(ph) * w.amp * w.k
    gx += c * w.dir[0]
    gz += c * w.dir[1]
  }
  out.x = gx
  out.z = gz
  return out
}

// Dedicated uniforms rather than a static uniform array keeps the hot shader simple.
export function waveUniforms() {
  return WAVES.map((w) => ({
    uDir: { value: [w.dir[0], w.dir[1]] },
    uK: { value: w.k },
    uAmp: { value: w.amp },
    uOmega: { value: w.omega },
    uPhase: { value: w.phase },
    uChop: { value: w.chop },
  }))
}

// Builds the GLSL swell evaluator. Returns displaced position + normal + raw crest.
export function waveShaderChunk(uniformPrefix = 'w') {
  let body = ''
  let normal = ''
  WAVES.forEach((w, i) => {
    const u = `${uniformPrefix}${i}`
    body += `
  {
    vec2 d = ${u}Dir;
    float k = ${u}K;
    float amp = ${u}Amp;
    float q = ${u}Chop;
    float ph = k * dot(d, p.xz) - ${u}Omega * uTime + ${u}Phase;
    float s = sin(ph);
    float c = cos(ph);
    disp.x += amp * q * d.x * c;
    disp.z += amp * q * d.y * c;
    disp.y += amp * s;
    crest += amp * s;
    float qa = amp * q * k;
    tangentX.x -= qa * d.x * d.x * s;
    tangentX.y += amp * k * d.x * c;
    tangentX.z -= qa * d.x * d.y * s;
    tangentZ.x -= qa * d.x * d.y * s;
    tangentZ.y += amp * k * d.y * c;
    tangentZ.z -= qa * d.y * d.y * s;
  }`
    normal += `
  {
    vec2 d = ${u}Dir;
    float k = ${u}K;
    float amp = ${u}Amp;
    float q = ${u}Chop;
    float ph = k * dot(p.xz, d) - ${u}Omega * uTime + ${u}Phase;
    float s = sin(ph);
    float c = cos(ph);
    grad.x += k * amp * d.x * c;
    grad.y += k * amp * d.y * c;
    float qa = amp * q * k;
    tangentX.x -= qa * d.x * d.x * s;
    tangentX.y += amp * k * d.x * c;
    tangentX.z -= qa * d.x * d.y * s;
    tangentZ.x -= qa * d.x * d.y * s;
    tangentZ.y += amp * k * d.y * c;
    tangentZ.z -= qa * d.y * d.y * s;
  }`
  })
  return { body, normal }
}

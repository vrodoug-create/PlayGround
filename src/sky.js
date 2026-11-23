import * as THREE from 'three'

function glowTexture(inner = 'rgba(255,236,190,1)', outer = 'rgba(255,140,60,0)') {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128)
  grad.addColorStop(0, inner)
  grad.addColorStop(0.18, 'rgba(255,214,150,0.85)')
  grad.addColorStop(0.42, 'rgba(255,150,80,0.28)')
  grad.addColorStop(1, outer)
  g.fillStyle = grad
  g.fillRect(0, 0, 256, 256)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const skyFrag = /* glsl */ `
uniform vec3 uSunDir;
uniform float uDawn;
uniform float uTime;
uniform float uFlash;
varying vec3 vDir;

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
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = p * 2.02 + vec2(11.0, 7.0);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  float sd = max(dot(d, uSunDir), 0.0);

  vec3 zenith = mix(vec3(0.010, 0.020, 0.062), vec3(0.038, 0.098, 0.235), uDawn);
  vec3 mid = mix(vec3(0.085, 0.050, 0.135), vec3(0.22, 0.125, 0.27), uDawn);
  vec3 horizon = mix(vec3(0.54, 0.165, 0.13), vec3(1.55, 0.62, 0.20), uDawn);

  vec3 col = mix(horizon, mid, smoothstep(0.0, 0.26, h));
  col = mix(col, zenith, smoothstep(0.18, 0.82, h));

  // Broad dawn halo + three-stage sun bloom.
  col += vec3(1.0, 0.43, 0.14) * (pow(sd, 5.0) * 0.13 + pow(sd, 38.0) * 0.45 + pow(sd, 320.0) * 0.95) * mix(0.80, 1.25, uDawn);
  col += vec3(0.9, 0.31, 0.09) * pow(sd, 2.5) * exp(-h * 7.0) * 0.40;

  // Clouds: a warm streaked deck near the horizon, thin cold wisps above.
  vec2 cuv = d.xz / (h + 0.115) * 0.58;
  float band = smoothstep(0.012, 0.075, h) * (1.0 - smoothstep(0.12, 0.55, h));
  float c1 = fbm(cuv * vec2(1.05, 1.65) + vec2(uTime * 0.0045, 0.0));
  float c2 = fbm(cuv * vec2(2.4, 3.8) - vec2(uTime * 0.007, 1.7));
  float cloud = smoothstep(0.49, 0.74, c1 * 0.8 + c2 * 0.32) * band;
  cloud *= smoothstep(-0.02, 0.06, d.y);
  vec3 cloudShadow = mix(vec3(0.10, 0.07, 0.14), vec3(0.34, 0.17, 0.27), uDawn);
  vec3 cloudLit = mix(vec3(0.62, 0.30, 0.26), vec3(1.75, 0.78, 0.42), uDawn) * (0.35 + 0.95 * pow(sd, 1.6));
  col = mix(col, mix(cloudShadow, cloudLit, smoothstep(0.12, 0.85, c1)), cloud * 0.9);

  float wisp = smoothstep(0.56, 0.86, fbm(cuv * vec2(0.65, 3.2) + vec2(uTime * 0.002, 4.0)));
  wisp *= smoothstep(0.22, 0.55, h) * (1.0 - smoothstep(0.6, 0.95, h));
  col = mix(col, cloudLit * 0.75, wisp * 0.35);

  // The disc itself: hotter and larger as the dawn completes.
  float disc = smoothstep(0.99956, 0.99986, sd);
  col += vec3(3.4, 2.05, 1.05) * disc * (0.9 + 1.7 * uDawn);
  col += vec3(6.0, 4.2, 2.4) * smoothstep(0.99988, 0.99997, sd) * uDawn;

  // Below the horizon: deep haze for reflections / glancing views.
  if (d.y < 0.0) {
    col = mix(col, horizon * 0.72, smoothstep(0.0, -0.10, d.y));
  }

  col += vec3(1.0, 0.55, 0.28) * uFlash * (0.25 + pow(sd, 4.0));

  gl_FragColor = vec4(col, 1.0);
}
`

function ridgeGeometry(width, height, seed) {
  const shape = new THREE.Shape()
  shape.moveTo(-width / 2, 0)
  const points = 84
  for (let i = 0; i <= points; i++) {
    const t = i / points
    const env = Math.pow(Math.sin(Math.PI * t), 0.55)
    const wave =
      0.52 +
      0.26 * Math.sin(t * 9.3 + seed) +
      0.15 * Math.sin(t * 21.7 + seed * 2.3) +
      0.08 * Math.sin(t * 47 + seed * 3.7)
    const y = Math.max(0.04, wave) * env * height
    shape.lineTo(-width / 2 + t * width, y)
  }
  shape.lineTo(width / 2, 0)
  shape.closePath()
  return new THREE.ShapeGeometry(shape)
}

function makeBird() {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3))
  const mat = new THREE.LineBasicMaterial({ color: 0x1c1420, transparent: true, opacity: 0.85, fog: false })
  const line = new THREE.Line(geo, mat)
  line.frustumCulled = false
  return line
}

export function createBackdrop(scene) {
  const group = new THREE.Group()
  scene.add(group)

  const skyUniforms = {
    uSunDir: { value: new THREE.Vector3(0.16, 0.08, -0.96).normalize() },
    uDawn: { value: 0.15 },
    uTime: { value: 0 },
    uFlash: { value: 0 },
  }
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1800, 48, 32),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    }),
  )
  sky.frustumCulled = false
  sky.renderOrder = -10
  group.add(sky)

  const sunGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      opacity: 0.85,
      fog: false,
    }),
  )
  sunGlow.scale.setScalar(300)
  sunGlow.renderOrder = -9
  group.add(sunGlow)

  const islandMat = new THREE.MeshBasicMaterial({ color: 0x181320, fog: false })
  const island = new THREE.Mesh(ridgeGeometry(620, 92, 3.1), islandMat)
  island.position.set(-300, -4, -720)
  group.add(island)
  const island2 = new THREE.Mesh(ridgeGeometry(300, 42, 8.7), islandMat)
  island2.position.set(-40, -3, -860)
  group.add(island2)
  const island3 = new THREE.Mesh(ridgeGeometry(210, 26, 5.3), islandMat)
  island3.position.set(420, -3, -830)
  group.add(island3)

  const birds = []
  const birdMat = new THREE.LineBasicMaterial({ color: 0x221724, transparent: true, opacity: 0.8, fog: false })
  for (let i = 0; i < 9; i++) {
    const bird = makeBird()
    bird.material = birdMat
    bird.userData = {
      angle: Math.random() * Math.PI * 2,
      radius: 55 + Math.random() * 120,
      height: 16 + Math.random() * 42,
      phase: Math.random() * Math.PI * 2,
      speed: 0.09 + Math.random() * 0.08,
      size: 1.1 + Math.random() * 0.9,
    }
    birds.push(bird)
    group.add(bird)
  }

  const sunDir = new THREE.Vector3()
  const tmp = new THREE.Vector3()

  return {
    group,
    sunDir,
    skyUniforms,
    update(camera, time, dawn, flash, focus) {
      skyUniforms.uTime.value = time
      skyUniforms.uDawn.value = dawn
      skyUniforms.uFlash.value = flash
      sunDir.set(0.16, 0.02 + dawn * 0.22, -0.96).normalize()
      skyUniforms.uSunDir.value.copy(sunDir)

      group.position.set(camera.position.x, 0, camera.position.z)
      sunGlow.position.copy(sunDir).multiplyScalar(1450)
      sunGlow.material.opacity = 0.28 + dawn * 0.24 + flash * 0.5

      // Birds wheel around the player's neighbourhood.
      for (const bird of birds) {
        const d = bird.userData
        d.angle += d.speed * 0.016
        const x = focus.x + Math.cos(d.angle) * d.radius
        const z = focus.z + Math.sin(d.angle) * d.radius - 40
        const y = d.height + Math.sin(time * 0.5 + d.phase) * 3
        bird.position.set(x - group.position.x, y, z - group.position.z)
        bird.rotation.y = -d.angle + Math.PI / 2
        bird.rotation.z = Math.sin(time * 0.9 + d.phase) * 0.08
        const flap = Math.sin(time * 5.2 + d.phase) * 0.55
        const a = bird.geometry.attributes.position
        const s = d.size
        a.array[0] = -s * 1.5
        a.array[1] = flap * s + 0.12 * s
        a.array[2] = 0
        a.array[3] = 0
        a.array[4] = 0
        a.array[5] = 0
        a.array[6] = s * 1.5
        a.array[7] = flap * s + 0.12 * s
        a.array[8] = 0
        a.needsUpdate = true
        tmp.copy(bird.position)
      }
    },
  }
}

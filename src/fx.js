import * as THREE from 'three'
import { waterHeight } from './waves.js'

export function makeGlowTexture(inner = 'rgba(255,244,214,1)', mid = 'rgba(255,190,110,0.55)') {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, inner)
  grad.addColorStop(0.25, mid)
  grad.addColorStop(1, 'rgba(255,120,40,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const sprayVert = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(26.0, aSize * (200.0 / max(1.0, -mv.z)));
  gl_Position = projectionMatrix * mv;
}
`

const sprayFrag = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.06, d);
  gl_FragColor = vec4(vColor, a * vAlpha);
}
`

export class Spray {
  constructor(scene, max = 1100) {
    this.max = max
    this.count = 0
    this.pos = new Float32Array(max * 3)
    this.col = new Float32Array(max * 3)
    this.size = new Float32Array(max)
    this.alpha = new Float32Array(max)
    this.vel = new Float32Array(max * 3)
    this.life = new Float32Array(max)
    this.maxLife = new Float32Array(max)
    this.baseSize = new Float32Array(max)
    this.cursor = 0

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3))
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1))
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1))
    geo.setDrawRange(0, max)
    const mat = new THREE.ShaderMaterial({
      vertexShader: sprayVert,
      fragmentShader: sprayFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = false
    scene.add(this.points)
    this.geo = geo
  }

  spawn(x, y, z, vx, vy, vz, size, life, tint = 1) {
    const i = this.cursor
    this.cursor = (this.cursor + 1) % this.max
    const i3 = i * 3
    this.pos[i3] = x
    this.pos[i3 + 1] = y
    this.pos[i3 + 2] = z
    this.vel[i3] = vx
    this.vel[i3 + 1] = vy
    this.vel[i3 + 2] = vz
    this.life[i] = life
    this.maxLife[i] = life
    this.baseSize[i] = size
    this.size[i] = size
    this.alpha[i] = 0.95
    this.col[i3] = 1.0 * tint
    this.col[i3 + 1] = (0.94 + 0.05 * tint) * tint
    this.col[i3 + 2] = 0.86 * tint
  }

  carving(player, intensity = 1) {
    const { x, z } = player.pos
    const fx = Math.sin(player.heading)
    const fz = -Math.cos(player.heading)
    const rx = Math.cos(player.heading)
    const rz = Math.sin(player.heading)
    const side = Math.sign(player.turnVis) || 1
    const n = Math.round(3 + intensity * 8)
    for (let i = 0; i < n; i++) {
      const back = 0.4 + Math.random() * 1.6
      const spread = (Math.random() - 0.5) * 1.2
      this.spawn(
        x - fx * back + rx * (side * 0.5 + spread),
        waterHeight(x, z, player.time || 0) + 0.25 + Math.random() * 0.35,
        z - fz * back + rz * (side * 0.5 + spread),
        rx * side * (2 + Math.random() * 5) - fx * (2 + Math.random() * 3),
        3.2 + Math.random() * 5.8,
        rz * side * (2 + Math.random() * 5) - fz * (2 + Math.random() * 3),
        0.12 + Math.random() * 0.24,
        0.55 + Math.random() * 0.65,
      )
    }
  }

  hull(player, time) {
    const { x, z } = player.pos
    const fx = Math.sin(player.heading)
    const fz = -Math.cos(player.heading)
    const rx = Math.cos(player.heading)
    const rz = Math.sin(player.heading)
    for (const side of [-1, 1]) {
      const back = 0.6 + Math.random() * 1.4
      this.spawn(
        x - fx * back + rx * side * 0.55,
        waterHeight(x, z, time) + 0.15 + Math.random() * 0.25,
        z - fz * back + rz * side * 0.55,
        rx * side * (0.7 + Math.random() * 2.0) - fx * (1.5 + Math.random() * 2.4),
        1.8 + Math.random() * 3.0,
        rz * side * (0.7 + Math.random() * 2.0) - fz * (1.5 + Math.random() * 2.4),
        0.07 + Math.random() * 0.16,
        0.35 + Math.random() * 0.4,
      )
    }
  }

  burst(x, y, z, count, power, up = 5) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * power
      this.spawn(
        x + Math.cos(a) * r * 0.2,
        y + Math.random() * 0.5,
        z + Math.sin(a) * r * 0.2,
        Math.cos(a) * r,
        up * (0.35 + Math.random()),
        Math.sin(a) * r,
        0.14 + Math.random() * 0.3,
        0.55 + Math.random() * 0.8,
      )
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0
        this.size[i] = 0
        continue
      }
      this.life[i] -= dt
      const t = Math.max(0, this.life[i] / this.maxLife[i])
      const i3 = i * 3
      this.vel[i3 + 1] -= 15 * dt
      this.vel[i3] *= 1 - dt * 0.9
      this.vel[i3 + 2] *= 1 - dt * 0.9
      this.pos[i3] += this.vel[i3] * dt
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt
      this.alpha[i] = Math.min(1, t * 1.7) * 0.9
      this.size[i] = this.baseSize[i] * (0.45 + (1 - t) * 1.5)
    }
    this.geo.attributes.position.needsUpdate = true
    this.geo.attributes.aColor.needsUpdate = true
    this.geo.attributes.aSize.needsUpdate = true
    this.geo.attributes.aAlpha.needsUpdate = true
  }
}

const wakeVert = /* glsl */ `
attribute float aAlpha;
varying float vA;
varying vec3 vWorld;
void main() {
  vA = aAlpha;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`
const wakeFrag = /* glsl */ `
varying float vA;
varying vec3 vWorld;
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
void main() {
  if (vA <= 0.002) discard;
  float n = vnoise(vWorld.xz * 4.2) * 0.65 + vnoise(vWorld.xz * 11.0) * 0.35;
  float a = vA * smoothstep(0.28, 0.72, n + 0.22);
  if (a <= 0.004) discard;
  gl_FragColor = vec4(vec3(1.0, 0.95, 0.88), a);
}
`

export class Wake {
  constructor(scene, max = 100) {
    this.max = max
    this.samples = []
    this.timer = 0
    this.positions = new Float32Array(max * 2 * 3)
    this.alphas = new Float32Array(max * 2)
    this.geo = new THREE.BufferGeometry()
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1))
    const index = []
    for (let i = 0; i < max - 1; i++) {
      const a = i * 2
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    this.geo.setIndex(index)
    this.geo.setDrawRange(0, 0)
    const mat = new THREE.ShaderMaterial({
      vertexShader: wakeVert,
      fragmentShader: wakeFrag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.mesh = new THREE.Mesh(this.geo, mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 1
    scene.add(this.mesh)
  }

  clear() {
    this.samples.length = 0
    this.geo.setDrawRange(0, 0)
  }

  update(dt, player, time) {
    this.timer += dt
    if (!player.airborne && player.speed > 3 && this.timer > 0.035) {
      this.timer = 0
      this.samples.push({
        x: player.pos.x,
        z: player.pos.z,
        rx: Math.cos(player.heading),
        rz: Math.sin(player.heading),
        age: 0,
        speed: player.speed,
      })
      if (this.samples.length > this.max) this.samples.shift()
    }
    for (const s of this.samples) s.age += dt

    const n = this.samples.length
    for (let i = 0; i < n; i++) {
      const s = this.samples[i]
      const width = 0.08 + s.age * 0.10 + (i / Math.max(1, n)) * 0.07
      const y = waterHeight(s.x, s.z, time) + 0.09
      const a = i * 6
      this.positions[a] = s.x - s.rx * width
      this.positions[a + 1] = y
      this.positions[a + 2] = s.z - s.rz * width
      this.positions[a + 3] = s.x + s.rx * width
      this.positions[a + 4] = y
      this.positions[a + 5] = s.z + s.rz * width
      const fade = Math.max(0, 1 - s.age / 0.65) * (0.04 + Math.min(0.09, s.speed / 260))
      const b = i * 2
      this.alphas[b] = fade
      this.alphas[b + 1] = fade
    }
    this.geo.attributes.position.needsUpdate = true
    this.geo.attributes.aAlpha.needsUpdate = true
    this.geo.setDrawRange(0, Math.max(0, (n - 1) * 6))
  }
}

export class Orbs {
  constructor(scene, count = 8) {
    this.scene = scene
    this.list = []
    this.glowTex = makeGlowTexture()
    const gemGeo = new THREE.IcosahedronGeometry(0.46, 1)
    for (let i = 0; i < count; i++) {
      const group = new THREE.Group()
      const gem = new THREE.Mesh(
        gemGeo,
        new THREE.MeshBasicMaterial({ color: 0xffc46e, toneMapped: false }),
      )
      const core = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.72, 1),
        new THREE.MeshBasicMaterial({ color: 0xffb45e, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }),
      )
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.glowTex,
          color: 0xffc070,
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      )
      glow.scale.setScalar(2.2)
      group.add(gem, core, glow)
      group.userData.phase = Math.random() * Math.PI * 2
      this.list.push({ group, gem, active: false, spin: Math.random() * 6 })
      scene.add(group)
    }
  }

  spawn(orb, player) {
    const h = player.heading
    const dist = 42 + Math.random() * 85
    const lateral = (Math.random() - 0.5) * 78
    const fx = Math.sin(h)
    const fz = -Math.cos(h)
    const rx = Math.cos(h)
    const rz = Math.sin(h)
    const x = player.pos.x + fx * dist + rx * lateral
    const z = player.pos.z + fz * dist + rz * lateral
    orb.group.position.set(x, 0, z)
    orb.active = true
    orb.group.visible = true
  }

  reset(player) {
    for (const orb of this.list) {
      this.spawn(orb, player)
    }
  }

  update(dt, time, player) {
    const collected = []
    for (const orb of this.list) {
      if (!orb.active) continue
      const dx = orb.group.position.x - player.pos.x
      const dz = orb.group.position.z - player.pos.z
      const flat = Math.hypot(dx, dz)
      if (flat > 170 || dz * -Math.cos(player.heading) + dx * Math.sin(player.heading) < -30) {
        this.spawn(orb, player)
        continue
      }
      // Gentle magnet so sunsparks reward a line, not pixel-perfect aim.
      if (flat < 13) {
        const pull = (1 - flat / 13) * dt * 5.5
        orb.group.position.x -= dx * pull
        orb.group.position.z -= dz * pull
      }
      const y = waterHeight(orb.group.position.x, orb.group.position.z, time) + 2.0 + Math.sin(time * 1.6 + orb.group.userData.phase) * 0.35
      orb.group.position.y = y
      orb.gem.rotation.y += dt * 1.4
      orb.gem.rotation.x += dt * 0.7
      const pulse = 1 + Math.sin(time * 2 + orb.group.userData.phase) * 0.08
      orb.group.scale.setScalar(pulse)
      if (flat < 4.0 && Math.abs(player.pos.y - y) < 4.4) {
        collected.push(orb.group.position.clone())
        orb.active = false
        orb.group.visible = false
        this.spawn(orb, player)
      }
    }
    return collected
  }
}

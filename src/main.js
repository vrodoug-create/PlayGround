import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { createOcean } from './water.js'
import { createBackdrop } from './sky.js'
import { Player } from './player.js'
import { Spray, Wake, Orbs } from './fx.js'
import { AudioEngine } from './audio.js'
import { waterHeight } from './waves.js'

const $ = (id) => document.getElementById(id)
const canvas = $('scene')

let renderer
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
  })
} catch (error) {
  document.body.innerHTML = '<div style="display:grid;place-items:center;height:100%;font-family:system-ui;color:#fff;background:#08111c;text-align:center;padding:30px"><div><h1>WebGL is needed for Sunrise Swell</h1><p style="opacity:.7">Please try a current browser with hardware acceleration enabled.</p></div></div>'
  throw error
}

const PR = Math.min(window.devicePixelRatio || 1, window.innerWidth < 800 ? 1.25 : 1.5)
renderer.setPixelRatio(PR)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.02
renderer.shadowMap.enabled = false

const scene = new THREE.Scene()
scene.fog = new THREE.Fog(0x241a26, 120, 620)

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 4000)
camera.position.set(-4, 6.4, 26)

const composer = new EffectComposer(renderer)
composer.setPixelRatio(PR)
composer.setSize(window.innerWidth, window.innerHeight)
composer.addPass(new RenderPass(scene, camera))
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.55, 0.92)
composer.addPass(bloom)
composer.addPass(new OutputPass())

const hemi = new THREE.HemisphereLight(0x8fb8da, 0x12202a, 0.55)
scene.add(hemi)
const sunLight = new THREE.DirectionalLight(0xffb077, 2.2)
sunLight.position.set(30, 20, -60)
scene.add(sunLight)
scene.add(sunLight.target)
const rimLight = new THREE.DirectionalLight(0xff7a4d, 0.7)
rimLight.position.set(-30, 12, 40)
scene.add(rimLight)

const ocean = createOcean()
scene.add(ocean.mesh)
const backdrop = createBackdrop(scene)
const player = new Player(scene)
const spray = new Spray(scene)
const wake = new Wake(scene)
const orbs = new Orbs(scene, 8)
const audio = new AudioEngine()

const fmt = (n) => Math.round(n).toLocaleString('en-US')
const clamp = THREE.MathUtils.clamp

const game = {
  state: 'title',
  score: 0,
  best: Number(localStorage.getItem('sunrise-swell-best') || 0),
  mult: 1,
  dawn: 0.1,
  bestAir: 0,
  orbCount: 0,
  simTime: 0,
  runTime: 0,
  shake: 0,
  flash: 0,
  finaleT: 0,
  showedFinale: false,
  toastCool: 0,
  hintT: 0,
  camInitialized: false,
  paused: false,
}

const input = {
  turn: 0,
  smoothed: 0,
  kbLeft: false,
  kbRight: false,
  joystickX: 0,
  drag: 0,
  dragActive: false,
  dragStartX: 0,
  jumpPressed: false,
}

const els = {
  title: $('title'),
  finale: $('finale'),
  pause: $('pause'),
  hud: $('hud'),
  score: $('score'),
  mult: $('mult'),
  best: $('best'),
  dawnfill: $('dawnfill'),
  dawnsun: $('dawnsun'),
  dawnpct: $('dawnpct'),
  flowfill: $('flowfill'),
  speed: $('speed'),
  toast: $('toast'),
  toastT: $('toast').querySelector('.t'),
  toastS: $('toast').querySelector('.s'),
  hint: $('hint'),
  sound: $('sound'),
  pausebtn: $('pausebtn'),
  titleBest: $('titleBest'),
  screenGlow: $('screen-glow'),
}

els.best.textContent = fmt(game.best)
els.titleBest.textContent = fmt(game.best)

let toastTimeout = 0
function showToast(title, sub = '', cls = '') {
  els.toastT.textContent = title
  els.toastS.textContent = sub
  els.toast.className = 'show ' + cls
  clearTimeout(toastTimeout)
  toastTimeout = setTimeout(() => { els.toast.className = cls }, 1700)
}

function setScreen(el, show) {
  el.classList.toggle('hidden', !show)
}

function saveBest() {
  if (game.score > game.best) {
    game.best = Math.round(game.score)
    localStorage.setItem('sunrise-swell-best', String(game.best))
    els.best.textContent = fmt(game.best)
    els.titleBest.textContent = fmt(game.best)
  }
}

function beginRun() {
  audio.init()
  audio.setMuted(audio.muted)
  resetJoystick()
  player.reset()
  player.time = game.simTime
  orbs.reset(player)
  wake.clear()
  game.state = 'playing'
  game.paused = false
  game.score = 0
  game.mult = 1
  game.dawn = 0.1
  game.bestAir = 0
  game.orbCount = 0
  game.runTime = 0
  game.shake = 0
  game.flash = 0
  game.finaleT = 0
  game.showedFinale = false
  game.toastCool = 0
  setScreen(els.title, false)
  setScreen(els.finale, false)
  setScreen(els.pause, false)
  els.hud.classList.add('live')
  els.hint.classList.add('show')
  game.hintT = 7
  els.toast.className = ''
  showToast('Ride the dawn', 'Carve, launch, gather sunsparks')
}

function finishRun() {
  game.state = 'finale'
  game.finaleT = 0
  game.showedFinale = false
  game.flash = 1
  game.shake = 0.55
  saveBest()
  audio.dawnChord()
  spray.burst(player.pos.x, player.pos.y + 1.2, player.pos.z, 110, 12, 11)
  showToast('Sunrise', 'The light clears the horizon')
}

function showFinaleCard() {
  game.showedFinale = true
  els.fScore.textContent = fmt(game.score)
  els.fAir.textContent = game.bestAir.toFixed(1) + 's'
  els.fOrbs.textContent = String(game.orbCount)
  setScreen(els.finale, true)
  els.hud.classList.remove('live')
}

function togglePause(force) {
  if (game.state === 'title' || game.state === 'finale') return
  const shouldPause = force !== undefined ? force : !game.paused
  game.paused = shouldPause
  if (shouldPause) resetJoystick()
  setScreen(els.pause, shouldPause)
  els.hud.classList.toggle('live', !shouldPause)
  if (shouldPause) audio.setMotion(0, 0)
}

function toggleSound() {
  audio.init()
  audio.setMuted(!audio.muted)
  els.sound.classList.toggle('off', audio.muted)
  els.sound.setAttribute('aria-label', audio.muted ? 'Unmute sound' : 'Mute sound')
}

// ------- input -------
window.addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault()
  if (e.repeat) return
  switch (e.code) {
    case 'KeyA':
    case 'ArrowLeft':
      input.kbLeft = true
      break
    case 'KeyD':
    case 'ArrowRight':
      input.kbRight = true
      break
    case 'Space':
      if (game.state === 'playing' && !game.paused) input.jumpPressed = true
      break
    case 'KeyP':
    case 'Escape':
      if (game.state === 'playing') togglePause()
      break
    case 'Enter':
      if (game.state === 'title') beginRun()
      break
  }
})
window.addEventListener('keyup', (e) => {
  if (e.code === 'KeyA' || e.code === 'ArrowLeft') input.kbLeft = false
  if (e.code === 'KeyD' || e.code === 'ArrowRight') input.kbRight = false
})

const joystick = $('joystick')
const stick = $('stick')
let joystickPointer = null
function resetJoystick() {
  joystickPointer = null
  input.joystickX = 0
  stick.style.transform = 'translate(0px, 0px)'
}
joystick.addEventListener('pointerdown', (e) => {
  e.preventDefault()
  if (game.state !== 'playing' || game.paused || joystickPointer !== null) return
  joystickPointer = e.pointerId
  try { joystick.setPointerCapture(e.pointerId) } catch {}
  updateJoystick(e)
})
function updateJoystick(e) {
  if (e.pointerId !== joystickPointer) return
  const rect = joystick.getBoundingClientRect()
  const dx = e.clientX - (rect.left + rect.width / 2)
  const dy = e.clientY - (rect.top + rect.height / 2)
  const radius = 30
  const length = Math.hypot(dx, dy)
  const scale = length > radius ? radius / length : 1
  const x = dx * scale
  const y = dy * scale
  const axis = THREE.MathUtils.clamp(dx / radius, -1, 1)
  const deadZone = 0.08
  input.joystickX = Math.abs(axis) < deadZone ? 0 : Math.sign(axis) * (Math.abs(axis) - deadZone) / (1 - deadZone)
  stick.style.transform = `translate(${x}px, ${y}px)`
}
joystick.addEventListener('pointermove', updateJoystick)
for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  joystick.addEventListener(eventName, (e) => {
    if (e.pointerId === joystickPointer) resetJoystick()
  })
}
$('jump').addEventListener('pointerdown', (e) => {
  e.preventDefault()
  if (game.state === 'playing') input.jumpPressed = true
})

canvas.addEventListener('pointerdown', (e) => {
  if (game.state !== 'playing' || game.paused) return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  input.dragActive = true
  input.dragStartX = e.clientX
  try { canvas.setPointerCapture(e.pointerId) } catch {}
})
canvas.addEventListener('pointermove', (e) => {
  if (!input.dragActive) return
  input.drag = clamp((e.clientX - input.dragStartX) / 96, -1, 1)
})
function endDrag() {
  input.dragActive = false
  input.drag = 0
}
canvas.addEventListener('pointerup', endDrag)
canvas.addEventListener('pointercancel', endDrag)
canvas.addEventListener('contextmenu', (e) => e.preventDefault())

$('start').addEventListener('click', beginRun)
$('again').addEventListener('click', beginRun)
$('resume').addEventListener('click', () => togglePause(false))
els.sound.addEventListener('click', toggleSound)
els.pausebtn.addEventListener('click', () => togglePause())

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'playing' && !game.paused) togglePause(true)
})
window.addEventListener('blur', () => {
  if (game.state === 'playing' && !game.paused) togglePause(true)
})

function onResize() {
  const w = window.innerWidth
  const h = window.innerHeight
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
  composer.setSize(w, h)
  bloom.setSize(w, h)
}
window.addEventListener('resize', onResize)

// ------- camera -------
const lookTarget = new THREE.Vector3(0, 4, -60)
const camGoal = new THREE.Vector3()
const desiredLook = new THREE.Vector3()
const tmpV = new THREE.Vector3()

function updateCamera(dt, time) {
  if (game.state === 'title') {
    player.rider.visible = true
    const drift = time * 0.16
    camGoal.set(
      player.pos.x - 3.4 + Math.sin(drift) * 2.2,
      player.pos.y + 6.6 + Math.sin(time * 0.31) * 0.28,
      player.pos.z + 14.6 + Math.cos(drift) * 1.6,
    )
    const wh = waterHeight(camGoal.x, camGoal.z, time)
    const mid = waterHeight((camGoal.x + player.pos.x) / 2, (camGoal.z + player.pos.z) / 2, time)
    camGoal.y = Math.max(camGoal.y, wh + 2.0, mid + 1.8)
    camera.position.lerp(camGoal, 1 - Math.exp(-dt * 5))
    desiredLook.set(player.pos.x - 9.5, player.pos.y + 3.05, player.pos.z - 92)
    lookTarget.lerp(desiredLook, 1 - Math.exp(-dt * 4))
    camera.lookAt(lookTarget)
    camera.fov += (64 - camera.fov) * Math.min(1, dt * 3)
    camera.updateProjectionMatrix()
    camera.up.set(0, 1, 0)
    return
  }

  const finale = game.state === 'finale'
  const k = finale ? THREE.MathUtils.smoothstep(game.finaleT, 0, 3.2) : 0
  const fx = Math.sin(player.heading)
  const fz = -Math.cos(player.heading)
  const bob = Math.sin(time * 8.2) * 0.018 + (player.airborne ? 0.045 : 0)

  // Rider-eye camera: keep the deck at the bottom of frame and the swell ahead.
  player.rider.visible = false
  camGoal.set(player.pos.x, player.pos.y + 1.52 + bob, player.pos.z)
  camera.position.lerp(camGoal, 1 - Math.exp(-dt * (player.airborne ? 15 : 18)))
  const ahead = 22 + player.speed * 0.22
  desiredLook.set(
    player.pos.x + fx * ahead,
    player.pos.y + 0.18 + k * 1.8,
    player.pos.z + fz * ahead,
  )
  lookTarget.lerp(desiredLook, 1 - Math.exp(-dt * 14))
  camera.up.set(-Math.sin(player.turnVis) * 0.055, 1, 0).normalize()
  camera.lookAt(lookTarget)

  const targetFov = 70 + Math.min(10, (player.speed - 12) * 0.45) + k * 3
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3.4)
  camera.updateProjectionMatrix()

  if (game.shake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * game.shake * 0.8
    camera.position.y += (Math.random() - 0.5) * game.shake * 0.55
    camera.position.z += (Math.random() - 0.5) * game.shake * 0.8
  }
}

// ------- update -------
const clock = new THREE.Clock()
let hudClock = 0
let audioClock = 0
let sprayClock = 0
let lastOrbToast = -10

function handlePlayerEvents() {
  for (const ev of player.events) {
    if (ev.type === 'jump') {
      audio.whoosh(clamp(ev.strength / 14, 0.4, 1.4))
      spray.burst(player.pos.x, player.pos.y + 0.1, player.pos.z, 14, 3.4, 3.0)
      game.shake = Math.max(game.shake, 0.14)
    } else if (ev.type === 'land') {
      const power = clamp(ev.impact / 12, 0.4, 1.8)
      spray.burst(player.pos.x, player.pos.y + 0.15, player.pos.z, 22 + Math.round(ev.impact * 4), 4 + power * 3, 4 + power * 3)
      audio.splash(power)
      game.shake = Math.max(game.shake, clamp(ev.impact * 0.035, 0.08, 0.55))
      game.bestAir = Math.max(game.bestAir, ev.air)
      if (game.state !== 'playing') continue
      if (ev.clean) {
        const rotations = ev.rotations
        const label = rotations >= 1 ? `${rotations * 360}° SPIN` : 'CLEAN AIR'
        const pts = Math.round((150 + ev.air * 320 + rotations * 320) * game.mult)
        game.score += pts
        game.mult = Math.min(9, game.mult + 0.45 + rotations * 0.6)
        game.dawn = Math.min(1, game.dawn + 0.006 + rotations * 0.006)
        game.flash = Math.max(game.flash, 0.14)
        showToast(label, `+${fmt(pts)}  ·  ${ev.air.toFixed(1)}s air`)
        audio.chime(3)
      } else {
        game.mult = 1
        showToast('Wipeout', 'Square up before you land', 'bail')
        game.shake = Math.max(game.shake, 0.5)
      }
    }
  }
}

function update(dt, render = true) {
  game.simTime += dt
  const time = game.simTime
  const title = game.state === 'title'

  // input shaping
  let rawTurn = 0
  if (!title) {
    if (input.kbLeft) rawTurn -= 1
    if (input.kbRight) rawTurn += 1
    rawTurn += input.drag
    rawTurn += input.joystickX
  } else {
    rawTurn = Math.sin(time * 0.27) * 0.16
  }
  if (game.state === 'finale') rawTurn = 0
  rawTurn = clamp(rawTurn, -1, 1)
  input.turn += (rawTurn - input.turn) * Math.min(1, dt * 12)

  player.time = time
  player.update(dt, time, {
    turn: input.turn,
    jumpPressed: input.jumpPressed && game.state === 'playing',
  })
  input.jumpPressed = false

  if (!title) {
    handlePlayerEvents()

    if (game.state === 'playing') {
      game.runTime += dt
      const collected = orbs.update(dt, time, player)
      for (const p of collected) {
        const pts = Math.round(80 * game.mult)
        game.score += pts
        game.dawn = Math.min(1, game.dawn + 0.05)
        game.mult = Math.min(9, game.mult + 0.32)
        game.orbCount++
        game.flash = Math.max(game.flash, 0.08)
        spray.burst(p.x, p.y, p.z, 46, 7, 5)
        audio.chime(game.orbCount)
        if (time - lastOrbToast > 1.6) {
          showToast('Sunspark', `+${fmt(pts)}  ·  dawn +5%`)
          lastOrbToast = time
        }
      }
      game.score += dt * (9 + player.speed * 1.15) * game.mult * 0.4
      game.dawn += dt * (0.0009 + player.flow * 0.0019)
      game.mult = Math.max(1, game.mult - dt * 0.06)
      if (game.dawn >= 1) {
        game.dawn = 1
        finishRun()
      }
    } else if (game.state === 'finale') {
      game.finaleT += dt
      if (!game.showedFinale && game.finaleT > 2.7) showFinaleCard()
    }
  } else {
    orbs.update(dt, time, player)
  }

  // spray kicked up by carving, plus a fine hull wake
  sprayClock += dt
  if (sprayClock > 0.045) {
    sprayClock = 0
    if (!player.airborne && player.speed > 9 && game.state !== 'finale') {
      if (player.carve > 0.12) spray.carving(player, player.carve)
      if (Math.random() < 0.8) spray.hull(player, time)
    }
  }
  spray.update(dt)
  wake.update(dt, player, time)

  if (game.state === 'playing' || game.state === 'title') {
    game.hintT = Math.max(0, game.hintT - dt)
    if (game.hintT === 0) els.hint.classList.remove('show')
  }
  game.shake = Math.max(0, game.shake - dt * 1.8)
  game.flash = Math.max(0, game.flash - dt * 1.6)

  // visual dawn (title keeps a warm pre-dawn look)
  const visualDawn = title ? 0.17 : 0.1 + game.dawn * 0.9
  const sunDir = backdrop.sunDir
  backdrop.update(camera, time, visualDawn, game.flash, player.pos)
  ocean.uniforms.uSunDir.value.copy(sunDir)
  ocean.uniforms.uCam.value.copy(camera.position)
  ocean.update(player.pos, time, visualDawn, player.speed)

  sunLight.position.copy(player.pos).addScaledVector(sunDir, 70).add(tmpV.set(0, 16, 0))
  sunLight.target.position.copy(player.pos)
  sunLight.intensity = 0.9 + visualDawn * 2.5
  sunLight.color.setRGB(1.0, 0.62 + visualDawn * 0.12, 0.36 + visualDawn * 0.1)
  hemi.intensity = 0.3 + visualDawn * 0.4
  rimLight.intensity = 0.35 + visualDawn * 0.55
  els.screenGlow.style.opacity = String(0.45 + visualDawn * 0.5)

  updateCamera(dt, time)

  bloom.strength = 0.42 + visualDawn * 0.24 + game.flash * 1.15
  bloom.threshold = 0.94 - game.flash * 0.22

  // sound follows the ride
  audioClock += dt
  if (audioClock > 0.14) {
    audioClock = 0
    audio.setMotion(game.paused ? 0 : player.speed, player.flow)
  }

  // HUD
  hudClock += dt
  if (hudClock > 0.06) {
    hudClock = 0
    els.score.textContent = fmt(game.score)
    els.mult.innerHTML = `×${game.mult.toFixed(1)} <span>Style</span>`
    els.best.textContent = fmt(game.best)
    const pct = game.state === 'title' ? 0.17 : game.dawn
    els.dawnfill.style.width = `${(pct * 100).toFixed(1)}%`
    els.dawnsun.style.left = `${(pct * 100).toFixed(1)}%`
    els.dawnpct.textContent = `${Math.round(pct * 100)}%`
    els.flowfill.style.width = `${(player.flow * 100).toFixed(0)}%`
    els.speed.textContent = `${(player.speed * 1.94).toFixed(0)} kn`
  }

  if (render) composer.render()
}

// Opening camera pose.
player.pos.y = waterHeight(player.pos.x, player.pos.z, 0) + 0.18
camera.position.set(player.pos.x - 4, player.pos.y + 5.4, player.pos.z + 16)
lookTarget.set(player.pos.x - 9, player.pos.y + 3.2, player.pos.z - 90)
camera.lookAt(lookTarget)

function frame() {
  const raw = Math.min(clock.getDelta(), 0.05)
  if (game.paused) {
    composer.render()
    requestAnimationFrame(frame)
    return
  }
  let dt = raw
  if (game.state === 'finale' && game.finaleT < 1.1) dt = raw * 0.45
  update(dt)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

window.__sunrise = {
  game,
  player,
  camera,
  renderer,
  input,
  tick(seconds) {
    const steps = Math.max(1, Math.ceil(seconds * 60))
    for (let i = 0; i < steps; i++) update(1 / 60, false)
    composer.render()
  },
}

const resizeObserver = new ResizeObserver(onResize)
resizeObserver.observe(document.body)

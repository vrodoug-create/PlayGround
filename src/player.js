import * as THREE from 'three'
import { waterHeight, waterGradient } from './waves.js'

const TAU = Math.PI * 2
const UP = new THREE.Vector3(0, 1, 0)

function capsuleBetween(a, b, radius, material) {
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = dir.length()
  const geo = new THREE.CapsuleGeometry(radius, Math.max(0.01, len - radius * 2), 4, 10)
  const mesh = new THREE.Mesh(geo, material)
  mesh.position.copy(a).addScaledVector(dir, 0.5)
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize())
  return mesh
}

function buildRider() {
  const rider = new THREE.Group()
  const suit = new THREE.MeshStandardMaterial({ color: 0x141c2a, roughness: 0.62, metalness: 0.08 })
  const accent = new THREE.MeshStandardMaterial({ color: 0xff7a4d, roughness: 0.45, metalness: 0.1 })
  const skin = new THREE.MeshStandardMaterial({ color: 0xc98f6b, roughness: 0.75 })
  const hair = new THREE.MeshStandardMaterial({ color: 0x241716, roughness: 0.9 })

  const hip = new THREE.Vector3(0, 0.66, 0.18)
  const chest = new THREE.Vector3(0, 1.16, -0.02)
  const neck = new THREE.Vector3(0, 1.28, -0.08)

  // Torso leaning into the ride.
  rider.add(capsuleBetween(hip, chest, 0.17, suit))
  // Accent band across the chest.
  const band = capsuleBetween(new THREE.Vector3(-0.17, 1.03, -0.03), new THREE.Vector3(0.17, 1.03, -0.03), 0.055, accent)
  rider.add(band)
  const hips = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), suit)
  hips.position.copy(hip)
  hips.scale.set(1.2, 0.8, 0.9)
  rider.add(hips)

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 16, 12), skin)
  head.position.set(0, 1.44, -0.12)
  rider.add(head)
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.162, 16, 12, 0, TAU, 0, Math.PI * 0.58), hair)
  cap.position.copy(head.position)
  cap.rotation.x = -0.25
  rider.add(cap)

  const shoulderL = new THREE.Vector3(-0.19, 1.15, -0.02)
  const shoulderR = new THREE.Vector3(0.19, 1.15, -0.02)
  const handL = new THREE.Vector3(-0.52, 0.86, 0.16)
  const handR = new THREE.Vector3(0.52, 0.9, 0.1)
  rider.add(capsuleBetween(shoulderL, handL, 0.065, suit))
  rider.add(capsuleBetween(shoulderR, handR, 0.065, suit))
  for (const p of [handL, handR]) {
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 8), skin)
    hand.position.copy(p)
    rider.add(hand)
  }

  const kneeL = new THREE.Vector3(-0.28, 0.56, -0.16)
  const kneeR = new THREE.Vector3(0.28, 0.56, -0.16)
  const footL = new THREE.Vector3(-0.24, 0.06, 0.2)
  const footR = new THREE.Vector3(0.24, 0.06, 0.24)
  rider.add(capsuleBetween(new THREE.Vector3(-0.15, 0.65, 0.15), kneeL, 0.09, suit))
  rider.add(capsuleBetween(new THREE.Vector3(0.15, 0.65, 0.15), kneeR, 0.09, suit))
  rider.add(capsuleBetween(kneeL, footL, 0.08, suit))
  rider.add(capsuleBetween(kneeR, footR, 0.08, suit))
  const boardShorts = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), accent)
  boardShorts.position.set(0, 0.7, 0.14)
  boardShorts.scale.set(1.25, 0.72, 1.0)
  rider.add(boardShorts)

  rider.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false
      o.receiveShadow = false
    }
  })
  return rider
}

function buildBoard() {
  const group = new THREE.Group()
  const boardMat = new THREE.MeshStandardMaterial({ color: 0xff5c33, roughness: 0.32, metalness: 0.14 })
  const deckMat = new THREE.MeshStandardMaterial({ color: 0xffe3bd, roughness: 0.5, metalness: 0.02 })
  const railMat = new THREE.MeshStandardMaterial({ color: 0xffb27a, emissive: 0x43180b, emissiveIntensity: 0.8, roughness: 0.35 })

  const boardGeo = new THREE.CapsuleGeometry(0.43, 2.05, 6, 20)
  boardGeo.rotateX(Math.PI / 2)
  boardGeo.scale(1.0, 0.24, 1.12)
  const board = new THREE.Mesh(boardGeo, boardMat)
  board.position.y = 0.1
  group.add(board)

  const deckGeo = new THREE.CapsuleGeometry(0.17, 1.9, 4, 18)
  deckGeo.rotateX(Math.PI / 2)
  deckGeo.scale(1.0, 0.09, 1.0)
  const deck = new THREE.Mesh(deckGeo, deckMat)
  deck.position.y = 0.205
  group.add(deck)

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 2.2), railMat)
  stripe.position.set(0, 0.245, 0)
  group.add(stripe)
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.02, 0.08), railMat)
  tail.position.set(0, 0.245, 0.72)
  group.add(tail)

  // Skeg
  const finShape = new THREE.Shape()
  finShape.moveTo(0, 0)
  finShape.lineTo(0.14, 0)
  finShape.lineTo(-0.02, 0.38)
  finShape.closePath()
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.025, bevelEnabled: false })
  const fin = new THREE.Mesh(finGeo, railMat)
  fin.position.set(0.0, -0.02, 1.1)
  fin.rotation.y = Math.PI / 2
  group.add(fin)

  return group
}

export class Player {
  constructor(scene) {
    this.root = new THREE.Group()
    this.board = buildBoard()
    this.rider = buildRider()
    this.rider.position.set(0, 0.22, 0.18)
    this.root.add(this.board, this.rider)
    scene.add(this.root)

    this.pos = new THREE.Vector3(0, 0, 12)
    this.heading = 0
    this.speed = 17
    this.vy = 0
    this.airborne = false
    this.airTime = 0
    this.spin = 0
    this.flow = 0.35
    this.turnVis = 0
    this.pitchVis = 0
    this.rollVis = 0
    this.jumpCooldown = 0
    this.popCooldown = 0
    this.prevSlopeAhead = 0
    this.landed = null
    this.jumped = false
    this.carve = 0
    this.wasAir = false
    this.events = []
    this.grad = { x: 0, z: 0 }
    this.normal = new THREE.Vector3(0, 1, 0)
    this.reset()
  }

  reset() {
    this.pos.set(0, 0, 12)
    this.pos.y = waterHeight(this.pos.x, this.pos.z, 0) + 0.18
    this.heading = 0
    this.speed = 17
    this.vy = 0
    this.airborne = false
    this.airTime = 0
    this.spin = 0
    this.flow = 0.35
    this.turnVis = 0
    this.pitchVis = 0
    this.rollVis = 0
    this.jumpCooldown = 0
    this.popCooldown = 0
    this.prevSlopeAhead = 0
    this.landed = null
    this.jumped = false
    this.carve = 0
    this.events.length = 0
    this.root.rotation.set(0, 0, 0)
    this.root.position.copy(this.pos)
  }

  get forward() {
    return { x: Math.sin(this.heading), z: -Math.cos(this.heading) }
  }

  get right() {
    return { x: Math.cos(this.heading), z: Math.sin(this.heading) }
  }

  update(dt, time, input) {
    this.events.length = 0
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt)
    this.popCooldown = Math.max(0, this.popCooldown - dt)

    const surfY = waterHeight(this.pos.x, this.pos.z, time)
    waterGradient(this.pos.x, this.pos.z, time, this.grad)
    const fx = Math.sin(this.heading)
    const fz = -Math.cos(this.heading)
    const rx = Math.cos(this.heading)
    const rz = Math.sin(this.heading)
    const turn = input.turn || 0

    this.turnVis += (turn - this.turnVis) * Math.min(1, dt * 7)

    if (!this.airborne) {
      const slope = this.grad.x * fx + this.grad.z * fz

      // Downhill pull and drag: the swell does most of the work.
      this.speed += -slope * 52 * dt
      this.speed += (20 - this.speed) * 0.30 * dt
      this.speed += this.flow * 3.4 * dt
      this.speed -= Math.abs(turn) * this.speed * 0.10 * dt
      this.speed -= this.speed * this.speed * 0.0009 * dt
      this.speed = THREE.MathUtils.clamp(this.speed, 12, 34)

      this.heading += turn * (1.05 + this.speed * 0.03) * dt

      this.pos.x += Math.sin(this.heading) * this.speed * dt
      this.pos.z += -Math.cos(this.heading) * this.speed * dt
      this.pos.y = surfY + 0.18

      // Flow builds by carving clean arcs across the face.
      if (Math.abs(turn) > 0.22 && this.speed > 11) {
        this.flow += dt * 0.25
        this.carve = Math.min(1, this.carve + dt * 2.2)
      } else {
        this.flow -= dt * 0.11
        this.carve = Math.max(0, this.carve - dt * 1.4)
      }
      this.flow = THREE.MathUtils.clamp(this.flow, 0, 1)

      // Crest launches: the lip throws us over the top, and steepening faces
      // give a kicker to boost off. Both keep the ride airborne and playful.
      const ahead = 2.4
      const slopeAhead = (waterHeight(this.pos.x + fx * ahead, this.pos.z + fz * ahead, time) - surfY) / ahead
      const crossedCrest = this.prevSlopeAhead > 0.05 && slopeAhead < 0.03 && this.speed > 14.5
      const steepKicker = this.prevSlopeAhead > -0.12 && slopeAhead < -0.17 && this.speed > 21
      if (this.popCooldown <= 0 && (crossedCrest || steepKicker)) {
        this.launch(7.0 + Math.min(7.5, this.speed * 0.2) + (steepKicker ? 1.4 : 0), true)
      }
      this.prevSlopeAhead = slopeAhead

      if (input.jumpPressed && this.jumpCooldown <= 0) {
        this.launch(9.0 + Math.max(0, -slope) * 9, false)
      }
    } else {
      // Airborne: keep momentum, spin the board, gravity brings us home.
      this.pos.x += Math.sin(this.heading) * this.speed * dt
      this.pos.z += -Math.cos(this.heading) * this.speed * dt
      this.pos.y += this.vy * dt
      this.vy -= 24 * dt
      this.speed -= 0.7 * dt
      this.spin += turn * 4.4 * dt
      this.heading += turn * 0.45 * dt
      this.airTime += dt

      if (this.pos.y <= surfY + 0.16 && this.vy < 0) {
        this.land(surfY)
      }
    }

    this.root.position.copy(this.pos)
    this.updateVisual(dt, time, turn, surfY)
  }

  launch(vy, auto) {
    this.airborne = true
    this.airTime = 0
    this.vy = vy
    this.spin = 0
    this.jumpCooldown = 0.55
    this.popCooldown = auto ? 2.4 : 0.35
    this.flow = Math.max(0, this.flow - 0.12)
    this.jumped = true
    this.events.push({ type: 'jump', auto, strength: vy })
  }

  land(surfY) {
    const deg = Math.abs(this.spin)
    const rotations = Math.floor((deg + 0.6) / TAU)
    const rem = Math.abs(deg - Math.round(deg / TAU) * TAU)
    const clean = rem < 0.9
    const impact = Math.abs(this.vy)
    const air = this.airTime

    this.airborne = false
    this.vy = 0
    this.spin = 0
    this.pos.y = surfY + 0.18
    this.airTime = 0
    this.wasAir = true

    if (clean) {
      this.speed += 2.2 + Math.min(4, rotations * 0.9)
      this.flow = Math.min(1, this.flow + 0.22)
    } else {
      this.speed *= 0.52
      this.flow = 0
    }
    this.events.push({ type: 'land', clean, rotations, air, impact })
  }

  updateVisual(dt, time, turn, surfY) {
    const fx = Math.sin(this.heading)
    const fz = -Math.cos(this.heading)
    const rx = Math.cos(this.heading)
    const rz = Math.sin(this.heading)

    let pitch
    let roll
    if (this.airborne) {
      pitch = THREE.MathUtils.clamp(this.vy * 0.035, -0.45, 0.5) - 0.05
      roll = turn * 0.42
      this.pitchVis += (pitch - this.pitchVis) * Math.min(1, dt * 6)
      this.rollVis += (roll - this.rollVis) * Math.min(1, dt * 6)
      this.root.rotation.set(this.pitchVis, this.heading + this.spin, this.rollVis, 'YXZ')
    } else {
      const hF = waterHeight(this.pos.x + fx * 1.5, this.pos.z + fz * 1.5, time)
      const hB = waterHeight(this.pos.x - fx * 1.5, this.pos.z - fz * 1.5, time)
      const hR = waterHeight(this.pos.x + rx * 0.9, this.pos.z + rz * 0.9, time)
      const hL = waterHeight(this.pos.x - rx * 0.9, this.pos.z - rz * 0.9, time)
      pitch = Math.atan2(hF - hB, 3.0)
      roll = Math.atan2(hR - hL, 1.8) - turn * 0.30
      this.pitchVis += (pitch - this.pitchVis) * Math.min(1, dt * 9)
      this.rollVis += (roll - this.rollVis) * Math.min(1, dt * 8)
      this.root.rotation.set(this.pitchVis, this.heading, this.rollVis, 'YXZ')
    }

    const crouch = this.airborne ? 0.55 : 0.16 + (this.speed / 34) * 0.24 + this.carve * 0.1
    this.rider.position.y = 0.22 - crouch * 0.24
    this.rider.rotation.x = -0.12 - crouch * 0.34
    this.rider.rotation.z = -this.turnVis * 0.24
    this.rider.rotation.y = this.turnVis * 0.12
  }

  samplePoint(x, z, time) {
    waterHeight(x, z, time)
  }
}

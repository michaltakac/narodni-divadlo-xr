// Build the model once per page (React mounts twice in development), give it its director, and make the
// physics world people walk in: Rapier (the engine that comes with the project's @react-three/rapier) with
// colliders from the model's geometry. Nothing falls or rolls here, so the world is never stepped: it is only
// asked what stops a walking person and what is under their feet.
import RAPIER from '@dimforge/rapier3d-compat'
import { buildTheatre } from './model.js'
import { buildColliders } from './colliders.js'
import { createDirector } from './director.js'
import { player, useApp } from './app.js'

export const BODY = { radius: 0.25, half: 0.6 } // the walking capsule: 1.7 m tall, half a metre wide

let building = null
export function loadTheatre() {
  building ??= (async () => {
    const [theatre] = await Promise.all([buildTheatre({ onProgress: (progress) => useApp.setState({ progress: progress * 0.9 }) }), RAPIER.init()])
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    const colliders = buildColliders(theatre, RAPIER, world)
    const body = world.createCollider(RAPIER.ColliderDesc.capsule(BODY.half, BODY.radius))
    const controller = world.createCharacterController(0.02)
    controller.enableAutostep(0.42, 0.2, false) // steps, kerbs, the rows of the gallery
    controller.enableSnapToGround(0.42)
    controller.setMaxSlopeClimbAngle(Math.PI * 0.3)
    controller.setApplyImpulsesToDynamicBodies(false)
    world.updateSceneQueries()
    const probe = new RAPIER.Capsule(BODY.half - 0.04, BODY.radius - 0.04) // a little smaller: touching is not overlapping
    theatre.physics = { rapier: RAPIER, world, colliders, body, controller, probe }
    useApp.setState({ theatre, director: createDirector(theatre), progress: 1 })
    if (import.meta.env?.DEV) Object.assign(window, { __theatre: theatre, __player: player, __app: useApp }) // for the console and tests
    return theatre
  })().catch((error) => { console.error(error); useApp.setState({ error }) })
  return building
}

// A small stand-in for 'three/tsl' on the WebGL renderer.
// Lukáš Eršil's model describes its effects (night floodlight, X-ray rim, flowing ducts, flames, sky) as TSL
// node expressions for the WebGPU renderer. This project renders with WebGL (the safe choice in WebXR), so the
// same expressions are turned into GLSL here and spliced into the classic materials by lib/theatre/webgpu.js.
// vite.config.js points 'three/tsl' at this file, so his source runs unchanged. Only what the model uses exists.
import { Color } from 'three'

const lit = (v) => {
  const s = String(v)
  return /[.e]/.test(s) ? s : s + '.0'
}

export class Node {
  /** build(ctx) → GLSL expression; ctx collects the uniforms, samplers and varyings the expression needs. */
  constructor(build) { this.build = build }
  mul(o) { return bin('*', this, o) }
  add(o) { return bin('+', this, o) }
  sub(o) { return bin('-', this, o) }
  div(o) { return bin('/', this, o) }
  pow(o) { return call('pow', this, o) }
}
for (const s of ['x', 'y', 'z', 'w', 'r', 'g', 'b', 'xy', 'xz', 'xyz', 'rgb']) {
  Object.defineProperty(Node.prototype, s, { get() { return new Node((c) => `(${this.build(c)}).${s}`) } })
}

const node = (v) => (v instanceof Node ? v : new Node(() => lit(v)))
const bin = (op, a, b) => { a = node(a); b = node(b); return new Node((c) => `(${a.build(c)} ${op} ${b.build(c)})`) }
const call = (fn, ...args) => { args = args.map(node); return new Node((c) => `${fn}(${args.map((a) => a.build(c)).join(', ')})`) }
const feature = (name, glsl) => new Node((c) => { c.features.add(name); return glsl })

let uniforms = 0
/** A number the app changes at run time: `.value` is read by every material that uses it. */
export function uniform(value) {
  const name = `ndU${uniforms++}`
  const n = new Node((c) => { c.uniforms[name] = n; return name })
  n.value = value
  return n
}

export const time = uniform(0)
/** Advance the shared shader clock (seconds). Called once a frame by the theatre. */
export const setTime = (t) => { time.value = t }

export const float = (v) => (v instanceof Node ? call('float', v) : node(v))
export const vec2 = (...a) => call('vec2', ...a)
export const vec3 = (...a) => call('vec3', ...a)
export const color = (hex) => { const c = new Color(hex); return vec3(c.r, c.g, c.b) }

export const mix = (a, b, t) => call('mix', a, b, t)
export const clamp = (v, a = 0, b = 1) => call('clamp', v, a, b)
export const smoothstep = (a, b, v) => call('smoothstep', a, b, v)
export const dot = (a, b) => call('dot', a, b)
export const abs = (a) => call('abs', a)
export const fract = (a) => call('fract', a)
export const sin = (a) => call('sin', a)
export const length = (a) => call('length', a)
export const normalize = (a) => call('normalize', a)
export const oneMinus = (a) => bin('-', 1, a)
export const sub = (a, b) => bin('-', a, b)
export const hash = (a) => { a = node(a); return new Node((c) => { c.features.add('hash'); return `ndHash(${a.build(c)})` }) }

export const uv = () => feature('uv', 'vNdUv')
export const positionWorld = feature('world', 'vNdWorld')
export const positionLocal = feature('local', 'vNdLocal')
export const normalView = feature('normal', 'normalize(vNdNormal)')
export const positionViewDirection = feature('view', 'normalize(vNdView)')
export const instanceIndex = feature('instance', 'vNdInstance')

export function texture(map, uvNode = uv()) {
  return new Node((c) => {
    let i = c.textures.indexOf(map)
    if (i < 0) i = c.textures.push(map) - 1
    return `texture2D(ndTex${i}, ${uvNode.build(c)})`
  })
}

// ---------------------------------------------------------------- GLSL for a material's nodes
const VARYINGS = {
  uv: ['vec2 vNdUv', 'vNdUv = uv;'],
  world: ['vec3 vNdWorld', `vec4 ndWorld = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      ndWorld = instanceMatrix * ndWorld;
    #endif
    vNdWorld = (modelMatrix * ndWorld).xyz;`],
  local: ['vec3 vNdLocal', 'vNdLocal = position;'],
  normal: ['vec3 vNdNormal', `vec3 ndNormal = normal;
    #ifdef USE_INSTANCING
      ndNormal = mat3(instanceMatrix) * ndNormal;
    #endif
    vNdNormal = normalMatrix * ndNormal;`],
  view: ['vec3 vNdView', 'vNdView = -mvPosition.xyz;'],
  instance: ['float vNdInstance', 'vNdInstance = float(gl_InstanceID);'],
}

/** Compile the node slots of a material ({ emissive, color, opacity }) into shader pieces. */
export function compileNodes(slots) {
  const ctx = { uniforms: {}, textures: [], features: new Set() }
  const out = {}
  for (const key of Object.keys(slots)) if (slots[key]) out[key] = slots[key].build(ctx)
  let vertexHead = '', vertexBody = '', fragmentHead = ''
  for (const f of ctx.features) {
    if (!VARYINGS[f]) continue
    const [decl, assign] = VARYINGS[f]
    const flat = f === 'instance' ? 'flat ' : ''
    vertexHead += `${flat}varying ${decl};\n`
    fragmentHead += `${flat}varying ${decl};\n`
    vertexBody += assign + '\n'
  }
  for (const name of Object.keys(ctx.uniforms)) fragmentHead += `uniform float ${name};\n`
  ctx.textures.forEach((_, i) => { fragmentHead += `uniform sampler2D ndTex${i};\n` })
  if (ctx.features.has('hash')) fragmentHead += 'float ndHash(float n) { return fract(sin(n * 12.9898 + 78.233) * 43758.5453); }\n'
  const uniformsOut = { ...ctx.uniforms }
  ctx.textures.forEach((t, i) => { uniformsOut[`ndTex${i}`] = { value: t } })
  return { ...out, vertexHead, vertexBody, fragmentHead, uniforms: uniformsOut, key: JSON.stringify(out) + vertexBody }
}

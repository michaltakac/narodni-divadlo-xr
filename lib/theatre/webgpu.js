// A stand-in for 'three/webgpu' on the WebGL renderer (vite.config.js points the import here).
// Everything is plain three.js; the two node materials the model uses become the classic materials with their
// node slots (emissiveNode, colorNode, opacityNode) compiled to GLSL by lib/theatre/tsl.js.
import { MeshBasicMaterial, MeshStandardMaterial } from 'three'
import { compileNodes } from './tsl.js'

export * from 'three'

function withNodes(Base) {
  return class extends Base {
    constructor(params) {
      super(params)
      this.emissiveNode = null
      this.colorNode = null
      this.opacityNode = null
      this._nd = null
    }

    nodes() {
      const c = this._nd
      if (c && c.e === this.emissiveNode && c.c === this.colorNode && c.o === this.opacityNode) return c.out
      const out = this.emissiveNode || this.colorNode || this.opacityNode
        ? compileNodes({ emissive: this.emissiveNode, color: this.colorNode, opacity: this.opacityNode })
        : null
      this._nd = { e: this.emissiveNode, c: this.colorNode, o: this.opacityNode, out }
      return out
    }

    customProgramCacheKey() { return this.nodes()?.key ?? '' }

    onBeforeCompile(shader) {
      const n = this.nodes()
      if (!n) return
      Object.assign(shader.uniforms, n.uniforms)
      shader.vertexShader = n.vertexHead + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n${n.vertexBody}`)
      let f = n.fragmentHead + shader.fragmentShader
      if (n.color || n.opacity) {
        f = f.replace('#include <color_fragment>', `#include <color_fragment>
          ${n.color ? `diffuseColor.rgb = vec3(${n.color});` : ''}
          ${n.opacity ? `diffuseColor.a = ${n.opacity};` : ''}`)
      }
      if (n.emissive) f = f.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n totalEmissiveRadiance = vec3(${n.emissive});`)
      shader.fragmentShader = f
    }

    copy(source) {
      super.copy(source)
      this.emissiveNode = source.emissiveNode ?? null
      this.colorNode = source.colorNode ?? null
      this.opacityNode = source.opacityNode ?? null
      return this
    }
  }
}

export const MeshStandardNodeMaterial = withNodes(MeshStandardMaterial)
export const MeshBasicNodeMaterial = withNodes(MeshBasicMaterial)

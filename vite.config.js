import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import graspableSource from './graspable-source.js'

const here = (path) => fileURLToPath(new URL(path, import.meta.url))

// Dev server only: tag R3F elements with their source location for the Graspable preview.
export default defineConfig(({ command }) => ({
  plugins: [react(command === 'serve' ? { babel: { plugins: [graspableSource] } } : {})],
  resolve: {
    // One copy of React for everything, including the dev-only headset panel, whatever the package manager installed.
    dedupe: ['react', 'react-dom'],
    // Lukáš Eršil's model (lib/nd) is written for three.js's WebGPU renderer and its node materials. This app
    // renders with WebGL (one renderer for screen and headset), so his two imports resolve to small stand-ins
    // that give the same materials on WebGL and his source stays as he wrote it.
    alias: [
      { find: /^three\/webgpu$/, replacement: here('./lib/theatre/webgpu.js') },
      { find: /^three\/tsl$/, replacement: here('./lib/theatre/tsl.js') },
    ],
  },
  // Physics must not be pre-bundled: when the dev server meets a new package while it runs, it
  // re-bundles, and the physics engine then exists twice (one copy never started) until a restart.
  // Only this app is scanned for dependencies: reference/ holds Lukáš's original page, which is not part of it.
  optimizeDeps: { exclude: ['@react-three/rapier'], entries: ['index.html'] },
}))

// Graspable dev-only Babel plugin (see vite.config.js; never part of production builds).
// Tags every React Three Fiber element with where it is written — `userData.graspableSource =
// "App.jsx:26:5-33:11"` — so the Graspable preview can map an Alt-clicked object back to its JSX,
// and the editor cursor to the object. HTML elements and <primitive> are left alone.
import path from 'node:path'

const HTML = new Set('a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup option output p param picture pre progress q rp rt ruby s samp script search section select slot small source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track u ul var video wbr svg path circle ellipse rect line polyline polygon g defs text tspan use symbol mask pattern image foreignObject primitive'.split(' '))

export default function graspableSource({ types: t }) {
  return {
    name: 'graspable-source',
    visitor: {
      JSXOpeningElement(p, state) {
        const n = p.node.name
        const loc = p.parent.loc
        if (n.type !== 'JSXIdentifier' || !/^[a-z]/.test(n.name) || HTML.has(n.name) || !loc || !state.filename) return
        const file = path.relative(state.cwd ?? process.cwd(), state.filename).split(path.sep).join('/')
        const src = `${file}:${loc.start.line}:${loc.start.column + 1}-${loc.end.line}:${loc.end.column + 1}`
        // First, so an explicit userData (or a spread carrying one) still wins.
        p.node.attributes.unshift(t.jsxAttribute(t.jsxIdentifier('userData'), t.jsxExpressionContainer(t.objectExpression([t.objectProperty(t.identifier('graspableSource'), t.stringLiteral(src))]))))
      },
    },
  }
}

import breaks from '../../packages/content/node_modules/comark/dist/plugins/breaks.js'
import emoji from '../../packages/content/node_modules/comark/dist/plugins/emoji.js'
import footnotes from '../../packages/content/node_modules/comark/dist/plugins/footnotes.js'
import shiki from '../../packages/content/node_modules/comark/dist/plugins/shiki.js'
import jsonRender from '../../packages/content/node_modules/comark/dist/plugins/json-render.js'
import math from '../../packages/content/node_modules/comark/dist/plugins/math.js'
import mermaid from '../../packages/content/node_modules/comark/dist/plugins/mermaid.js'
import punctuation from '../../packages/content/node_modules/comark/dist/plugins/punctuation.js'
import security from '../../packages/content/node_modules/comark/dist/plugins/security.js'
import summary from '../../packages/content/node_modules/comark/dist/plugins/summary.js'
import toc from '../../packages/content/node_modules/comark/dist/plugins/toc.js'

export const markdownPluginFactories = {
  breaks,
  emoji,
  footnotes,
  shiki,
  'json-render': jsonRender,
  math,
  mermaid,
  punctuation,
  security,
  summary,
  toc
}

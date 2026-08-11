import breaks from '../../packages/content/node_modules/comark/dist/plugins/breaks.js'
import emoji from '../../packages/content/node_modules/comark/dist/plugins/emoji.js'
import footnotes from '../../packages/content/node_modules/comark/dist/plugins/footnotes.js'
import highlight from '../../packages/content/node_modules/comark/dist/plugins/highlight.js'
import jsonRender from '../../packages/content/node_modules/comark/dist/plugins/json-render.js'
import punctuation from '../../packages/content/node_modules/comark/dist/plugins/punctuation.js'
import security from '../../packages/content/node_modules/comark/dist/plugins/security.js'
import summary from '../../packages/content/node_modules/comark/dist/plugins/summary.js'
import toc from '../../packages/content/node_modules/comark/dist/plugins/toc.js'

export const markdownPluginFactories = {
  breaks,
  emoji,
  footnotes,
  highlight,
  'json-render': jsonRender,
  punctuation,
  security,
  summary,
  toc
}

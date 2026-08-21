<script lang="ts">
import { defineComponent, watch, h, useSlots } from 'vue'
import type { MarkdownRoot } from '../../../types/content'
import ContentRendererMarkdown from './internal/ContentRendererMarkdown.vue'

function normalizeBody (value: Record<string, any>, excerpt: boolean): MarkdownRoot | null {
  let body = excerpt ? value?.excerpt : value?.body

  if (!body && value?.type) {
    body = value
  }

  if (body?.type === 'root' && Array.isArray(body.children)) {
    return body
  }

  return null
}

function warnUnsupportedValue (value: Record<string, any>, excerpt: boolean) {
  const path = value?.route?.resolvedPath ?? value?.path
  const suffix = typeof path === 'string' && path ? ` for "${path}"` : ''
  const target = excerpt ? 'excerpt' : 'body'

  console.warn(
    `[ginko-content] <ContentRenderer> could not render ${target}${suffix}. ` +
    'Pass the full content document with a markdown body, or provide an `empty` slot for empty/unsupported content.'
  )
}

export default defineComponent({
  name: 'ContentRenderer',
  inheritAttrs: false,
  props: {
    value: {
      type: Object,
      required: false,
      default: () => ({})
    },
    excerpt: {
      type: Boolean,
      default: false
    },
    tag: {
      type: String,
      default: 'div'
    },
    prose: {
      type: Boolean,
      default: undefined
    },
    unwrap: {
      type: [Boolean, String],
      default: false
    }
  },
  setup (props) {
    watch(
      () => props.excerpt,
      (newExcerpt) => {
        if (newExcerpt && !props.value?.excerpt) {
          const path = props.value?.route?.resolvedPath ?? props.value?.path ?? '<unknown>'
          console.warn(`No excerpt found for content document "${path}".`)
          console.warn('Make sure to use <!--more--> in your content if you want to use excerpt feature.')
        }
      },
      {
        immediate: true
      }
    )
  },
  render () {
    const slots = useSlots()
    const { value, excerpt, tag, prose, unwrap } = this
    const markdownBody = normalizeBody(value, excerpt)

    if (!markdownBody?.children?.length && slots?.empty) {
      return slots.empty({ value, excerpt, tag, prose, unwrap, ...this.$attrs })
    }

    if (slots?.default) {
      return slots.default({ value, excerpt, tag, prose, unwrap, ...this.$attrs })
    }

    if (markdownBody?.children?.length) {
      return h(ContentRendererMarkdown as any, {
        value,
        excerpt,
        tag,
        prose,
        unwrap,
        ...this.$attrs
      } as any)
    }

    warnUnsupportedValue(value, excerpt)

    return null
  }
})
</script>

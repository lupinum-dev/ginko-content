export const assertCanonicalHighlightOptionNames = (options: Record<string, unknown>) => {
  if ('theme' in options) {
    throw new TypeError('[ginko-content] Markdown plugin "shiki" does not accept "theme". Use "themes: { light, dark }" with Shiki theme registration objects.')
  }
  if ('langs' in options) {
    throw new TypeError('[ginko-content] Markdown plugin "shiki" does not accept "langs". Use "languages" with Shiki language registration objects.')
  }
}

import type { addTemplate } from '@nuxt/kit'
import { isAbsolute, relative } from 'pathe'

export const registerContentComponentsTemplate = (
  addTemplateImpl: typeof addTemplate
) => {
  addTemplateImpl({
    filename: 'content-components.mjs',
    getContents ({ app, nuxt }) {
      const componentsMap = app.components
        .filter((component) => {
          if (component.island) {
            return false
          }

          if (component.filePath.endsWith('.css')) {
            return false
          }

          if (
            component.pascalName === 'ClientOnly' ||
            component.filePath.includes('nuxt/dist/') ||
            component.filePath.includes('NuxtWelcome')
          ) {
            return false
          }

          return true
        })
        .reduce((map, component) => {
          const importPath = isAbsolute(component.filePath)
            ? './' + relative(nuxt.options.buildDir, component.filePath).replace(/\b\.(?!vue)\w+$/g, '')
            : component.filePath.replace(/\b\.(?!vue)\w+$/g, '')

          map[component.pascalName] = map[component.pascalName] || [
            component.pascalName,
            importPath,
            component.global,
            component.export || 'default'
          ]

          return map
        }, {} as Record<string, [string, string, boolean | undefined, string]>)

      const componentsList = Object.values(componentsMap)
      const globalComponents = componentsList.filter(component => component[2]).map(component => component[0])
      const localComponents = componentsList.filter(component => !component[2])

      return [
        'const pickExport = (mod, exportName, componentName, path) => {',
        '  const resolved = exportName === \'default\' ? mod?.default || mod : mod?.[exportName]',
        '  if (!resolved) {',
        '    throw new Error(`[nuxt-content] Missing export "${exportName}" for component "${componentName}" in "${path}".`)',
        '  }',
        '  return resolved',
        '}',
        'export const localComponentLoaders = {',
        ...localComponents.map(([pascalName, path, , exp]) => {
          const pathLiteral = JSON.stringify(path)
          const exportLiteral = JSON.stringify(exp)
          const nameLiteral = JSON.stringify(pascalName)
          return `  ${nameLiteral}: () => import(${pathLiteral}).then(mod => pickExport(mod, ${exportLiteral}, ${nameLiteral}, ${pathLiteral})),`
        }),
        '}',
        `export const globalComponents = ${JSON.stringify(globalComponents)}`,
        `export const localComponents = ${JSON.stringify(localComponents.map(component => component[0]))}`
      ].join('\n')
    }
  })
}

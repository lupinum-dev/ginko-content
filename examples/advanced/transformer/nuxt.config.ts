import MyModule from './my-module/my-module'

export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  modules: [
    MyModule,
    '@lupinum/ginko-content'
  ]
})

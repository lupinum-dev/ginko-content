<script setup lang="ts">
      import { useContentPage } from '#imports'
      import { pages } from '../content.config'

      const { page } = await useContentPage(pages)
      </script>

      <template><main><h1>{{ page?.title }}</h1></main></template>
    

<script setup lang="ts">
      import { useContentPage } from '#imports'
      import { pages } from '../content.config'

      const { page } = await useContentPage(pages)
      </script>

      <template><main>{{ page == null ? 'Missing document' : 'Unexpected document' }}</main></template>
    

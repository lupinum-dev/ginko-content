<script setup lang="ts">
      import { useContentPage } from '#imports'
      import { pages } from '../content.config'

      const { page, next } = await useContentPage(pages, { surround: true })
      </script>

      <template>
        <main>
          <h1>{{ page?.title }}</h1>
          <p data-testid="next-page">{{ next?.title }}</p>
        </main>
      </template>
    

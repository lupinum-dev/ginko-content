<script setup lang="ts">
import { prefixDocsPath } from '../../utils/docs'

definePageMeta({
  layout: 'docs'
})

const { toc, seo } = useAppConfig()

const { page, previous, next } = await useContentPage('docs', {
  surround: true
})

const surroundLinks = computed(() => {
  const prev = previous.value as { _path?: string, path?: string } | null
  const nextLink = next.value as { _path?: string, path?: string } | null
  return [
    prev ? { ...prev, _path: prefixDocsPath(prev._path || prev.path) } : null,
    nextLink ? { ...nextLink, _path: prefixDocsPath(nextLink._path || nextLink.path) } : null
  ]
})

const pageTitle = computed(() => (page.value as any)?.seo?.title || (page.value as any)?.title || '')
const pageDescription = computed(() => (page.value as any)?.seo?.description || (page.value as any)?.description || '')

useSeoMeta({
  titleTemplate: `%s · ${seo?.siteName}`,
  title: pageTitle.value,
  ogTitle: `${pageTitle.value} · ${seo?.siteName}`,
  description: pageDescription.value,
  ogDescription: pageDescription.value
})

if (import.meta.server) {
  defineOgImageComponent('Docs', {
    category: 'Docs'
  })
}
</script>

<template>
  <UPage v-if="page">
    <UPageHeader
      :ui="{ wrapper: 'lg:mr-10' }"
      :title="(page as any).title"
      :description="(page as any).description"
    >
      <template #links>
        <UButton
          v-for="(link, index) in ((page as any).links || [])"
          :key="index"
          v-bind="link"
        />

        <PageHeaderLinks />
      </template>
    </UPageHeader>

    <UPageBody prose class="dark:text-gray-300 dark:prose-pre:!bg-gray-800/60 lg:pr-10 pb-0">
      <ContentRenderer v-if="(page as any).body" :value="page" />
    </UPageBody>
    <div class="pb-24">
      <USeparator class="my-10">
        <div class="flex items-center gap-2 text-sm dark:text-gray-400">
          <UButton size="sm" variant="link" color="neutral" to="https://github.com/lupinum-dev/ginko-content/issues/new/choose" target="_blank">
            Report an issue
          </UButton>
          or
          <UButton size="sm" variant="link" color="neutral" :to="`${toc.bottom.edit}/${(page as any)?._file}`" target="_blank">
            Edit this page on GitHub
          </UButton>
        </div>
      </USeparator>
      <UContentSurround :surround="surroundLinks" />
    </div>

    <template v-if="(page as any).body?.toc" #right>
      <UContentToc :title="toc?.title" :links="(page as any).body?.toc?.links" highlight class="backdrop-blur-none" />
    </template>
  </UPage>
</template>

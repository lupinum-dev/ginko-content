<script setup lang="ts">
import { docs } from '../../../content.config'
import { prefixDocsPath } from '../../utils/docs'

definePageMeta({
  layout: 'docs'
})

const { toc, seo } = useAppConfig()

const { page, surround } = await useContentPage(docs, {
  surround: true
})

const surroundLinks = computed(() => {
  const [prev, nextLink] = surround.value as Array<{ path?: string }>
  return [
    prev?.path ? { ...prev, path: prefixDocsPath(prev.path) } : null,
    nextLink?.path ? { ...nextLink, path: prefixDocsPath(nextLink.path) } : null
  ].filter(Boolean)
})

const editLink = computed(() => {
  const filePath = (page.value as any)?.file?.path
  return filePath ? `${toc.bottom.edit}/${filePath}` : null
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
          <UButton v-if="editLink" size="sm" variant="link" color="neutral" :to="editLink" target="_blank">
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

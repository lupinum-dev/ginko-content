<script setup lang="ts">
const postPath = ref('/blog/post-1')
const publishResult = ref<unknown>(null)

const { data: page, refresh } = await useAsyncData(
  () => `cms-cache-demo:${postPath.value}`,
  () => $fetch('/api/demo/page', {
    query: {
      path: postPath.value
    }
  }),
  {
    watch: [postPath]
  }
)

const publishAlice = async () => {
  publishResult.value = await $fetch('/api/cms/publish-author', {
    method: 'POST',
    body: {
      author: 'alice',
      name: 'Alicia'
    }
  })
  await refresh()
}
</script>

<template>
  <main>
    <h1>CMS Cache Contract Demo</h1>

    <label>
      Route
      <select v-model="postPath">
        <option value="/blog/post-1">/blog/post-1</option>
        <option value="/blog/post-2">/blog/post-2</option>
        <option value="/blog/post-6">/blog/post-6</option>
      </select>
    </label>

    <article v-if="page">
      <h2>{{ page.title }}</h2>
      <p>{{ page.authorName }}</p>
      <p>{{ page.path }}</p>
    </article>

    <button type="button" @click="publishAlice">
      Publish Alice rename
    </button>

    <pre>{{ publishResult }}</pre>
  </main>
</template>

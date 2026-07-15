<script setup lang="ts">
import { many } from '@lupinum/ginko-content/client'
import { movies } from './content.config'

const [miyazakiMovies, earlyMovies, otherDirectors, selectedMovies, paginatedMovies] = await Promise.all([
  many(movies, { where: { director: 'Hayao Miyazaki' } }),
  many(movies, { where: { release_date: { $lt: 1997 } } }),
  many(movies, { where: { director: { $ne: 'Hayao Miyazaki' } } }),
  many(movies, {
    where: { director: { $in: ['Hayao Miyazaki', 'Yoshifumi Kondō'] } },
    select: ['title', 'director']
  }),
  many(movies, { skip: 2, limit: 3 })
])

const sections = [
  { title: 'Equality', movies: miyazakiMovies },
  { title: 'Less than', movies: earlyMovies },
  { title: 'Not equal', movies: otherDirectors },
  { title: 'Selection and inclusion', movies: selectedMovies },
  { title: 'Pagination', movies: paginatedMovies }
]
</script>

<template>
  <main class="text-left">
    <h1>Querying mixed content</h1>
    <p>The collection combines Markdown, JSON, JSON5, and YAML documents.</p>

    <section v-for="section in sections" :key="section.title">
      <h2>{{ section.title }}</h2>
      <ul>
        <li v-for="movie in section.movies" :key="movie.path">
          {{ movie.title }}<span v-if="movie.director"> — {{ movie.director }}</span>
        </li>
      </ul>
    </section>
  </main>
</template>

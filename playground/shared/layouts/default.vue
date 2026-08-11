<template>
  <div class="shell">
    <header class="shell__header">
      <div>
        <p class="eyebrow">
          Ginko
        </p>
        <h1 class="title">
          Playground
        </h1>
      </div>
    </header>

    <div class="shell__body">
      <main class="shell__main">
        <div class="page">
          <slot />
        </div>
      </main>
    </div>
  </div>
</template>

<style>
html, body, #__nuxt {
  margin: 0;
  padding: 0;
  min-height: 100vh;
}

html {
  font-family: Georgia, "Times New Roman", serif;
  background: #f6f1e8;
  color: #1e1a16;
}

body {
  background:
    linear-gradient(180deg, rgba(255,255,255,0.72), rgba(255,255,255,0.72)),
    repeating-linear-gradient(
      0deg,
      rgba(120, 95, 70, 0.06) 0,
      rgba(120, 95, 70, 0.06) 1px,
      transparent 1px,
      transparent 30px
    );
}

a {
  color: inherit;
}

code, pre {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}

.shell {
  min-height: 100vh;
}

.shell__header {
  padding: 1.5rem 2rem 1rem;
  border-bottom: 1px solid #d7c9b6;
  background: rgba(255, 251, 245, 0.88);
}

.eyebrow {
  margin: 0 0 0.35rem;
  font-size: 0.8rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #7c6856;
}

.title {
  margin: 0;
  font-size: clamp(1.8rem, 3vw, 2.4rem);
  font-weight: 600;
}

.shell__body {
  min-height: calc(100vh - 96px);
}

.shell__main {
  padding: 2rem;
}

.page {
  max-width: 58rem;
}

.page h1,
.page h2,
.page h3 {
  line-height: 1.15;
}

.page p,
.page li {
  line-height: 1.65;
}

.page pre {
  overflow: auto;
  padding: 1rem;
  border: 1px solid #d7c9b6;
  background: #fffdf9;
}

.page :not(pre) > code {
  padding: 0.1rem 0.35rem;
  border: 1px solid #ddcfbc;
  background: #fffaf2;
}

@media (max-width: 900px) {
  .shell__main {
    padding: 1.25rem;
  }
}
</style>

<template>
  <NuxtExampleLayout example="navigation/use-route" repo="lupinum-dev/ginko-content">
    <header>
      <nav>
        <ul>
          <li>
            <NuxtLink to="/">
              Home
            </NuxtLink>
          </li>
          <li>
            <NuxtLink to="/blog-post">
              Blog post
            </NuxtLink>
          </li>
          <li>
            <NuxtLink to="/about">
              About
            </NuxtLink>
          </li>
        </ul>
      </nav>
    </header>
    <NuxtPage />
  </NuxtExampleLayout>
</template>

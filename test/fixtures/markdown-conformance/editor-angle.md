<!-- before component -->

<info :disabled="false" :enabled="true" :zero="0" :count="3" label="false" :options='{"mode":"safe","retries":[0,3]}' asset="/ginko-assets/example.png" url="https://example.test/guide">
Default Grüße 👋 日本語 with **strong text** and an escaped &lt;info&gt; label.

<template #actions>
[Open guide](/guide)
</template>

```md
<not-a-component>inside code</not-a-component>
```

<!-- inside component -->
</info>

<layout>
<column>
- First
- Second
</column>
<column>
Nested <badge label="false">**inline**</badge> content.
</column>
</layout>

Unknown <application-card :count="3">component</application-card> beside text.

<!-- after component -->

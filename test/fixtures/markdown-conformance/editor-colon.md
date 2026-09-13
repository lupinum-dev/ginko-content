<!-- before component -->

::info
---
disabled: false
enabled: true
zero: 0
count: 3
label: "false"
options:
  mode: safe
  retries:
    - 0
    - 3
asset: /ginko-assets/example.png
url: https://example.test/guide
---
Default Grüße 👋 日本語 with **strong text** and an escaped \:: delimiter.

#actions
[Open guide](/guide)

```md
::not-a-component
```

<!-- inside component -->
::

::::layout
::column
- First
- Second
::
::column
Nested :badge[**inline**]{label="false"} content.
::
::::

Unknown :application-card[component]{:count="3"} beside text.

<!-- after component -->

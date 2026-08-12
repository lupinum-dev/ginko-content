# Writing documentation

Ginko Content uses Lupinum Controlled English. This profile is based on
ASD-STE100 Issue 9. It does not claim formal ASD-STE100 compliance.

## Write for the user

- Start with the result or action.
- Use short, active sentences.
- Put one instruction in each sentence.
- Use the imperative form for procedures.
- Use one term for one concept.
- Define a technical term before you use it.
- Put a warning before the affected action.
- Use sentence-case headings.
- Use American English spelling.

Do not use filler such as `simply`, `just`, `obviously`, `easy`, `seamless`, or
`powerful`.

## Use the approved terms

- **Application**: the user's Nuxt application.
- **Package**: the published `@lupinum/ginko-content` package.
- **Module**: the Nuxt module installed by the package.
- **Document**: one normalized content record.
- **Collection**: the canonical definition of related documents.
- **Provider**: one implementation of the Ginko provider contract.
- **Route**: the public application path for one document.
- **Release candidate**: the exact retained tarball that passed release checks.

Do not use `document`, `page`, `route`, and `file` as interchangeable terms.

## Structure public pages

- Put `title` and `description` in frontmatter.
- Do not add a body-level `#` heading.
- Organize content by user intent.
- Label code fences with a language and file path when applicable.
- Show one concept in each example.
- End with a specific result or constraint.
- Do not add generic `Summary`, `Conclusion`, `Related`, or `Next steps`
  sections.

Public documentation explains supported behavior. Keep maintainer evidence and
release approval steps in `MAINTAINING.md`.

Do not rewrite license text, code, API identifiers, command output, quotations,
changelog identifiers, or generated API reports.

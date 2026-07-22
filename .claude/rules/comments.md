# Comments

Write a comment only when the code cannot show *why* on its own.

- Explain the **why** — a constraint, invariant, gotcha, or non-obvious decision. Never restate *what* the line does.
- Only annotate genuinely hard-to-understand code. Self-evident lines get no comment.
- Keep it to one short line where it matters. No paragraph docblocks that repeat the signature or narrate the next line.
- No narration or change-history ("previously…", "now we…", "this was a bug") — that belongs in the commit message.
- When editing a file, sweep the comments in and around your change and delete any that break these rules.

Good — explains a non-obvious gotcha the code can't show:

```ts
// `.optional()` accepts only undefined, so coerce the blank .env value first.
```

Bad — restates what the code already says:

```ts
// split the string by comma and lowercase each symbol
```

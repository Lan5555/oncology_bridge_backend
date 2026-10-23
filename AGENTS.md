# Secret handling

- Never read, print, copy, or load `.env` or `.env.*` files.
- Exception: `.env.example` may be read only if it contains placeholders. If this is unknown, ask the user before reading it.
- Never inspect process environment variables for secrets.

# Changelog

## 1.0.0

First public release.

- Request panel: method, URL, headers, Bearer/Basic auth, body, Ctrl/Cmd+Enter to send, cancel and timeout.
- Paste a cURL command into the URL bar (or run **Import cURL Command**) to fill in the whole request.
- `{{VARIABLE}}` substitution from the workspace `.env`, with clear errors for unresolved variables.
- Generates TypeScript interfaces and Zod schemas from the response: merged array elements, optional and nullable fields, unions, named and de-duplicated nested types, root name derived from the URL.
- Zod 4 and Zod 3 output; ISO datetime/date, email, UUID and URL format detection; opt-in integer detection.
- Optional typed `fetchX()` helper that validates responses with the generated schema.
- Insert at cursor, copy, open in editor, save as file.
- Generate from a JSON selection, a `.json` file, or clipboard JSON; **Paste JSON as Zod & TypeScript**.
- Per-workspace request history with secrets redacted.

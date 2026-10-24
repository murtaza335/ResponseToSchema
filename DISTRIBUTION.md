# Distribution & Launch Strategy

## 1. Positioning

**One-liner:** Hit an endpoint, get types. ResponseToSchema turns any API response into a TypeScript interface and a matching Zod schema, without leaving VS Code.

**The gap it fills.** API clients in the editor (Thunder Client, REST Client, Postman) send requests but don't generate types. JSON→Zod converters (quicktype, Transform Tool, web converters) generate types but don't send requests, so you copy-paste between tools. Web converters also mean pasting production API data into a third-party site. ResponseToSchema is the only tool that does request → Zod + TS in one step, locally.

**Who it's for (in priority order)**
1. TypeScript developers using Zod: Next.js, tRPC, React Query, T3, Remix, Astro.
2. Frontend developers integrating third-party or undocumented APIs (no OpenAPI spec to generate from).
3. Cursor, Windsurf and VSCodium users. They install from **Open VSX**, which many extensions skip, so there's less competition there.

**Differentiators to repeat everywhere:** paste a cURL → types; correct **Zod 4** output (many tools still emit Zod 3 or broken v4); merges all array elements (optional/nullable are correct); named, de-duplicated types; local-only, no account, no telemetry; free and MIT.

## 2. Channels

| Channel | Why | Setup (one time) |
|---|---|---|
| **VS Code Marketplace** | Most VS Code installs come from here | Create the publisher `murtaza335` at https://marketplace.visualstudio.com/manage. Create an Azure DevOps PAT (Organization: *All accessible*, scope *Marketplace → Manage*). Run `npx vsce login murtaza335`. |
| **Open VSX** | Cursor, Windsurf, VSCodium, Gitpod, Theia | Sign in at https://open-vsx.org with GitHub, link an Eclipse account and sign the Publisher Agreement. Create a token, then run `npx ovsx create-namespace murtaza335 -p <token>`. |
| **GitHub Releases** | Offline/enterprise installs (`code --install-extension *.vsix`) | Automatic via `.github/workflows/release.yml` |

**Automation:** add the repository secrets `VSCE_PAT` and `OVSX_PAT`, then:

```bash
npm version patch            # bumps package.json and creates the git tag
git push --follow-tags       # the release workflow tests, packages and publishes everywhere
```

## 3. Marketplace listing optimisation

Search on the Marketplace weights display name, keywords and installs.

- The display name already contains the two highest-intent terms: **Zod** and **TypeScript**. Keep them.
- Keywords are set in `package.json` (zod, json to zod, json to typescript, curl, postman, thunder client, quicktype, …).
- **Highest-impact missing asset: a 15–20 second demo GIF** at the top of the README. Show: paste a cURL → Send → types appear → Insert at cursor. Record with Kap (macOS), Peek (Linux) or ScreenToGif (Windows), keep it under 5 MB, save as `media/demo.gif`, and put it above the screenshot.
- Ask for ratings once, non-intrusively: e.g. after the 10th successful generation, one notification with *Rate* / *Don't ask again*. Planned for 1.1.
- Answer every Marketplace Q&A item and GitHub issue within 48 hours during the first month. Early responsiveness drives ratings.

## 4. Launch plan

**Pre-launch (days 1–3)**
- [ ] Push to `github.com/murtaza335/ResponseToSchema`. The README screenshot URL resolves from the repo, so it must be public. Add topics: `vscode-extension`, `zod`, `typescript`, `json`, `codegen`.
- [ ] Record the demo GIF.
- [ ] Publish 1.0.0 to both registries and install it from each to verify.
- [ ] Write one launch article (dev.to / Hashnode / personal blog): *"Stop hand-writing Zod schemas for API responses."* Cover the problem, a 3-step demo and the inference rules (why optional/nullable matter).

**Launch day (pick a Tuesday–Thursday)**
- **Show HN:** "Show HN: Turn any API response into Zod + TypeScript inside VS Code". Post in the morning US Eastern time and stay in the comments.
- **Reddit**, one per day rather than all at once: r/typescript, r/reactjs, r/nextjs, r/webdev, r/vscode. Lead with the GIF, explain the gap, and be upfront that you're the author.
- **X / Bluesky:** the GIF plus a single sentence. Tag Zod's author only if the post is genuinely useful to Zod users.
- **Product Hunt** (Developer Tools) is optional, a week later, if the first wave gets traction.

**Evergreen channels (week 2+)**
- Open a PR adding the extension to **Zod's ecosystem page** (zod.dev → Ecosystem, sourced from the Zod repo). This is the most targeted audience there is.
- Open a PR to **awesome-vscode** and relevant "awesome-zod" lists.
- Answer Stack Overflow / Reddit questions like "generate zod schema from json" and "typescript types from api response" where the tool genuinely solves the question.
- A 60-second YouTube Short / TikTok of the GIF flow.

## 5. Metrics & targets (first 90 days)

| Metric | Source | Target |
|---|---|---|
| Installs (Marketplace + Open VSX) | Publisher dashboards | 1,000 |
| Average rating | Marketplace | ≥ 4.5 with ≥ 10 ratings |
| GitHub stars | GitHub | 100 |
| Issue median time-to-first-response | GitHub | < 48 hours |

There is no in-product telemetry, and that's part of the privacy pitch. Use registry install counts and GitHub activity instead.

## 6. Roadmap (fuels repeat launches)

Each item is a reason to post again ("ResponseToSchema 1.x now does …").

- **1.1:** discriminated-union detection (arrays of objects keyed by `type`/`kind` → `z.discriminatedUnion`); "merge another response" to refine optionality from multiple calls; rating prompt; demo GIF.
- **1.2:** CLI and npm library from `src/core` (`npx response-to-schema https://api… > user.schema.ts`) for scripts and CI.
- **1.3:** **MCP server** exposing `json_to_zod` / `url_to_zod` tools, so Claude Code, Cursor agents and other AI coding agents can type an API before writing code against it. This builds on the engine being dependency-free and deterministic.
- **Later:** saved request collections (shareable JSON in the repo), Valibot / ArkType / JSON Schema targets, GraphQL responses, OpenAPI export.

## 7. Monetisation (optional)

Recommendation: **keep it free and MIT.** Developers react badly when tools move existing features behind a paywall, and "free, local, no account" is part of the pitch. Add GitHub Sponsors and a "Sponsor" link in the README. If demand appears later, team features (shared collections synced via git) are the natural paid tier. Keep the generator itself free.

## 8. Release checklist

- [ ] `npm run check` passes (typecheck, unit + round-trip tests, extension host smoke test)
- [ ] `CHANGELOG.md` updated
- [ ] Manual pass in an Extension Development Host (F5): send a request, paste a cURL, use clipboard JSON, Insert at cursor, light and dark themes
- [ ] `npm version <patch|minor>` and `git push --follow-tags`
- [ ] Verify the new version on both registries and install it in Cursor from Open VSX

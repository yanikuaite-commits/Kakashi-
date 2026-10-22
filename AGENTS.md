# KAKASHI BOT AGENT GUIDE

This file is the single source of truth for agents and contributors who need fast, reliable project context.

Use it as the primary documentation for:

- architecture and runtime flow
- command authoring rules
- configuration and persistence rules
- service boundaries
- supported hosting context
- AI-agent operating rules and local skills

For installation walkthroughs and end-user tutorials, see `README.md`.

## PROJECT_OVERVIEW

**Kakashi Bot** is a modular WhatsApp bot framework built on the Baileys ecosystem.

Core principles:

- file-oriented command architecture instead of giant switch/case handlers
- clear separation of permissions by folder
- simple JSON persistence
- reusable services and middleware
- code optimized for readability and maintenance

Permission model:

- `src/commands/owner` → bot owner features
- `src/commands/admin` → group administration features
- `src/commands/member` → features available to regular members

The project philosophy is simple: code for humans first.

## ARCHITECTURE

Main runtime flow:

1. `index.js` or `src/index.js` boots the bot.
2. `src/connection.js` opens the WhatsApp connection, loads auth state, handles pairing, and reconnects when needed.
3. `src/loader.js` registers listeners and wraps event execution with safe error handling.
4. `src/middlewares/onMesssagesUpsert.js` receives messages, filters stale events, handles muted users and participant events, and injects common functions.
5. `src/utils/dynamicCommand.js` validates prefix, permission, group state, and dispatches the selected command.
6. `src/services/*` and `src/utils/*` provide integrations, media processing, database access, and helpers.

High-value architectural notes:

- the bot stores its WhatsApp auth state in `assets/auth/baileys/`
- TIMEOUT_IN_MILLISECONDS_BY_EVENT throttles event handling to reduce spam-ban risk
- `badMacHandler` is part of the self-healing strategy for session issues
- `loadCommonFunctions.js` is the main injection layer for command helpers

## CORE_FILES

| Path | Responsibility |
| --- | --- |
| `index.js` | Root entrypoint for hosts that expect a root `index.js`. |
| `src/index.js` | Main source entrypoint. |
| `src/config.js` | Core runtime configuration, tokens, directories, flags, and platform settings. |
| `src/connection.js` | WhatsApp socket setup, pairing, session persistence, reconnection logic. |
| `src/loader.js` | Event registration and safe wrapper logic. |
| `src/middlewares/onMesssagesUpsert.js` | Main inbound message processing pipeline. |
| `src/middlewares/customMiddleware.js` | Official extension point for custom global logic. |
| `src/utils/dynamicCommand.js` | Prefix validation, permission enforcement, and command dispatch. |
| `src/utils/loadCommonFunctions.js` | Injected helper functions used by command handlers. |
| `src/utils/database.js` | Safe access layer for JSON persistence. |
| `src/utils/interactive.js` | Interactive-message builders: `singleSelectButton`, `urlButton`, `ownerButton` (owner WhatsApp link from `MAIN_MENU_OWNER_NUMBER`), `copyButton`. |
| `src/utils/richTable.js` | Native WhatsApp tables (`RICH_RESPONSE_TABLE`) via `sendRichTable`, plus `sendTabela`, which sends a pricing table from `src/utils/tabelaPrecos.js` and falls back to aligned text when the relay fails. |
| `src/utils/tabelaPrecos.js` | Pricing-table data and formatting only (no Baileys): `TABELAS` (`dias`, `creditos`), `tabelaOpcoes()`, `tabelaIdDoArgumento()`, `formatTabelaTexto()`. |
| `src/@types/index.d.ts` | Typing and documentation for command and middleware props. |
| `src/services/spider-x-api.js` | Spider X integration for downloads, AI, Pinterest, Brat, and related endpoints. |
| `src/services/ytdlp.js` | Local downloads through the yt-dlp CLI (metadata, video, mp3) with GenDownload API fallback. |
| `src/services/anime.js` | HiAnime (Consumet) search, episodes and streaming sources. |
| `src/services/sticker.js` | Sticker processing and EXIF handling. |
| `src/services/ffmpeg.js` | Media conversion and audio/video processing. |

## COMMAND_GUIDE

Command template:

```javascript
import { PREFIX } from "../../config.js";
import { InvalidParameterError } from "../../errors/index.js";

export default {
  name: "command",
  description: "What it does",
  commands: ["alias1", "alias2"],
  usage: `${PREFIX}command <args>`,
  handle: async ({ sendReply, args }) => {
    if (!args[0]) throw new InvalidParameterError("Missing arguments!");
    await sendReply("Success!");
  },
};
```

Command authoring rules:

- always use injected helpers from `handle()` before introducing new low-level logic
- never manually enforce owner/admin/member permission inside the command if folder placement already defines it
- use `src/errors/` custom errors for automatic user-facing responses
- keep commands focused and readable
- prefer existing helpers and services over duplicating code
- if a command needs persistence, go through `src/utils/database.js`

## TYPING_AND_MIDDLEWARE

Typing lives in `src/@types/index.d.ts`.

Important interfaces:

- `CommandHandleProps`
- `CustomMiddlewareProps`

Useful `handle()` capabilities:

- media flags: `isImage`, `isVideo`, `isAudio`, `isSticker`
- send helpers: `sendReply()`, `sendSuccessReply()`, `sendReact()`, `sendImageFromURL()`, `sendStickerFromFile()`
- download helpers: `downloadImage()`, `downloadVideo()`, `downloadAudio()`, `downloadSticker()`
- context values: `args`, `fullArgs`, `fullMessage`, `remoteJid`, `replyText`, `userLid`

Custom global logic should go into `src/middlewares/customMiddleware.js`.

Use it for:

- custom logs
- extra validations
- automatic reactions
- per-group behavior
- custom participant hooks

Do not modify core middleware flow unless there is a real architectural need.

## DATA_RULES

The bot uses JSON files in `database/` for persistence.

Important files:

| File | Role |
| --- | --- |
| `config.json` | runtime values such as tokens and mutable settings |
| `prefix-groups.json` | custom prefixes per group |
| `auto-responder.json` | trigger/answer entries |
| `muted.json` | muted users by group |
| `inactive-groups.json` | groups where the bot is disabled |
| `group-restrictions.json` | restrictions by message type |

Mandatory rule:

- **never** read these files directly with `fs.readFileSync` inside commands
- always use `src/utils/database.js`

This keeps persistence behavior consistent and avoids duplicated parsing logic.

## TABLES_AND_PRICING

`tabela` shows both pricing tables through one interactive list (1 = day plans,
2 = credit packs); `tabela-dias` and `tabela-creditos` open one table directly.

- the data lives in `src/utils/tabelaPrecos.js` (`TABELAS`), which holds no
  Baileys code so it stays testable; `src/utils/richTable.js` does the sending
- `tabelaOpcoes()` defines the numbering, so "1 = dias" and "2 = creditos" come
  from the data, never from a hand-written branch
- the list rows carry `kmenu:` tokens, not commands: WhatsApp drops oversized
  `rowId`s, and the mapping to `${prefix}tabela-dias` / `${prefix}tabela-creditos`
  is registered through `sendInteractiveWithFallback`'s `responseMappings`
- the same helper registers the numeric fallback (1/2), so the text fallback and
  the interactive list stay in sync
- `.tabela 1` and `.tabela 2` skip the list; any other argument is an
  `InvalidParameterError`
- `sendTabela` tries the native table and falls back to aligned text
  (`formatTabelaTexto`) when the relay fails, because not every client renders
  `RICH_RESPONSE_TABLE`
- add or change prices in `TABELAS` only; do not duplicate the rows in commands
- the three commands are in `FREE_COMMANDS`, so checking prices never costs credits

## ANTI_PAYMENT

Two entry points punish a payment message:

- direct: the bot reads a payment message live in the group (`messageHandler`)
- quoted: a member replies to a payment message, and the ORIGINAL author is
  removed, never the one who quoted (`handleQuotedPaymentRestriction`)

The quoted path is forgeable — `contextInfo.participant` and `quotedMessage` come
from the client — so it is gated by `src/utils/messageEnvelopeRegistry.js`, an
in-memory record of every group message envelope the bot received.

Deliberate rule: **only a message the bot actually read as a payment corroborates
a quote.** A message whose content was never decrypted does NOT corroborate.

| Recorded state | Quote outcome |
| --- | --- |
| `payment` (bot read a payment) | corroborated → punishes |
| `other` (readable, not payment) | contradicted → never punishes |
| `unreadable` (never decrypted) | not corroborated → never punishes |
| not recorded at all | not corroborated → never punishes |

An undecryptable message is indistinguishable from an ordinary message lost to a
Signal session failure, so it is never treated as evidence: acting on it removes
innocent members. The failure mode is always conservative — when in doubt, do not
punish. Do not punish based on undecryptable messages without a new signal that
actually proves payment content.

## SERVICES

### Spider X API

`src/services/spider-x-api.js` powers:

- downloads from TikTok, YouTube, Instagram, Facebook, Pinterest
- AI endpoints such as Gemini, GPT-5 Mini, Flux
- sticker endpoints such as `attp`, `ttp`, and `brat`
- utility endpoints used by several commands

It depends on `SPIDER_API_TOKEN`, which can come from:

- `src/config.js`
- runtime database config through `/set-spider-api-token`

### yt-dlp

`src/services/ytdlp.js` runs the yt-dlp CLI locally: metadata (`--dump-single-json`,
which feeds the credit cost by duration), video downloads, mp3 extraction and
`isYtDlpAvailable()`. `src/services/downloader.js` prefers yt-dlp and falls back to
the GenDownload API when the binary is missing or the extraction fails.

- the binary is installed by the `Dockerfile` (standalone `yt-dlp_linux`, no Python)
- `npm run setup:ytdlp` downloads it to `bin/yt-dlp` on non-Docker hosts; Termux uses `pkg install yt-dlp`
- configuration lives in `src/config.js` under the `YTDLP_*` constants (`ENABLED`, `PATH`, `COOKIES_PATH`, `PROXY`, `JS_RUNTIME`, `IMPERSONATE`, `EXTRACTOR_ARGS`, `CONCURRENT_FRAGMENTS`)
- `YTDLP_ENABLED=false` disables it entirely; nothing breaks without the binary
- `YTDLP_CONCURRENT_FRAGMENTS` sets the yt-dlp `-N` (default 4). CDNs that rate-limit parallel requests (the anime CDN answers 429) need `1`, otherwise yt-dlp drops fragments and fails with `No such file ...-FragN`; the anime flow forces `1` for `anikoto`
- YouTube blocks datacenter IPs (Render included) with "Sign in to confirm you're not a bot"; the fix is cookies or a residential proxy, never a flag

Media sending must stream, never buffer: use `mediaUploadFromFile()` from
`src/utils/mediaSend.js` (returns `{ stream }`) instead of `fs.readFileSync`.
The Baileys path encrypts chunk by chunk, so a 350 MB episode costs ~65 MB of
RSS as a stream against ~351 MB as a buffer. The Render `starter` plan has
512 MB, so buffering a large episode gets the process killed by OOM.

### Animes (anikoto + animeheaven + providers via @consumet/extensions)

`src/services/anime.js` searches a live provider, lists episodes and returns
streaming sources; `src/services/anikoto.js` and `src/services/animeheaven.js`
are the in-house providers; `src/utils/animeMenu.js` runs the interactive flow
(nome → temporadas → episódios → qualidade → download) and
`src/utils/animeFormat.js` holds the pure helpers.

- **`anikoto` and `animeheaven` are the providers that work from a datacenter IP
  (Render).** Both are scraped by the bot itself, not by the library, because
  every `@consumet/extensions` anime provider sits behind Cloudflare and/or is
  dead. The anikoto chain is: `/filter?keyword=` → `/ajax/episode/list/<id>` →
  `/ajax/server/list?servers=<data-ids>` → `/ajax/server?get=<link>&sv=<sv>` →
  the megaplay player → `/stream/getSources?id=<mediaid>`; the m3u8 comes in the
  `enc` field, AES-256-CBC encrypted with a key/IV hardcoded in the player's JS
  (`MEGAPLAY_KEY`/`MEGAPLAY_IV` in `src/services/anikoto.js` — public constants,
  not our secret)
- the anikoto `Referer` must be the watch page or the site answers "bad request";
  episode ids therefore carry `<slug>::<epId>::<dataIds>`, and the anime id
  carries `<numId>:<slug>`, so every later step has what it needs without state
- **seasons are separate entries on the site, not a field.** A title like
  Attack on Titan is 6 different animes (own slug and id); `api/seasons/<id>`
  only groups them. Without the season step, picking a season showed the
  episodes of the first one. The flow lists the group only when it has 2+
  entries (`getAnimeSeasons` → `[]` means "skip straight to episodes", as
  before). The numeric id the episode endpoint needs (`data-anime-id`) is read
  from the season's watch page in `seasonEpisodes`, so the session stores only
  the short slug
- the anikoto CDN (`fetch.nexabloom.top`) passes a **Cloudflare challenge** on
  the m3u8 fetch. `src/utils/animeMenu.js` (`animeDownloadArgs`) adds
  `--extractor-args generic:impersonate` and `--referer https://megaplay.buzz/`
  to the yt-dlp call; `downloadWithYtDlp` accepts `extraArgs` for that. Without
  impersonation (which needs the standalone binary's `curl_cffi`) the download
  fails with HTTP 403
- **`animeheaven` serves a direct 720p MP4 (~112–164 MB), inside the 200 MB
  send limit, so it is not capped to 480p.** The chain is: `/search.php?s=<termo>`
  → `/anime.php?<id>` (each
  episode carries a 32-hex hash) → `/gate.php` with the `key=<hash>` cookie,
  which returns the `<source>` mirrors. `/gate.php` without the cookie answers
  404 — the hash *is* the credential, which is why `sources` takes the hash and
  not a numeric id
- **not every `<source>` on AnimeHeaven is the episode.** `ax` always serves a
  ~3.7 s trailer (88 KB) and `ct`/`ck` answer 0 bytes/error; yt-dlp cannot tell
  them apart (the URL is `video.mp4` with no metadata), so the mirror is chosen
  in `escolherMirror` by `Content-Length` — the only honest signal. The good
  mirrors vary per title (`rx`, `co`, `cy`, `ci`, `sr`, `rt`, `cx`, `cz`, ...),
  so the choice is by size, not by a fixed list. `animeheaven` returns an object
  (`{url, quality: "720p", isM3U8: false}`) instead of a bare URL string, which
  is why `getEpisodeSources` accepts both shapes: assuming HLS for a direct MP4
  printed the wrong quality label
- `ANIME_HEAVEN_MAX_HEIGHT` (default 720) is the AnimeHeaven ceiling: the
  episode already fits the 200 MB limit, so forcing 480p would only degrade the
  image for nothing. `ANIME_MAX_HEIGHT` (480) still applies to anikoto, whose
  master.m3u8 carries a single 1080p variant
- the library providers remain as fallback; extraction runs **in-process**
  through `@consumet/extensions`, with no Consumet server and no self-hosting.
  The public `api.consumet.org` instance was shut down (HTTP 451) and the HiAnime
  provider (ex-Zoro) shut down for good in March 2026
- `ANIME_PROVIDERS` (`src/config.js`) is a comma-separated preference list
  (default `animeheaven,anikoto,animeunity,animepahe`); each provider is tried
  until one returns the episode, and the winning provider is carried in the
  session so `getAnimeInfo`/`getEpisodeSources` hit the same source
- the returned link is an m3u8/mp4 that yt-dlp downloads; HLS sources are
  preferred over DASH because some `.mpd` files from these sites ship without an
  audio track
- these sites change domain and die without notice, so a provider that works
  today may need replacing tomorrow: fix by editing `ANIME_PROVIDERS`, never by
  hardcoding a domain in a command
- **the library sites sit behind Cloudflare, and the library sends no
  `User-Agent`** (axios defaults to `axios/1.x`), which Cloudflare blocks from
  datacenter IPs — Render included. This is the same class of block as YouTube's
  "confirm you're not a bot". `ANIME_USER_AGENT` / `ANIME_ACCEPT_LANGUAGE`
  (`src/config.js`) are applied to each library provider's HTTP client in
  `applyProviderClient`; without them search fails with "nenhuma fonte respondeu"
  even while the site is up. If the host IP is challenged even with browser
  headers, set `ANIME_PROXY_URL` to a residential HTTP proxy
- a provider failing does not abort the flow: each error is logged with its
  reason and the next provider is tried, so `assets/temp/wa-logs.txt` tells you
  exactly which provider failed and why
- list rows carry only indices (`anm:ep:<i>` / `anm:src:<i>`); the real
  (long, signed) stream URLs stay in the session, because WhatsApp drops
  oversized `rowId`s
- episodes are listed 10 at a time (`anm:ep:<i>` uses the ABSOLUTE index) with a
  single `anm:pg:<p>` "ver mais" row at the bottom for the rest, so the list
  stays short and every episode is still reachable — WhatsApp drops oversized
  lists, so "all at once" is not an option
- size rule: `> 200 MB` cancels the send, `100–200 MB` sends as document,
  `≤ 100 MB` sends as video — the document threshold is the same rule YouTube
  uses (`decideYouTubeSend`), the 200 MB ceiling is anime-specific
  (see `src/utils/mediaSend.js`)
- resolution is fixed at `ANIME_MAX_HEIGHT` (480p): the provider's m3u8 carries
  240p–1080p and, with no limit, yt-dlp picked 1080p and blew past the 200 MB
  ceiling (a 24 min episode is ~470 MB at 1080p vs ~70 MB at 480p). The quality
  list picks the *source* (URL), not the final resolution

### Media Services

`src/services/ffmpeg.js` handles media conversion, including audio normalization and voice-note friendly formats.

`src/services/sticker.js` handles:

- static sticker processing
- animated sticker workflows
- EXIF metadata
- WebP packaging

## STACK

Runtime and dependency snapshot is in the root `package.json`

Project-level scripts:

- `npm start`
- `npm test`
- `npm run test:all`
- `npm run patch:baileys`

## BAILEYS_PATCHES

`node_modules/baileys` and `node_modules/libsignal` are intentionally committed to git
(see the negated entries in `.gitignore`), because the project ships local changes to
the baileys build output.

Patched files, all marked with `// Alterado por: Dev Gui` on the first line:

| File | Purpose |
| --- | --- |
| `lib/Socket/messages-send.js` | Adds the `biz` / `native_flow` binary nodes and normalizes `listMessage.listType`, without which WhatsApp silently drops buttons and lists. |
| `lib/Utils/messages.js` | Builds `interactiveMessage` from `buttons`, `interactiveButtons`, `cards` and `sections`, plus the legacy `buttonsMessage` / `listMessage` fallbacks. |
| `lib/Types/Message.d.ts` | Type declarations for the options above. Types only, no runtime effect. |

The single source of truth is `scripts/patch-baileys.mjs`. It contains the Baileys
compatibility edits directly, following the same self-contained pattern used by
Spider Bot X. The script applies transformations anchored to code snippets instead of
line numbers and uses sentinels to keep repeated runs idempotent.

The script runs on `postinstall`, so every `npm install` / `npm ci` reapplies the
edits. It is pure JavaScript and does not depend on the `patch` binary, which is absent
on Termux and slim Docker images. A missing anchor or required snippet throws an error
and stops the postinstall instead of leaving a partially compatible Baileys unnoticed.

Rules:

- never edit `node_modules/baileys` directly without also updating
  `scripts/patch-baileys.mjs`
- when bumping Baileys, run `npm install` and read the postinstall output; a failure
  means upstream changed one of the anchored snippets
- to fix an upstream change, update the anchor or replacement in the single script and
  rerun `npm run patch:baileys`

## HOSTING_AND_PTERODACTYL

The project README currently highlights the supported hosts in its installation section.
Treat `README.md` as the source of truth for host names and links.

Installation tutorials stay in `README.md`.

If the topic is about hosting, VPS setup, startup configuration, schedules, SFTP, Pterodactyl panel usage, or backup flow, agents should also load:

- `.agents/skills/pterodactyl-specialist/SKILL.md`

That skill is the specialized source for Pterodactyl guidance.

## STABILITY_AND_ERRORS

Stability mechanisms:

- `DEVELOPER_MODE` in `src/config.js` increases logging
- runtime logs are stored in `assets/temp/wa-logs.txt`
- `src/utils/badMacHandler.js` helps recover from repeated session failures
- TIMEOUT_IN_MILLISECONDS_BY_EVENT throttles event execution

Use these custom error classes:

- `InvalidParameterError`
- `WarningError`
- `DangerError`

These are expected by the bot flow and produce cleaner automatic replies.

## AGENT_RULES

Agents working in this repository should follow these rules:

- prefer `AGENTS.md` as the primary project context source
- use `README.md` for installation and end-user tutorials
- treat the repository as modular and file-oriented
- avoid manual JSON reads from `database/` in command code
- prefer existing helpers and services before adding new primitives
- never modify `assets/auth/` manually
- when supporting users, stay read-only unless explicitly asked to change code
- when support needs extra context, load only the relevant sections or files
- never expose the values of `OPENAI_API_KEY`, `LINKER_API_KEY`, or `SPIDER_API_TOKEN`

## SKILLS

This repository uses a local skills pattern to help AI agents load specialized context only when needed.

Current local skill directory:

- `.agents/skills/*`

Current local skill:

- `pterodactyl-specialist` → focused instructions for Pterodactyl panel usage, hosting workflows, files, databases, backups, schedules, bots, and APIs

Skill usage rule:

- if the topic is about hosting or **Pterodactyl**, load `.agents/skills/pterodactyl-specialist/SKILL.md`

This keeps support and agent workflows selective instead of forcing every answer to carry all hosting knowledge by default.

## DOESN'T RUNS

Do not run `npm test` or `npm start` in this repository.

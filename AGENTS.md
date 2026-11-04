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
| `src/interactive/flow.js` | Guided menu flow (menu → category → function → input) and the dispatch of the selected command. |
| `src/interactive/menuRegistry.js` | Guided-function registry (`FUNCTIONS`, `CATEGORIES`, `getFunction`, `listFunctions`) and the per-function `validador`/`aceita`/`args`/`entrada` metadata. |
| `src/utils/richTable.js` | Native WhatsApp tables (`RICH_RESPONSE_TABLE`) via `sendRichTable`, plus `sendTabela`, which sends a pricing table from `src/utils/tabelaPrecos.js` and falls back to aligned text when the relay fails. |
| `src/utils/tabelaPrecos.js` | Pricing-table data and formatting only (no Baileys): `TABELAS` (`dias`, `creditos`), `tabelaOpcoes()`, `tabelaIdDoArgumento()`, `formatTabelaTexto()`. |
| `src/@types/index.d.ts` | Typing and documentation for command and middleware props. |
| `src/services/spider-x-api.js` | Spider X integration for downloads, AI, Pinterest, Brat, and related endpoints. |
| `src/services/ytdlp.js` | Local downloads through the yt-dlp CLI (metadata, video, mp3) with GenDownload API fallback. |
| `src/services/anime.js` | Anime service layer over the single source: search, episodes, streaming sources. |
| `src/services/meusanimes.js` | Single anime source: WordPress search, seasons, and Blogger sources via the player API. |
| `src/services/bloggerVideo.js` | Blogger/Google Video reader (iframe, token, itags) used by `meusanimes`. |
| `src/services/megacine.js` | Megacine scraper: series/dorama search (films filtered via `MEGACINE_TIPOS_EXCLUIDOS`, empty by default), seasons, episodes and the m3u8 stream. |
| `src/utils/megacineMenu.js` | Interactive flow for séries/doramas/filmes: title → (faixa →) seasons/episodes, or faixa → quality → compress for a film. |
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
| `credits.json` | per-user credit accounts (daily + recharged) |
| `rate-limit.json` | per-user anti-flood counters (`day`, `count`, `lastCommandAt`) |
| `blacklist.json` | globally banned users (`bannedAt`, `motivo`, `expiresAt`, `bannedBy`) |
| `activity.json` | command counters, known users and the audit events of the panel |
| `system-samples.json` | RAM/CPU/disk samples that feed the panel charts |

Mandatory rule:

- **never** read these files directly with `fs.readFileSync` inside commands
- always use `src/utils/database.js`

This keeps persistence behavior consistent and avoids duplicated parsing logic.

### Remote mirror (optional, durable): Turso or MongoDB

The JSON files above are the **read cache**; a remote store is the **durable
target**. `src/services/remoteStore.js` picks the active driver (Turso first,
then Mongo), `src/services/turso.js` and `src/services/mongo.js` are the
drivers, and `src/utils/database.js` owns the mirror (`initDatabase`,
`flushRemoteState`).

- the 69 exported functions stay **synchronous** — that is deliberate. 69 files
  import this module, so making them async would be a large, risky refactor for
  no gain. Writes go to disk immediately and are mirrored to Mongo on a debounce
  (`MONGODB_FLUSH_DEBOUNCE_MS`), batched with `bulkWrite`
- one entry per state file, so the mapping with `database/*.json` is 1:1: a
  Mongo document in the `state` collection (`_id` = file name, `data` = value)
  or a `kakashi_state` row (name/data/updated_at) in Turso
- `initDatabase()` runs at boot and **restores from the remote before anything
  reads state**; on a first run with an empty remote it pushes the local files up
- the **session** (`assets/auth/baileys/`) is mirrored too, as the `session`
  entry (gzip+base64 of the whole folder, ~160 KB): `src/services/sessionStore.js`
  pushes it every `SESSION_SYNC_INTERVAL_MINUTES` and on shutdown, and
  `initDatabase` restores it before `connect()`, so an ephemeral-disk host does
  not force a re-pair. It holds the number's PRIVATE KEYS: the remote token is
  effectively access to the WhatsApp account
- **backups** live in the `kakashi_backups` table (one row per backup, with
  retention), not as a GitHub commit, when `BACKUP_TARGET=turso` (default).
  `.backup` flushes the pending mirror first so the archive includes the latest
  writes. A Turso backup sits in the SAME database as the data: it undoes an
  accidental delete, it does NOT survive losing the database
- `.apagar-dados confirmar` wipes remote **and** disk, because wiping only one
  side lets the other restore it at boot; `config` is kept on both sides since
  it holds the destination credentials
- to add a destination, implement the driver interface documented in
  `src/services/remoteStore.js` and register it there; `database.js` never needs
  to know which one is active
- **the bot must never die because of the remote store.** No credentials,
  unreachable server or bad token all fall back to plain JSON. A failed write
  keeps the file name in the pending queue and retries
  (`MONGODB_FLUSH_RETRY_MS`), and the flush reconnects first if the link
  dropped; the local disk value is never lost
- shutdown flushes the pending queue, otherwise the last write of a session is
  lost on restart
- credentials are secrets: env vars (`TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`,
  `MONGODB_URI`) or the same keys in `database/config.json` (not versioned).
  Never in `src/config.js`
- **Turso's console shows a `turso://` URL, which `@libsql/client` REJECTS**
  (`URL_SCHEME_NOT_SUPPORTED`; it accepts only `libsql:`, `wss:`, `ws:`,
  `https:`, `http:`, `file:`). `src/services/turso.js` rewrites `turso://` to
  `libsql://`, so pasting the console URL works
- `npm run migrate:remote` (`--dry-run` to preview) uploads existing JSON state
  to whichever driver is active
- `config.json` IS mirrored (it holds the tokens the owner sets over WhatsApp,
  which must survive a deploy) but `mongodb_uri`, `turso_url` and
  `turso_auth_token` are stripped before it leaves: copying the database
  credential into the database itself would turn read access into full access.
  They live only in the environment or the local file, and the boot restore
  re-adds the local ones so they are never lost

`readJSON` validates the shape of what it reads against the caller's default and
rewrites the file when it does not match. Pass the default **as a value**
(`{}`, `[]`), never serialized: `JSON.stringify({})` writes the string `"{}"`,
`JSON.parse` then returns a string, and assigning a key to it throws
`Cannot create property ... on string '{}'`. That is exactly how `mute` broke in
production, on a host whose `muted.json` was created from the bad default. The
same guard covers a truncated file, which used to make every later read throw.

### Persistence on ephemeral hosts

Hosts without a mounted volume start each deploy
from a fresh container. Two directories are lost, and losing either one is
visible to the user:

| Path | What is lost without a volume | Env override |
| --- | --- | --- |
| `database/` | credits, active subscriptions, pending payments, warns, prefixes, muted users, restrictions | `DATABASE_DIR` |
| `assets/auth/baileys/` | the WhatsApp pairing — the bot asks for the number again | `AUTH_DIR` |

Both paths are configurable **because each host mounts its volume at a different
path**. `src/config.js` reads `DATABASE_DIR` / `AUTH_DIR` and falls back to the
repository paths, so a host that mounts its volume at `/data` only needs
`DATABASE_DIR=/data` — no code change.

- `src/utils/database.js` and `src/connection.js` run `mkdirSync(..., { recursive: true })`
  on their directories at import time. A freshly mounted volume is empty, and
  without the `mkdir` the first write dies with `ENOENT` before the bot answers.
  Do not remove those calls.
- `database/` must be one volume, not two: the credits and the pending payments
  are read and written in the same flow.
- **the volume is what makes the data survive; a database engine does not.**
  Moving from JSON to SQLite/Postgres without a volume still loses everything on
  every deploy. Fix the volume first.
- on a host with a persistent volume the data survives start/stop/redeploy and
  is only lost when the volume is deleted. Never delete the volume to rename the
  service.
- `ANIME_DOCUMENT_LIMIT_MB` (500) assumes ~2x the media size on disk (the
  download plus the Baileys encrypted copy), so a 500 MB episode needs ~1 GB
  free. Check the host's disk and RAM before raising the limit.

### Automatic backup

`startBackupScheduler()` (`src/services/backup.js`) runs `createBackup()` every
`BACKUP_INTERVAL_HOURS` (default 2). It is started in `src/index.js` next to
`startRechargeSweeper`, so it only exists while the bot is connected.

- the automatic backup is always `includeAuth: false`: an unattended archive must
  never carry the WhatsApp private keys. The owner asks for those with
  `.backup sessao`
- `BACKUP_INTERVAL_HOURS=0` (or any non-positive/invalid value) disables the
  cycle; the backup goes back to manual only
- the last run is recorded in `database/backup-state.json` (`lastBackupAt`,
  `lastBackupOk`, `lastBackupError`). The state is what stops a redeploy from
  committing a backup on every restart: a run happens at boot only when the
  interval has already elapsed. A failed run is also recorded, so a broken token
  does not retry on every boot
- failures are logged and swallowed: the cycle must never crash the bot or
  interrupt the WhatsApp connection
- `shouldBackupNow()` and `backupIntervalMs()` are pure and exported for tests,
  and `startBackupScheduler({ runBackup })` takes an injectable runner, so the
  scheduling is exercised without uploading anything to GitHub

## MESSAGE_THEME

`src/utils/formatMessage.js` is the single template every command reply goes
through: `formatMessage({ icone, titulo, campos })` builds the framed body,
`ensureFrame` keeps an already-framed body from being framed twice, and
`RODAPE` is the footer. `moderationMessage` is the thin wrapper the moderation
commands use.

- the theme is **"I · Galáxia"**: a cosmic header (`☄️ · ✦ · ˚ ✧ · ☾`), the
  `┌─〔 icone *KAKASHI BOT • TITULO* 〕─┐` frame and the footer
  `✦ Constelado por Yanik Uaite ✦`
- `src/utils/mainMenu.js` builds the main card body with the same theme
  (`╭──────── 🪐 ────────╮`), so the menu and the replies do not drift apart
- changing the footer means changing it in ONE place (`RODAPE`), but the tests
  assert the literal string in several files (`menu.test.js`,
  `mainMenu.test.js`, `youtubeSearch.test.js`, `genDownloader.test.js`,
  `animeMenu.test.js`), so a footer change has to update those assertions too
- the image caption of a submenu is the same text as the frame, and WhatsApp
  caps a caption at 1024 characters. `menuMessage` (`src/menu.js`) drops the
  per-command hints first, then truncates with a pointer back to `.menu`, so
  the large `dono`/`dev` categories still fit. `menu.test.js` asserts the limit

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
- each table also carries a structured `valores` array (`{mt, creditos}` /
  `{dias, mt, bonus}`) next to the display `linhas`, so the recharge flow maps a
  paid amount to what it buys without parsing the presentation strings
- table 1 (`dias`) is the subscription plans: each plan pays one price and adds
  `bonus` credits PER DAY on top of `DAILY_FREE_CREDITS` for `dias` days (see
  SUBSCRIPTIONS)

## SUBSCRIPTIONS

A subscription is a day plan bought through the same payment flow as credits.
The member pays once (e.g. 45 MT) and, for the next N days, receives
`DAILY_FREE_CREDITS + bonus` credits every day at the 00h00 reset.

- the plans live in `TABELAS.dias.valores` (`{dias, mt, bonus}`); there is no
  second list to keep in sync
- `src/services/subscriptions.js` is the core: `activateSubscription`,
  `getSubscription`, `coversDay`, `daysRemaining`, `remainingBonus`,
  `dailySubscriptionBonus`, `cancelSubscription`, `listActiveSubscriptions`
- the record is a day RANGE, `[startDay, expiresDay[`, both in `YYYY-MM-DD`
  (Mozambique days, from `src/utils/clock.js`). The activation day counts; the
  expiry day does not. Comparing day strings avoids the DST/timezone traps that
  a timestamp comparison would bring
- **the bonus is paid per day, by the daily reset** (`applyDailyReset` in
  `credits.js` sets `dailyCredits = DAILY_FREE_CREDITS + bonus`). Crediting the
  whole `dias * bonus` at purchase would hand the total on day one and nothing
  after — the opposite of a subscription
- the activation day would be the only one without a bonus, because the reset
  only runs the next day, so `addDailyBonus` credits it immediately. It is
  idempotent per day via `account.subscriptionBonusDay`: when the account is
  created after the subscription already exists, `createAccount` is born with
  the bonus included and the later call adds nothing (no double credit)
- renewing while a plan is still running does NOT throw the remaining days away:
  the new plan starts on the old `expiresDay` and `extended` is true
  (`bonusToday` is 0 then, since the new plan has not started)
- the bonus is not a separate balance: it lives in `dailyCredits`, so it expires
  with the day, and the daily cap (`DAILY_FREE_CREDITS + bonus`) also bounds the
  refund in `refundCredits`
- `conta` shows the active plan, the daily bonus and the days left
- `database/subscriptions.json` holds the records, through
  `readSubscriptions` / `saveSubscriptions` — never read it with `fs` directly

Which table a payment belongs to is decided by the amount:

| Amount | `paymentIntent` | Result |
| --- | --- | --- |
| 5, 10, 30, 50 MT | `creditos` | credit pack |
| 45, 60, 90, 140 MT | `assinatura` | day plan |
| 20 MT | `escolha` | in both tables: ask |
| anything else | `null` | refused until the owner sets the credits |

20 MT is the only value in both tables (65 credits or 7 days). `handlePaymentSms`
asks "1 or 2"; the answer is stored IN THE PENDING REQUEST by
`setRechargeKind`, not only in the process memory, because the owner confirms
later and `confirmRecharge` reads the kind from the record. `src/utils/paymentChoice.js`
only tracks who still owes an answer (indexed by chat + author, so another
member's "2" cannot convert someone else's purchase) and its TTL is short on
purpose. Without an answer the request stays as credits and the owner can force
the other kind: `${prefix}recarga-confirmar <id> assinatura`.

`confirmRecharge` closes the request first, then activates the subscription and
credits the day's bonus. The credited amount reported for a plan is the plan's
`bonus`, not what that call happened to add — the member receives it either way.

## PAYMENT_RECHARGES

A member pays by e-mola or m-pesa and forwards the SMS to the bot. The owner
confirms the money by hand; nothing is credited automatically.

`pagamento` (member, free) is the public entry point: it shows the two numbers
with the account holder under each one (`PAYMENT_E_MOLA_NAME` = Yanik,
`PAYMENT_M_PESA_NAME` = Helton), the "forward the receipt SMS" instruction and
the owner's `wa.me` link. The holder name is what tells the member who they are
paying, so keep it next to the number it belongs to — never swap the two.

Flow:

1. `src/middlewares/onMesssagesUpsert.js` calls `handlePaymentSms` right after
   `loadCommonFunctions`, before the anime and guided flows (an open anime
   session would otherwise read the SMS as the anime name). The owner is skipped
   — he is the one who confirms.
2. `src/utils/paymentText.js` parses the SMS (`parsePaymentSms`) and is pure: no
   Baileys, no I/O. It reads the transaction id, amount, fee, destination, name
   and date/time for both operators, including the m-pesa AM/PM clock.
3. only SMS that name `PAYMENT_E_MOLA_NUMBER` / `PAYMENT_M_PESA_NUMBER` are
   treated as payments; a payment made to anyone else is ignored.
4. `src/services/recharges.js` records the transaction in
   `database/pending-recharges.json` keyed by the transaction id (or by a
   signature of the fields when the SMS has no id), so the same SMS cannot pay
   twice. Credits come from `TABELAS.creditos.valores` by the paid amount.
5. the group gets the matching table (day plans for a subscription, credit packs
   otherwise) plus a "payment received" note, and the owner gets the transaction
   details in a private interactive list (confirm/refuse), valid
   `PAYMENT_CONFIRM_TTL_MS` (10 hours). An ambiguous amount (20 MT) also asks the
   member "1 or 2" (see SUBSCRIPTIONS).
6. `confirmRecharge` closes the transaction before delivering, so a repeated
   click cannot credit twice; `declineRecharge` cancels without crediting. A
   credit pack calls `addCredits`; a plan calls `activateSubscription` and then
   `addDailyBonus` for the activation day.
7. after confirming, the owner command calls `notifyRechargeConfirmed`, which
   posts the confirmation in the chat where the SMS arrived (mentioning who
   paid) and then re-sends the credit table. The owner confirms in private, so
   without this the paying member never learns the credits landed.
8. `startRechargeSweeper` (started in `src/index.js`) expires stale requests
   every 5 minutes and warns the member where the SMS was sent. The menu timer is
   a weak guarantee (a new request replaces it), so expiry is confirmed here.

Owner commands: `recarga-confirmar`, `recarga-recusar` and
`recargas-pendentes`. A value outside the table is refused until the owner passes
the credits explicitly (`${prefix}recarga-confirmar <id> <creditos>`); the owner
can also force the kind with `... <id> assinatura` / `... <id> creditos`.

Do not credit on parse alone: the money is only real once the owner confirms.
Do not lower the "same SMS twice" guard — the transaction id is the only thing
stopping one payment from being credited repeatedly.

## CREDIT_GATES

Every member command checks the balance before running, not only at the end:

- `dynamicCommand` calls `hasSufficientCredits` and then `chargeCredits`; with no
  balance the command never starts and the member gets `creditsExhaustedMessage`
- `ANIME_EPISODE_CREDITS` (13) is charged per downloaded episode in
  `downloadAndSend`, after the same pre-check. The search and the menus cost the
  `anime` command price (`COMMAND_CREDITS.anime`, 2) — cheap because searching
  spends no bandwidth; the real cost is the episode that gets downloaded. A
  failed download is refunded with `refundCredits`, because nobody pays for an
  episode that never arrived
- `MEGACINE_DOWNLOAD_CREDITS` defaults to `ANIME_EPISODE_CREDITS`: both download
  an episode, and charging different prices for the same work would be arbitrary
- the owner (`OWNER_LID`) never pays, in commands or in the anime flow

### DOWNLOAD_CREDIT_TIERS

The download commands do not carry their own numbers; they point at one of three
named tiers in `src/config.js`:

| Tier | Credits | Commands |
| --- | --- | --- |
| `leve` | 3 | `tik-tok-audio`, `pinterest` |
| `medio` | 4 | `tik-tok`, `instagram`, `facebook`, `x-twitter`, `baixar` |
| `pesado` | 5 | `play-video`, `play-audio` |

- the tier is a **name**, so the price lives in one place: raising the
  social-video price no longer means editing six identical lines and risking
  leaving one behind
- `pesado` is the YouTube pair, which pays for the search on top of the download;
  `leve` is short audio and images, which barely spend bandwidth
- `credits.test.js` guards the order (`leve < medio < pesado`) and the anchor
  (`leve === 3`), so a future edit cannot silently invert the hierarchy
- the episode prices (`ANIME_EPISODE_CREDITS` 13, `MEGACINE_DOWNLOAD_CREDITS`)
  are **not** in `COMMAND_CREDITS`: they are charged per episode by the flow, not
  per command. `costsMessage` therefore prints them in their own block — without
  it the member would read `.anime — 2 créditos` and pay 13 per episode
- a daily allowance of `DAILY_FREE_CREDITS` (10) means one free episode does not
  fit at 13: the anime flow is deliberately just past the free tier, so it needs
  a recharge while staying cheap enough to use

## OWNER_CREDIT_ADJUSTMENTS

Two owner commands move a member's balance by hand, and they are the mirror of
each other:

- `${prefix}recarregar <créditos> @usuario` adds credits after a cash payment;
  the amount lands in `paidCredits`, which never expire
- `${prefix}remover-creditos <créditos|tudo> @usuario` removes credits
  (`removeCredits` in `src/services/credits.js`)

`removeCredits` spends the daily credits first and only then the recharged ones,
the same order as `chargeCredits`. The owner must know the consequence: the
daily part comes back at the 00h00 reset, so removing within the daily allowance
is not a permanent loss. A lasting removal has to reach `paidCredits`.

It is strict by default — asking for more than the balance removes nothing
instead of silently emptying the account. `allowPartial` exists for the `tudo`
shortcut, where removing whatever is left is the goal. Every removal is recorded
in `account.adjustments`, so a "my credits vanished" complaint has an answer.

Both commands are `owner`-scoped, so `checkPermission` blocks a common member:
without that barrier any member could empty another's balance.

## RATE_LIMIT_AND_DOWNLOAD_QUEUE

Two guards sit in front of the expensive work, both added to protect bandwidth
and to keep the bot from being banned for spam.

**Anti-flood** (`src/services/rateLimit.js`, state in
`database/rate-limit.json`):

- two independent brakes per user: a cooldown between commands
  (`COMMAND_COOLDOWN_SECONDS`, default 5) and a daily ceiling
  (`MAX_COMMANDS_PER_DAY`, default 200) that renews at 00h00 Maputo time, the
  same clock as the credits (`mozambiqueClock`)
- only `RATE_LIMITED_COMMANDS` are limited: the ones that spend bandwidth, CPU
  or paid APIs. Navigation (`conta`, `menu`) and moderation (`warn`, `ban`,
  `mute`) stay out, so the brake never blocks a moderator
- `checkRateLimit` and `registerCommandUse` are separate on purpose: the
  dispatcher checks first and registers only after the credits are charged, so
  a command refused for lack of balance does not consume the daily ceiling
- `dynamicCommand` runs the check before charging credits: a throttled user is
  never charged
- the owner is never limited; a throttled user gets `rateLimitMessage`, which
  says whether it is the cooldown or the daily ceiling

**Download queue** (`src/services/downloadQueue.js`):

- at most `DOWNLOAD_CONCURRENCY` downloads (default 1: one at a time) run at
  once; the rest wait, so two users no longer split the bandwidth and slow each
  other down. An invalid value (e.g. `DOWNLOAD_CONCURRENCY=abc`) falls back to
  the default instead of becoming `NaN` and stalling the queue forever
- every download goes through `withDownloadSlot`. The queue is entered inside
  `downloader.js` (`downloadMedia` / `downloadYouTubeVideo`), in the anime flow
  (`animeMenu.js`) and in the megacine flow (`megacineMenu.js`), so the limit
  applies to the download itself and not to the link resolution, which is fast
- the queue notifier is established in `dynamicCommand.js` for commands and in
  `onMesssagesUpsert.js` for the menu flows (anime, megacine, audio/video
  format). Without the middleware side the download is still serialized, but the
  position/turn messages never reach the chat
- the waiting user is told the position (`queuedMessage`) and warned when their
  turn arrives (`downloadTurnMessage`), instead of waiting in silence
- a request that waits longer than `DOWNLOAD_QUEUE_TIMEOUT_MS` leaves the queue
  with `QueueTimeoutError`. The timeout counts only the wait, never the
  running download
- the owner's downloads are queued with priority, so an urgent action does not
  sit behind member downloads
- the user notice uses the `withDownloadNotifier` context (same idea as
  `withCreditsContext`) because `sendReply` is not passed down through the
  download layers. **The notice is captured when the request is made, not when
  the download starts**: the `pump` that frees a slot runs inside the context of
  the request that just finished, so reading the context there would send
  someone else's "your turn" to the wrong chat. `downloadQueue.test.js` guards
  this with a test that fails if the capture moves back into `pump`

## BACKUP

`src/services/backup.js` builds the archive, `src/commands/owner/backup.js` is
the owner command, and `src/commands/owner/restore.js` pulls it back.

What goes into the archive, and what does not:

- `database/` — always. This is where the credits live
  (`database/credits.json`, `readCreditsAccounts`), plus the pending payment
  confirmations (`database/pending-recharges.json`), warns, prefixes, muted
  users and restrictions. **Anything the credits feature writes is backed up,
  because the whole folder travels.**
- `.env` — always. It carries the secrets.
- `assets/auth/baileys/` — **only with explicit authorisation**, via
  `.backup sessao`. These are the pairing private keys: whoever holds the
  archive can talk as the bot's number. `backupEntries({ includeAuth })` is the
  single place that decides this, and the default is `false`.

- on restore, the archive's session is **discarded** unless
  `.restore sessao` asks for it. `applyArchive` extracts to a temp directory
  first, drops `assets/auth/`, then copies into the project: a stale archive can
  no longer overwrite the pairing keys of a running bot, and an existing local
  session is left untouched. Restoring the session of an old or foreign archive
  is how a bot ends up unable to talk.

Destination: with `GITHUB_TOKEN` set it uploads to
`GITHUB_REPOSITORY`/`GITHUB_BACKUP_PATH` (`backups/kakashi-database.tar.gz` on
`main`). The default repository is `yanikuaite-commits/Servidor-`, a private
repo kept apart from the code so the project history does not accumulate one
copy of the archive per backup; `GITHUB_REPOSITORY` overrides it. Without a
token the archive stays local in `/tmp`. There is no scheduler — only the owner
command triggers it.

The upload **refuses a public destination** (`assertBackupDestinationIsPrivate`
→ `publicDestinationError`): it reads the repository and aborts before sending.
The archive carries the `.env` (and the session when `.backup sessao` is used),
so a public destination would publish secrets, and the GitHub commit history
keeps the blob after deletion. `GITHUB_BACKUP_ALLOW_PUBLIC=true` overrides the
refusal for an owner who accepts the risk. Keep `GITHUB_REPOSITORY` pointing at
a private repository.

A note on the refusal's blind spot: a token that cannot *read* the repository
(no `repo` scope) gets a 404, which the guard reports as a failure to reach the
repository rather than as "public". The send is still aborted, so the failure is
on the safe side, but a `404 Not Found` while the destination is private usually
means the token lacks scope, not that the repo is missing.

`.delete-backup` (`deleteRemoteBackup`) removes the remote file on request.
Deleting does not undo a publication: the commit history keeps the blob, so
secrets from an already-public archive must be rotated.

## GUIDED_MENU

`.menu` opens a guided flow (`src/interactive/flow.js`) that reuses the real
command handlers: it never duplicates download or AI logic. Steps: main card →
category → function → input → dispatch.

Registry rules (`src/interactive/menuRegistry.js`):

- `FUNCTIONS` entries are declared through `entry(categoria, id, comando, data)`
- `aceita` is the input type: `link`, `texto`, `midia` or `nenhum`
- `validador` is an extra boolean check on the raw text (ex.: the whitelist
  entry accepts only a LID)
- `args` are fixed arguments dispatched before the input (ex.: `add` for the
  whitelist, `custos` for the cost table), so the owner does not retype them
- `entrada` names what the input is in the error message (ex.: `um LID`).
  Without it a `texto` function validated by `validador` would say
  "um texto válido" even when it refused a non-LID
- the card's shortcut line shows the full command, including `args`

Category coverage:

- every category listed in `MENU_CATEGORIES` (`src/menu.js`) MUST have at least
  one entry, or it opens empty. `cinema` used to be exactly that: the card
  existed and the `megacine` entry did not
- `dev` (`Desenvolvedor`, 🧑‍💻) holds the 39 `enviar-*` examples and is
  `restrita: "owner"` — they are developer samples, not member features
- `menuRegistry.test.js` guards all of it: every entry must resolve to a real
  command, no category may be empty, and every function needs `titulo`,
  `descricao` and `guia`

Owner category (`dono`) rules:

- adding someone to the private whitelist is a guided flow: the owner picks the
  function and sends only the LID; `args: "add"` supplies the action
- the whitelist command parses `fullArgs` by whitespace. `args` from
  `extractDataFromMessage` splits on `\`, `|` and `/` — NOT on space, so
  `.private-whitelist add <lid>` would arrive as a single `args[0]`. Any command
  taking space-separated arguments must read `fullArgs`
- the LID is normalized to `digits@lid` (`275381038891241:12@lid`, the bare
  number and the number with `+`/spaces all collapse to the same entry)

`handleAnimeReply` runs BEFORE `handleGuidedFlow` in the message middleware, so
the anime session owns the name typed after `.menu → Animes`.

### Text mode (prefix `!`)

Some clients do not render interactive messages at all (iOS, for example): the
card is delivered but shows nothing the user can tap. The `!` prefix is the way
out — it invokes the command exactly like `.` does, and asks for the TEXT
version of every menu.

- `dynamicCommand` sets `textOnly: prefix === "!"` on the invocation, and
  `loadCommonFunctions` exposes the same value to every command. There is no
  separate `!`-only command set: `!menu`, `!play video x` and `!anime x` are the
  same commands
- `sendInteractiveWithFallback({ textOnly })` skips the card entirely and goes
  straight to `numberedFallback`. The numeric actions are still registered, so
  answering `1` works exactly as in the fallback — the difference is only that
  the card message is never spent
- `textOnlyBody()` strips the "Não consegui abrir o menu interativo 😕" notice,
  which only makes sense when the card was actually attempted and failed
- the flag lives in the session (`session.textOnly` in `flow.js`, the same in
  `animeMenu.js` and the format menus) so the whole flow stays in text mode. The
  most recent intent wins: opening with `.menu` turns the buttons back on
- numeric answers are resolved against `session.lastRows` (the rows of the last
  card sent), so "3" means the third row. A number outside the range is not
  consumed and the message continues through the normal flow
- with a format menu open (video quality / audio format) `handleGuidedFlow`
  refuses the number and lets it reach the format menu: with a quality list on
  screen, "1" is the first quality, not option 1 of the card
- `src/@types/index.d.ts` documents `textOnly` in `CommandHandleProps`

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

## AI_CHAT

The chat commands (`.gpt`, `.gemini`, `.deepseek`, `.kakashi`) all go through
`askGroq` in `src/services/ai.js`.

- **the AI has a personality**: it greets and answers simple small talk ("tudo
  bem?" → "Tudo bem! E contigo?"), then stays on the bot and simple maths. The
  rule lives in `GROQ_SYSTEM_PROMPT` (`src/config.js`), so the owner can widen
  it without touching the service
- the system prompt is **prepended on every request**, not stored in the
  history: the history keeps only the conversation, so after a few messages the
  instruction would fall outside the sliding window and the scope would drift
- **answers are short on purpose**: `GROQ_MAX_TOKENS` (512) and
  `GROQ_TEMPERATURE` (0.3, down from 0.6). High temperature made the model pad
  every answer; a factual assistant wants a low one
- `askGroq` still falls back through `GROQ_MODELS` on a retryable status
  (429/500/502/503) and keeps a short per-chat history (`GROQ_HISTORY_SIZE`)

### Bot knowledge (all users)

The AI answers command and recharge questions with the **real** data because
`askGroq` injects a knowledge block as a second system message.

- `src/services/botKnowledge.js` builds it: `commandCatalogText()` (one line per
  command, "name: description"), `paymentGuideText()` (the recharge steps plus
  both pricing tables) and `botKnowledgeText()` (both, plus a short intro)
- the command list comes from **the same loader the dispatcher uses**
  (`readCommandImports` in `src/utils/index.js`), so it cannot drift from the
  commands that actually exist; the prices come from `TABELAS`
  (`src/utils/tabelaPrecos.js`) and the numbers from `src/config.js`
- **the developer samples are filtered out** (`EXEMPLOS_DEV`): `enviar-*`,
  `exemplo*`, `funcoes-*`, `obter-*`, `raw-message` live in the `member` folder
  but belong to the `dev` category, which is owner-only. Listing them to a
  common member would promise features he does not have. Owner-only commands are
  never listed either, except the ones that describe a public flow
  (`recargas-pendentes`)
- the block is **shared, not per-user**, so it goes to every member: a member
  must be able to ask "how do I recharge?". The owner's state block is separate
  and still owner-only
- **it is built once and cached** (the promise, so two simultaneous first
  questions do not import the ~175 command files twice). A failed build is not
  cached, so the next question retries
- the read is wrapped in `try/catch`: if the catalog fails, the AI answers
  without the guide instead of the command breaking
- keep the block small: it is sent on every chat request. It is ~2.5k tokens
  today; adding whole files would raise the cost of every question

### Live bot state (owner only)

The owner can ask the AI about real numbers ("quantos usuários estão na
whitelist?") because the command injects a **state block** as an extra system
message.

- `src/services/botSnapshot.js` builds it: `botCounts()` (whitelist, bans,
  muted, subscriptions, credit accounts, pending recharges, auto-answers,
  blocked commands, API keys configured), `botSnapshotText()` (the text block),
  `ownerSnapshotContext()` (sync, `null` for non-owners) and
  `resolveOwnerContext()` (async, also asks the socket for the group count and
  the current group's name/size)
- **the block is injected only for the owner.** A common member gets
  `context: null`, so a member cannot read the bot's internals through the AI
- the three commands pass `isOwner`, `socket`, `isGroup`, `getGroupName` and
  `getGroupParticipants` to `resolveOwnerContext`, which returns `null` for a
  member **before** touching the socket — no wasted call
- **the state is never written to the history**: it is a system message rebuilt
  per request. Storing it would pin a stale snapshot to the conversation and
  leak it into later member-facing replies
- the block **never contains secret values**, only names and
  configured/missing state, because it is sent inside the HTTP request to Groq
- `GROQ_OWNER_CONTEXT_PROMPT` tells the model to answer with the real values and
  not to invent or round them; a metric the host cannot provide comes back
  `n/d` rather than a fabricated number
- reads go through the `database.js` accessors (`readMutedMembers` was added
  for the muted count), never `fs` directly, and a failure to read any part of
  the state returns the snapshot without it instead of breaking the command

### Executing commands (owner and group admin)

The AI can also *run* a command when the request is explicit ("Kakashi, ativar
anti status"). The whole design is "the AI asks, the dispatcher decides":

- `askGroq` returns `{ text, action }`, not a bare string. With
  `allowCommands: true` it adds two system messages: `aiActionHelpText()` (the
  exact list of what exists) and `GROQ_ACTION_PROMPT` (answer with
  `{"action":"run","command":"...","intent":"on|off"}` **only** for an explicit
  request, text otherwise)
- `parseAiAction` (exported, pure) reads that JSON and **never throws**: a
  fenced block is unwrapped, and anything that is not a valid request returns
  `null` and is treated as ordinary text
- `resolveAiAction` maps the model's name to a real command, with an explicit
  `args` (`1`/`0`). An unknown name, a member command or a forbidden one returns
  `{ ok: false }` and the bot answers with a hint instead of running anything
- **the AI never writes state.** `src/utils/aiChat.js` builds a synthetic
  message and calls the same `dynamicCommand` a typed command goes through, so
  `checkPermission`, the anti-flood brake, credits and the error replies are all
  the real ones. The AI is a language front-end, not a second permission path
- **the executable set is a small positive list**, not "everything minus the
  dangerous ones": only the group toggles (`anti-*`, `welcome`, `exit`,
  `auto-*`, `only-admin`) and `abrir`/`fechar`. `AI_FORBIDDEN_COMMANDS` is a
  second, redundant barrier (ban, delete, mute, keys, backup). Member commands
  are deliberately out: "Kakashi, anime X" would otherwise start a paid download
  from an ambiguous sentence — whoever wants the command types it
- `allowCommands` is `isGroup && (isOwner || isAdmin)`. A common member never
  even receives the action prompt, so the model cannot be talked into emitting
  one; and the dispatched command still re-checks the permission anyway
- the action is **stored in the history as `[pedido de comando: X]`**, never as
  the raw JSON, so a later reply does not echo the protocol
- `src/test/aiActions.test.js` proves the layers: a common member does not
  toggle anything, an owner and a group admin do, and a plain text answer runs
  nothing. `src/test/botCommands.test.js` covers the catalog and the refusal of
  forbidden/member/invented names

## AFK

Two layers, both stored in `database/afk-groups.json` through
`src/utils/database.js`:

| Layer | Key | Covers |
| --- | --- | --- |
| per group | the group JID | only the group where it was set |
| global | `__global__` | every group |

The reserved `__global__` key cannot collide with a real group, because a group
JID always ends in `@g.us`.

- `.afk <motivo>` is admin-scoped. A **common member** sets only the per-group
  absence; the **owner** (`isOwner`, injected into `handle()`) sets both layers
  and the bot broadcasts the notice to every group it is in
- the broadcast (`src/utils/afkBroadcast.js`) lists the groups from the socket
  itself (`groupFetchAllParticipating`), not from disk: a stored list goes stale
  as groups are created or left. It skips the group where the command was typed
  (that one already got the reply), marks the absent member (`mentions` plus the
  `@<number>` token in the text) and waits `BROADCAST_DELAY_MS` between groups,
  because blasting the same message to many groups is what WhatsApp reads as
  spam. A group that fails is logged and skipped, never fatal
- `handleAfkReferences` (`src/middlewares/afkHandler.js`) answers when a message
  **mentions or quotes** an absent member, in any group the global layer covers.
  The reply carries the mention (`mentions` plus the `@<number>` token in the
  text, without which the mention does not render)
- **any message from the absent member cancels the absence** (per group and
  global), which is the "I'm back" signal. The `.afk` command is exempt, so
  writing `.afk <motivo>` renews instead of cancelling
- cancelling as owner clears **both** layers; clearing only the global would
  leave the per-group record behind and the member would still be "absent" in
  that group
- the handler reads both layers in one call (`getAfkSnapshot`), because it runs
  on every group message and two file reads per message would be wasted I/O

## API_KEYS

Every credential the bot uses can be set over WhatsApp by the owner, instead of
editing `src/config.js` on the host. The registry lives in `src/utils/database.js`
(`API_KEYS`) and the behaviour in `src/utils/apiKeyCommand.js`.

| Command | Key | Used by |
| --- | --- | --- |
| `.set-github-token` | `github_token` | `.backup` upload |
| `.set-spider-api-token` | `spider_api_token` | `spider-x-api.js` (downloads, AI, Pinterest, Brat) |
| `.set-linker-api-token` | `linker_api_key` | `linker.js` (`gerar-link`) |
| `.set-groq-api-token` | `groq_api_key` | `ai.js` (chat, transcription) and `suporte.js` |
| `.set-gemini-api-token` | `gemini_api_key` | `gemini.js` (image generation) |
| `.set-hf-token` | `hf_token` | reserved (no consumer today; the AI moved to Groq/Gemini) |

- `.api-keys` lists every key with its state (`definida no WhatsApp`, `vinda do
  ambiente`, `ausente`) and how to get each one. It is the guided entry point;
  the per-API commands are the shortcuts
- **`.api-keys <nome> <chave>` is the shortcut the error messages announce**
  (`.api-keys groq <chave>`): it resolves the short name (`groq`) or the registry
  name (`groq_api_key`) and runs the same action as the dedicated command, so the
  two paths cannot drift. With the name alone it shows that key's state, and
  `remover` in place of the value deletes it. The action lives in
  `runApiKeyAction` (`apiKeyCommand.js`); the factory and `.api-keys` both call it
- **the value is never printed back**: the confirmation shows only the last 4
  characters (`••••abcd`). The chat can be read by someone else, and the
  `config.json` goes into the backup
- the value defined over WhatsApp **wins over the environment**. That is
  deliberate: `database/config.json` is not versioned, so an owner who sets a key
  by chat should not have it silently replaced by the host's `GROQ_API_KEY` on
  the next boot. `removeApiKey` (the word `remover` in place of the key) drops
  the stored value and lets the environment one apply again
- `getApiKey(name)` resolves stored → environment; `listApiKeys()` reports which
  one is in force. The old `getSpiderApiToken` / `getGithubToken` are thin
  wrappers and keep working
- the commands come from one factory (`buildApiKeyCommand`), so validation is
  identical everywhere: a key that is too short for that provider or that
  contains whitespace is refused with `InvalidParameterError` before anything is
  written
- **services read the key at call time, not at import time.** A key set over
  WhatsApp takes effect without a restart: `ai.js`, `gemini.js`, `linker.js` and
  `suporte.js` call `getApiKey` inside the function, and `linker.js` still falls
  back to the Spider token when it has none
- the registry is the single place to add a new credential: declare it in
  `API_KEYS` and create the thin command in `src/commands/owner/`
- `LINKER_API_KEY` in `src/config.js` no longer carries a placeholder — it reads
  the environment, because the repository is public

## SERVICES

### Spider X API

`src/services/spider-x-api.js` powers:

- downloads from TikTok, YouTube, Instagram, Facebook, Pinterest
- AI endpoints such as Gemini, GPT-5 Mini, Flux
- sticker endpoints such as `attp`, `ttp`, and `brat`
- utility endpoints used by several commands

It depends on `SPIDER_API_TOKEN`, which can come from:

- `src/config.js`
- runtime database config through `/set-spider-api-token` (or `.api-keys`)

### yt-dlp

`src/services/ytdlp.js` runs the yt-dlp CLI locally: metadata (`--dump-single-json`,
which feeds the credit cost by duration), video downloads, mp3 extraction and
`isYtDlpAvailable()`. `src/services/downloader.js` prefers yt-dlp and falls back to
the GenDownload API when the binary is missing or the extraction fails.

- the binary is installed by the `Dockerfile` (standalone `yt-dlp_linux`, no Python)
- `npm run setup:ytdlp` downloads it to `bin/yt-dlp` on non-Docker hosts; Termux uses `pkg install yt-dlp`
- configuration lives in `src/config.js` under the `YTDLP_*` constants (`ENABLED`, `PATH`, `TIMEOUT_MS`, `COOKIES_PATH`, `PROXY`, `JS_RUNTIME`, `IMPERSONATE`, `EXTRACTOR_ARGS`, `CONCURRENT_FRAGMENTS`)
- `YTDLP_ENABLED=false` disables it entirely; nothing breaks without the binary
- `YTDLP_TIMEOUT_MS` caps a single yt-dlp run (default 30 min). It used to be 5 min, which killed long downloads mid-flight: a 24 min episode at 480p (~95 MB) can take ~7 min on a slow host, and the kill is silent — `execFile` sends SIGTERM, so stderr is empty and the raw `Command failed: <full command>` (signed CDN URL included) was what reached the user. It was raised to 15 min and then to 30 min, to match the 500 MB ceiling. `friendlyError` recognises `killed`+`SIGTERM` and reports the timeout, and falls back to a generic text instead of echoing the command when stderr is empty
- `YTDLP_CONCURRENT_FRAGMENTS` sets the yt-dlp `-N` (default 4). CDNs that rate-limit parallel requests need `1`, otherwise yt-dlp drops fragments and fails with `No such file ...-FragN`
- YouTube blocks datacenter IPs with "Sign in to confirm you're not a bot"; the fix is cookies or a residential proxy, never a flag

Media sending must stream, never buffer: use `mediaUploadFromFile()` from
`src/utils/mediaSend.js` (returns `{ stream }`) instead of `fs.readFileSync`.
The Baileys path encrypts chunk by chunk, so a 350 MB episode costs ~65 MB of
RSS as a stream against ~351 MB as a buffer. A host with 512 MB of RAM gets
the process killed by OOM when buffering a large episode, so check the RAM
before sending big files.

Sent files carry the search title, not a fixed name: build it with
`safeMediaFileName()` (same module) instead of hardcoding `"anime.mp4"` /
`"megacine.mp4"`, otherwise every episode lands as the same indistinguishable
file. Only documents can be named — the WhatsApp `VideoMessage` proto has no
filename field, so a video sent as video carries no name at all.

### Animes (fonte única: meusanimes)

`src/services/anime.js` é a camada de serviço sobre a **fonte única**
`src/services/meusanimes.js`; `src/utils/animeMenu.js` corre o fluxo interativo
(nome → faixa → pesquisa → temporadas → episódios → qualidade → download) e
`src/utils/animeFormat.js` guarda os helpers puros. `src/services/bloggerVideo.js`
lê os degraus (360p/720p) do CDN do Blogger, que é o que o `meusanimes` publica.

- **o `meusanimes` (`meusanimes.blog`) é a única fonte.** Responde de um IP de
  datacenter **sem desafio Cloudflare**, agrupa temporadas na página do anime e
  serve o episódio pelo player do Blogger. A cadeia é: `/?s=<termo>` →
  `/a/<slug>/` (o bloco `id='seasons'` traz todas as temporadas e os episódios)
  → `/e/<ep-slug>/` (um iframe
  `serv01.meusdoramas.club/#/video/<tmdb>/<season>/<episode>`) →
  `serv01.meusdoramas.club/posts/get-video.php?episode_number=&season_number=&tmdb=`
  → `{success, videoUrl}` com um link do Blogger → o URL direto
  `googlevideo.com`. O player é uma SPA React noutro domínio e o endpoint real é
  `posts/get-video.php` — os caminhos óbvios `api/video/...` respondem 404. A
  resposta do `get-video.php` é idêntica **com e sem cookies** (o cookie
  `starstruck_...` do site é só de sessão), pelo que a fonte não guarda estado: a
  tripla `tmdb`/temporada/episódio viaja dentro do id do episódio
- **a faixa dublada é uma ENTRADA separada** (`/a/<base>-dublado/`). O sufixo é
  convenção do site mas não garantia — `naruto-shippuden` serve um dub sem
  sufixo —, por isso a faixa real é confirmada na página do PRIMEIRO episódio
  (`span.qualidade` diz "Dublado" ou "Legendado") antes de a lista ser rotulada.
  Sem essa confirmação a fonte podia chamar a um episódio dublado "legendado",
  que é exatamente o defeito que o fluxo de áudio corrige. `candidatosDeSlug`
  ordena as entradas a tentar; o passo de faixa também passa por `seasons()`,
  porque o índice de temporada só é válido dentro da entrada onde foi lido
- **a fonte publica o itag 18 (360p, ~89 MB num episódio de 23 min) e o itag 22
  (720p, ~285 MB) como fontes distintas**, pelo que o menu de qualidade oferece
  ambas e a regra de tamanho decide o que pode ser enviado. **Nem todo o episódio
  traz as duas**: episódios antigos publicam só 360p, pelo que uma lista de
  qualidade com um item é normal, não uma falha
- **a cadeia real ponta-a-ponta foi verificada**: página do episódio →
  `get-video.php` → token do Blogger → bytes do `googlevideo.com`, com `206`,
  `video/mp4` e um cabeçalho `ftyp` válido, e o yt-dlp a descarregar o ficheiro.
  Como todo o site PT-BR indexado em romaji, um termo em inglês pode ainda cair
  num spin-off (`attack on titan` → o Junior High), que é uma limitação da
  correspondência por título
- **a faixa dublada desta fonte é PT-BR** (`ANIME_PT_DUB_PROVIDERS` em
  `src/config.js`). A faixa é um booleano no site ("dubbed" ou não), mas o
  IDIOMA dessa dublagem pertence ao SITE. Com a fonte única atual (um site
  brasileiro) a lista só tem esse nome; o mecanismo mantém-se porque o rótulo do
  card (`Dublado (PT-BR)`) e o aviso de idioma ainda o consultam
- **os cabeçalhos do download são os do CDN do Blogger**: `Referer` do Blogger
  **e** um `User-Agent` de browser. Sem o `User-Agent` o CDN responde 403 mesmo
  com o `Referer` certo. É o que `animeDownloadArgs()` em `src/utils/animeMenu.js`
  acrescenta à chamada do yt-dlp
- **a faixa é perguntada ANTES da pesquisa, não antes da lista de episódios**
  (`anm:aud:subbed` / `anm:aud:dubbed`). O utilizador escolhe a faixa assim que o
  nome é conhecido e a pesquisa corre já com ela. Perguntar depois da lista
  significava que um título que só existe legendado nunca podia satisfazer um
  pedido de dublado, e o utilizador só o descobria no fim — depois de toda a
  pesquisa — e tinha de repetir o pedido. `session.pendingName` guarda o nome
  enquanto a pergunta está no ecrã, e `chooseAudioVersion` ramifica por ele: com
  um nome pendente começa a pesquisa, senão recarrega a lista existente
- **a faixa é perguntada sem tocar na rede, por isso não pode ser derivada da
  lista.** As duas faixas são sempre oferecidas; a fonte decide se as tem.
  `availableAudioVersions` (UNIÃO dos `versions` por episódio) ainda é usada, mas
  agora só para CONFIRMAR a resposta, nunca para decidir se se pergunta
- **quando a fonte não tem a faixa pedida, o bot diz e cai para a que tem**
  (`carregarEpisodiosComFaixa`). Servir a outra faixa em silêncio é o defeito que
  este fluxo existe para corrigir, pelo que o utilizador é avisado:
  "⚠️ Esta fonte não tem dublado deste título. Vou mostrar legendado." A
  verificação lê as FAIXAS PUBLICADAS da lista devolvida, não o sucesso da
  chamada. Uma fonte que não publica faixa nenhuma (`[]`) não gera aviso, porque
  não há nada a comparar e um aviso com rótulo vazio é pior do que o silêncio
- **a regra da faixa é uma UNIÃO, não uma interseção**: exigir que todos os
  episódios tivessem as duas faixas parece mais seguro mas esconde a escolha
  quase sempre. Um episódio que não tem a faixa escolhida falha com uma mensagem
  clara, o que é melhor do que nunca oferecer a escolha
- a faixa escolhida é guardada em `session.audioVersion` e viaja como terceiro
  argumento de `getEpisodeSources(episodeId, provider, audioVersion)`. O card
  mostra-a (`Dublado (PT-BR) · 480p`) para o utilizador confirmar o que foi
  enviado
- **uma pesquisa sem correspondência exata pergunta ao utilizador em vez de
  adivinhar.** O fluxo caía no PRIMEIRO resultado da fonte, pelo que "Meu Hero
  Academia" servia "Eiyuu Kyoushitsu" — outro anime — sem aviso.
  `searchAnimeCandidates` devolve `{anime: null, candidatos}` quando nada
  corresponde exatamente, e o menu mostra uma lista de candidatos (`anm:an:<i>`).
  `searchAnime` mantém o comportamento antigo (primeiro resultado) para os
  outros chamadores. A comparação é `correspondenciaExata`, que ignora os
  sufixos que só o site usa ("Black Clover" corresponde a "Black Clover Dublado")
- **a tradução é o último recurso, nunca o primeiro passo**
  (`TRANSLATE_ENABLED`, `src/services/translate.js`). O termo original é
  pesquisado primeiro, porque o `meusanimes` já indexa muitos aliases PT
  ("Ataque dos Titãs" → "Shingeki No Kyojin"); só quando não há correspondência
  exata é que o termo é traduzido e pesquisado de novo. Uma tradução que devolve
  o mesmo texto é descartada, e qualquer falha (sem rede, erro HTTP) devolve
  `null` para o download seguir com o termo original — a tradução nunca pode
  bloquear um download
- **uma lista de candidatos leva a capa no cabeçalho interativo** (`image` +
  `interactiveButtons`). O carrossel (`cards`) não pode ser usado aqui:
  SOBREPÕE `interactiveButtons` no `generateWAMessageContent`, e sem a lista o
  utilizador não consegue escolher. As capas vêm de `capaEmTamanhoGrande`, que
  tira o sufixo WordPress `-150x150` (a miniatura é ilegível num card). Dois
  detalhes do Baileys importam: o corpo tem de ser enviado como `caption` (com
  `text` a imagem do cabeçalho é descartada)
- **uma mensagem de quem não pediu o menu é ignorada em SILÊNCIO.** Antes, cada
  mensagem de terceiros recebia "não foste tu que pediste o menu" de volta, pelo
  que qualquer conversa do grupo com um menu aberto virava resposta do bot. Agora
  `handleAnimeReply` devolve `false` para um não-dono (a mensagem segue o fluxo
  normal) e a sessão continua à espera do dono; um token expirado é ainda
  respondido, porque esse não tem sessão para esperar
- os episódios são listados 10 de cada vez (`anm:ep:<i>` usa o índice ABSOLUTO)
  com uma única linha `anm:pg:<p>` "ver mais" no fundo para o resto, para a lista
  ficar curta e todos os episódios continuarem alcançáveis — o WhatsApp descarta
  listas demasiado grandes, pelo que "tudo de uma vez" não é opção
- as linhas das listas levam só índices (`anm:ep:<i>` / `anm:src:<i>`); os URLs
  de stream reais (longos, assinados) ficam na sessão, porque o WhatsApp descarta
  `rowId`s demasiado grandes
- regra de tamanho: `> 500 MB` cancela o envio, `100–500 MB` envia como
  documento, `≤ 100 MB` envia como vídeo — o limite de documento é a mesma regra
  do YouTube (`decideYouTubeSend`), o teto de 500 MB é específico dos animes
  (`ANIME_DOCUMENT_LIMIT_MB`, `src/utils/mediaSend.js`)
- a resolução é fixada em `ANIME_MAX_HEIGHT` (480p): a fonte publica 360p e
  720p, e fixar 480p mantém o episódio leve. A lista de qualidade escolhe a
  *fonte* (URL), não a resolução final
- o `yt-dlp` descarrega o m3u8/mp4 devolvido; o timeout de uma execução é
  `YTDLP_TIMEOUT_MS` (default 30 min) e o teto de cancelamento é o mesmo
  `ANIME_DOCUMENT_LIMIT_MB` (500 MB)
- se um dia for preciso reabrir outra fonte, o ponto de entrada é `FONTE` em
  `src/services/anime.js`; nunca hardcode um domínio dentro de um comando
### Megacine (séries + doramas + animes episódicos)

`src/services/megacine.js` scrapes `megacine.online` directly; `src/utils/megacineMenu.js`
runs the interactive flow (nome → título → temporadas → episódios → download) and the
command is `src/commands/member/downloads/megacine.js` (aliases `serie`, `series`,
`novela`, `novelas`).

- **this is a SEPARATE command (`.megacine`), not an anime provider.** The catalogue
  is episodic series with seasons, which the `.anime` flow does not cover; mixing the
  two would conflate catalogues with different rules.
- **films are now INCLUDED** (`MEGACINE_TIPOS_EXCLUIDOS` is empty by default; set it
  to `filmes` to restore the old episodic-only behaviour). A film is a single
  download with no seasons, so it takes a different, shorter path — see "Filmes"
  below. The search returns `tipo: "filme"` and `chooseCandidate` branches on it.
- the chain is: `/search/?q=` → `/series/<slug>` → `/series/<slug>/temporada-NN/episodio-NN`
  → the page's `urlConfig` → `<S>/<slug>/<NN>-temporada/<NN>/stream.m3u8`
  (`<S>` is the slug's first letter, uppercased). `buildStreamPath` mirrors the
  site's own `construirStreamPath`.
- the data domain has two sides and only one answers datacenter IPs: the primary
  `ondemand.madfirebox.shop` returns Cloudflare 403 ("you have been blocked"), while
  the fallback `forks-<tipo>.madfirebox.shop` serves the m3u8 normally. The bot uses
  the fallback directly.
- **there is only ONE quality** (a media playlist of `.ts` segments, no
  `EXT-X-STREAM-INF`), so the flow has no quality step — asking for a choice that does
  not exist would be a fake step. The size ceiling still applies at download time.
- **the CDN is slow: 9–28 s for the manifest alone**, against ~1 s for the site's HTML
  pages. Verifying the playlist with the short page timeout aborted streams that were
  fine — the user saw "the source did not respond" on a title that worked. That step
  therefore uses `MEGACINE_PLAYLIST_TIMEOUT_MS` (60 s), not `MEGACINE_TIMEOUT_MS`.
- **the reachability check walks the candidate mirrors.** `getEpisodeStream` /
  `getFilmeStream` return a `candidatos` array and the menu resolves it with
  `primeiroAlcancavel` before charging credits, because one CDN can answer `404`/`503`
  alone while another serves the same episode. Testing only the first URL rejected
  titles that were available (measured: 78% → 82% on a 50-title sample).

- a non-owner message while a menu is open is ignored in SILENCE (same rule as the
  anime flow), so group chatter does not turn into bot replies.

Newer additions to the flow:

- **covers come from the site's own `fichas.txt`**, not from a TMDB call: it is a
  TAB file with `tipo  título  tmdbId  pôster  gêneros` and a `capa:` header giving the
  image base (`https://image.tmdb.org/t/p/w342`). `parseFichas` + `posterDoTitulo`
  (`src/services/saimo.js`) build the URL, so the bot needs no TMDB key of its own.
  A title with no ficha simply goes without a cover — the image is an extra.
- **the results list is paginated 20 per page** (`RESULTS_PER_PAGE`), with a
  `mgc:pg2:<página>` "🔎 Ver mais resultados" row when there is a next page. The full
  list is kept in `session.allCandidates` (up to `MAX_RESULTS`, 60) and the page is a
  slice, so "ver mais" never re-searches. The row ids carry the ABSOLUTE index
  (`mgc:an:<índice>`), which is why `buildCandidateRows` takes an `inicio`.
- **dublado/legendado is asked when the source publishes both** (`mgc:aud:<faixa>`),
  right after the title is chosen and before the seasons. The tracks are a UNION over
  the episodes (`availableAudioVersions`); a single track is fixed silently. At
  download time `getEpisodeStream(slug, temporada, episodio, faixa)` serves the
  requested track and **falls back to the one that exists, warning the user** instead
  of switching in silence. The caption shows the track that was actually sent.
- films are handled by their own branch (see "Filmes" below); the search no longer
  skips `tipo === "f"`.

### Filmes (single download, with compression)

A film is one MP4 with no seasons, so it skips the season/episode steps and takes a
short path: **faixa → quality → download → compress → send**. The catalogue lives in
`filmes-<L>.txt` (one file per letter, no index/pedaços), parsed by `parseFilmes`
into `{ titulo, dub: [urls], leg: [urls] }`; `getFilmeInfo` reads the tracks and
`getFilmeStream(slug, faixa)` returns the URL with the track actually served.

- **the proxy mirror is alive; it redirects.** A line's `dub=`/`leg=` carries
  MIRRORS of the same content (the site's `saimo-tv.pages.dev/api/stream` proxy
  and a direct CDN URL), not qualities. The proxy answers `302` to a
  `workers.dev` host that serves `206 video/mp4`, and `fetch` follows it by
  default — it is NOT dead. Measured over the whole catalogue (28838 lines):
  82% carry at least one direct `.mp4`, 14% carry ONLY the proxy, and the rest
  carry both. `melhorUrl` prefers the `.mp4` (fewer hops), which is fine; do not
  change it to prefer the proxy, and do not assume the proxy is broken.
- **a title's mirrors are a fallback chain, not a single URL.** Measured
  end to end on a 50-title sample with the real `isPlaylistReachable`: one
  candidate answered for 78% of titles; walking the candidates (other CDN, other
  track) raised it to 82%. `getFilmeStream`/`getEpisodeStream` therefore return a
  `candidatos` array (preferred first, then the rest, then the other track) and
  the menu resolves it with `primeiroAlcancavel`, instead of testing only the
  first URL and giving up. A dead mirror alone is NOT proof the title is
  unavailable.
- **the remaining failures are a source limitation, not a bug to patch.** Some
  proxy ids answer `404 {"error":"Nenhum stream disponível para este título"}`
  for every Referer tried, and some direct CDNs answer `404`/`503` alone. Those
  titles cannot be served; the flow fails with a clear message and refunds
  nothing because nothing was charged yet.

- **most films exceed the send ceiling, so compression is required.** Measured on
  30 titles: median ~1.6 GB, max ~2.3 GB, with some small films (<100 MB) that fit
  as-is. The flow downloads the whole file, then
  `comprimirVideo(filePath, { height })` (`src/services/mediaPrepare.js`) reencodes
  H.264/AAC with `-movflags +faststart`. Measured end to end: an 88.5 MB film
  downloaded in 11 s and compressed 480p in 29 s to 21.6 MB (**−75.6%**). A
  720p→480p reencode runs at ~17x realtime on this host with `veryfast`. The
  quality step offers `FILME_COMPRESS_HEIGHTS` (720p, 480p) — never "original",
  because an option that always fails at the end of a multi-minute download is a
  trap.
- **compression failure degrades, it does not abort.** `comprimirVideo` returns
  `null` (never throws) when ffmpeg is missing or the run times out
  (`FILME_COMPRESS_TIMEOUT_MS`, 45 min); the flow then sends the original if it
  fits, otherwise warns and refunds the credits. A film already downloaded is not
  thrown away over a failed reencode.
- the download ceiling is `FILME_MAX_DOWNLOAD_BYTES` (5 GB), separate from the
  episodes' `MEGACINE_MAX_DOWNLOAD_BYTES` (800 MB): a film needs the whole file on
  disk before compressing, so the ceiling is what bounds the disk, not the send
  limit. The process holds the original AND the compressed copy at once, so the
  host needs ~1.4x the ceiling free.
- the SEND ceiling is `FILME_MAX_SEND_BYTES` (1.5 GB, = `MAX_FILE_SIZE_BYTES`),
  passed to `decideAnimeSend` as `documentLimitMb`. It is deliberately NOT the
  anime ceiling (800 MB): a 2 h film at 720p can exceed 800 MB and would be
  cancelled after the whole download and reencode — the exact trap the quality
  step exists to avoid.
- `FILME_COMPRESS_CRF` (28) and `FILME_COMPRESS_PRESET` (`veryfast`) are the
  measured time/size balance; `ultrafast` is faster but produces a ~78% larger
  file (measured).

### Painel de administração (`.painel`)

`src/commands/owner/painel.js` renders an admin dashboard **inside WhatsApp** —
there is no web page and no second authentication path. The "tabs" are a
nativeFlow list whose rows map to owner commands (`.painel-sistema`,
`.painel-graficos`, ...), so opening a tab is an ordinary command dispatch and
inherits the existing `owner` permission check. Adding a web UI would mean a new
server and a new login to protect; the owner's WhatsApp already *is* the
authenticated channel.

- `src/services/dashboard.js` holds the metrics: RAM/CPU/disk via `node:os` and
  `fs.statfsSync`, uptime, version, database size/integrity, backup state,
  text charts (`sparkline`, `barra`) and the alert thresholds (RAM 80%, CPU 75%,
  disk 85%). A metric the host cannot provide comes back `null` and the panel
  prints `n/d` — never an invented number.
- `src/services/blacklist.js` is the global ban list. Different from `muted`
  (per group), a banned user is ignored everywhere, group or private. A
  temporary ban (`1h`, `1d`, `7d`, `30d`) expires on read, with no sweeper: the
  same choice the subscriptions make, because a cleanup process that may not run
  cannot be trusted to enforce an expiry.
- `src/services/activity.js` records command counters, known users and the audit
  events (commands, bans, backups, denied access). The lists are capped
  (`MAX_EVENTS`, `MAX_USERS`, `MAX_COMMANDS`) because this file goes into the
  backup every 2 hours and cannot grow forever.
- `startSystemSampler()` (in `src/services/dashboard.js`, wired in
  `src/index.js` next to `startBackupScheduler()`) takes a RAM/CPU sample every
  5 minutes and keeps 24h, which is what the charts plot. The first sample is
  immediate so the chart is not empty right after a deploy.
- `CPU` is the one metric that cannot be read instantly: `os.cpus()` returns
  accumulated times, so the percentage is the delta between two reads and the
  first call returns `null`.
- the activity/blacklist JSON files are **gitignored**: they hold real user LIDs,
  and versioning them would publish who uses the bot and who was banned.

### Falas do Kakashi (`.falas`)

`src/services/kakashiAudio.js` é o catálogo (só dados) das falas gravadas do
Kakashi; o comando é `src/commands/member/funny/kakashi.js`.

- o comando chama-se **`falas`** (aliases `fala`), **não** `kakashi`: o
  `.kakashi` já é o alias do chat de IA (`src/commands/member/ia/gemini.js`) e
  o `ia/` ordena depois de `funny/`, pelo que registar aqui o `kakashi` tapava a
  IA em silêncio. O `commandAliases.test.js` agora falha se dois comandos
  reclamarem o mesmo alias
- os MP3 vivem em `assets/audios/` (`kakashi-chidori.mp3`,
  `kakashi-realizando-pedido.mp3`, `kakashi-baixar-video.mp3`,
  `kakashi-baixar-musica.mp3`). Foram enviados com o miolo do nome substituído
  por pontos (`[Kakashi]Acabe......ntes .mp3`) e renomeados pelo conteúdo depois
  de transcritos; o SHA-256 não mudou no rename
- cada fala declara `id`, `arquivo`, `nomes` (os aliases por que responde),
  `descricao` e `transcricao`. A `transcricao` é documentação: serve para o
  comando listar as falas e para quem editar o catálogo saber o que cada uma diz
- `encontrarAudio()` normaliza o nome (minúsculas, sem acentos), por isso
  `música`, `MUSICA` e `musica` resolvem a mesma fala
- sem argumento (ou com um nome desconhecido) o comando mostra a lista com o
  `formatMessage`; com um nome válido envia o áudio como ficheiro normal
  (`sendAudioFromFile`, `asVoice = false`), não como nota de voz
- o comando está na categoria **Diversão** do menu (`src/menu.js`) e no
  `menuRegistry.js` com `aceita: "texto"` e um `validador` que aceita só nomes
  do catálogo; `entrada` nomeia o que se espera na mensagem de erro
- `kakashiAudio.test.js` guarda o essencial: cada fala aponta para um ficheiro
  que existe, ids/ficheiros/nomes não se repetem, a resolução ignora acentos, e
  o comando envia o áudio certo (ou a lista quando não há correspondência)

#### Anúncio automático nos downloads

Duas das falas tocam sozinhas quando um download arranca: `video` no início de
um download de vídeo, `musica` no de uma música.

- `src/services/kakashiVoice.js` é o contexto (`withKakashiVoice`) e o gatilho
  (`announceDownload`). Mesmo padrão do `withCreditsContext` e do
  `withDownloadNotifier`: o dispatcher abre o contexto com o `sendAudioFromFile`
  do chat e o `downloader.js` usa-o quando começa a baixar. Sem isso, o helper
  teria de ser passado por todas as camadas de download
- o gatilho fica no `downloader.js` (o ponto por onde passa todo o download de
  link), não em cada comando: `downloadMedia` (vídeo e áudio) e
  `downloadYouTubeVideo` anunciam. **Uma vez por download, não por comando** —
  um comando que baixe duas mídias anuncia duas vezes
- o anúncio sai **dentro da vaga da fila** (`withDownloadSlot`): dizer "vou
  baixar" e só depois esperar na fila prometeria uma coisa que ainda não começou
- o middleware também abre o contexto, nas flows que baixam fora do
  `dynamicCommand`: os menus de qualidade de vídeo e de formato de áudio
  (`handleVideoFormatReply` / `handleAudioFormatReply`). Sem isso, um download
  escolhido no menu arrancava em silêncio
- **o anúncio nunca pode travar o download**: um envio falhado ou a ausência de
  contexto devolvem `false` e o download segue. Fora de um contexto (testes,
  chamadas internas) o anúncio é simplesmente ignorado
- o anúncio é do tipo de mídia, não do comando: `downloadVideo`/`downloadMedia`
  anunciam vídeo (Instagram, Facebook, TikTok...), `downloadAudio` anuncia
  música. A conversão de uma mídia já recebida (`to-mp3`, `revelar`,
  `transcrever`) **não** anuncia, porque o `downloadVideo` desses vem do
  `loadCommonFunctions`, não do `downloader.js`
- `kakashiVoice.test.js` cobre o contexto, o tipo sem fala, o envio falhado e o
  anúncio real no `downloader.js`; aponta `GENDOWNLOAD_API_URL` para uma porta
  fechada para não fazer rede nem esperar pelo timeout da API pública

### Media Services

`src/services/ffmpeg.js` handles media conversion, including audio normalization and voice-note friendly formats.

`src/services/sticker.js` handles:

- static sticker processing
- animated sticker workflows
- EXIF metadata
- WebP packaging

The pack publisher is `STICKER_PACK_PUBLISHER` (`src/config.js`, default
`⋆｡°✩ Feito por Dev Yanik ✩°｡⋆`), written into the EXIF of every sticker by
`addStickerMetadata`. `sticker`, `brat`, `bratvid` and `removebg` all read it
from `src/config.js`; changing it in one place is enough. `stickerMetadata.test.js`
guards that the caption mentions Dev Yanik.

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

Patched files, all marked with `// Alterado por: Dev Yanik` on the first line:

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

## HOSTING

The bot now runs on **Oracle Cloud** (ARM Ampere instance). `README.md` is the
source of truth for the installation steps; the VPS Debian/Ubuntu guide applies
directly to an Oracle Cloud instance.

Installation tutorials stay in `README.md`.

If the topic is about hosting, VPS setup, startup configuration, schedules, SFTP, panel usage, or backup flow, agents should also load:

- `.agents/skills/pterodactyl-specialist/SKILL.md`

That skill is the specialized source for panel guidance (it still applies to any
Pterodactyl-style panel).

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
- never expose the values of any credential (`GROQ_API_KEY`, `GEMINI_API_KEY`,
  `HF_TOKEN`, `GITHUB_TOKEN`, `SPIDER_API_TOKEN`, `LINKER_API_KEY`): the API key
  commands always answer with the key masked
- never put a secret value in a versioned file: this repository is **public**, and
  GitHub auto-revokes any token it finds in a public repo (that is what killed the
  `GITHUB_TOKEN` in `src/config.js` and made `.backup` answer HTTP 401). Read
  secrets from the environment, or from `database/config.json` via the API key
  commands (`.api-keys`, `.set-github-token`, `.set-spider-api-token`, ...) —
  that file is now gitignored
- the backup carries the `.env` and the customer data in `database/`, so it must
  never be sent to a public repository. `src/services/backup.js` refuses it; do
  not remove that guard

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

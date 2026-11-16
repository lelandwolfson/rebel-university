# Rebel University

Find people who want to talk about the same book, article, film, or recording, and meet them over coffee or on video.

**Live at:** <https://rebeluniversity.org> (hosted on Fly.io; see [DEPLOY.md](DEPLOY.md))

This is a small, working version of the peer-matching network Ivan Illich describes in *Deschooling Society* (1971), chapter 1 and the "Peer-Matching" section of chapter 6. You name a work. When someone else names the same work nearby, or is happy to meet on video, either of you can call a meeting. You recognize each other by the book on the table. The meeting commits nobody to more than a cup of coffee.

The work is the only thing that matches people. No topics, levels, courses, profiles, ratings, or feeds. No accounts: you get a private link instead. The terms state that the site is for people 18 and older.

- [FIDELITY.md](FIDELITY.md): every element of Illich's design and how the app implements it
- [DECISIONS.md](DECISIONS.md): choices made while building, and why
- [THREAT-MODEL.md](THREAT-MODEL.md) and [SECURITY-REVIEW.md](SECURITY-REVIEW.md)
- [PLAN.md](PLAN.md): stack, data model, pages

## Run it

Needs Node.js 24 or newer (26 recommended). No build step.

```sh
npm ci
npm start            # http://localhost:3000
npm test
```

Data goes to `./var/` by default. With no settings at all the app runs in development mode with a fixed dev secret, no admin page, and no email.

## Configuration

All configuration is environment variables. See [.env.example](.env.example).

| Variable | Required | Purpose |
|---|---|---|
| `APP_SECRET` | in production | 32+ random characters. Derives keys for email encryption, signed form values, and proof-of-work. Changing it makes stored emails unreadable. |
| `ADMIN_SECRET` | no | 32+ characters. Enables `/admin`. |
| `BASE_URL` | no | Defaults to `https://rebeluniversity.org` in production. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | no | Turn on email notices. Without `SMTP_HOST`, email is off and the app works fully. |
| `SECURITY_CONTACT` | no | Email or URL for `/.well-known/security.txt`. |
| `ANTHROPIC_API_KEY` | no | Turns on daily AI-assisted review of reports and held works (`claude-haiku-5-5`, no tools). Without it, the job is skipped. Pause it from the admin Moderation page. |
| `AI_MODEL` | no | Override the moderation model (default `claude-haiku-5-5`). |
| `DIGEST_TOKEN` | no | 32+ characters. Enables the read-only `GET /admin/digest.json` (bearer token). |
| `DATA_DIR` | no | Where the SQLite database and backups live. |
| `TRUST_PROXY` | behind a proxy | `true` to read the client IP from `Fly-Client-IP` / `X-Forwarded-For` and redirect plain HTTP. |

## How it is built

- Node standard library only: `node:http`, `node:sqlite`, `node:crypto`, `node:test`. One optional dependency (`nodemailer`), loaded only when SMTP is set.
- Server-rendered HTML through a tagged template that escapes everything by default (`src/html.js`).
- One small client script (`public/pow.js`) for the anti-spam proof-of-work and a time zone guess.
- SQLite with hourly cleanup and daily backups run inside the process (`src/jobs.js`).
- City data: GeoNames cities over 15,000 people, bundled in `data/places.tsv.gz` (CC BY 4.0, <https://www.geonames.org>). Rebuild with `node scripts/build-places.js <dir>` after downloading `cities15000.zip`, `admin1CodesASCII.txt`, and `countryInfo.txt`.
- Books: Open Library search API, queried by the server so visitors' browsers never contact a third party.

```
src/
  server.js        entry point
  app.js           request handling, form checks
  routes/          pages, requests, meetings, listings, admin
  store.js         all SQL
  matching.js      the matching rules (pure functions)
  pow.js           proof-of-work (server side)
  ratelimit.js     in-memory counters and PoW difficulty
  security.js      tokens, signing, encryption
  i18n/            all user-facing text
public/            css, pow.js, icon
test/              node:test suites
```

## Translating

All interface text is in `src/i18n/en.js` and the long pages in `src/i18n/en-pages.js`. A translation adds sibling files with the same keys and exports.

## License

GNU Affero General Public License v3.0 or later. See [LICENSE](LICENSE). If you run a modified version for others, you must offer them the source.

Ivan Illich's text is not included. Read it at <https://theanarchistlibrary.org/library/ivan-illich-deschooling-society.pdf>.

# Threat model

Written before the code. Updated after the adversarial review; changes are marked *(review)*. See SECURITY-REVIEW.md.

## What we protect

1. **People's safety.** Nobody should be found, followed, or lured through the site.
2. **People's reading privacy.** Who wants to read what, and where, should be hard to learn, even with the whole database.
3. **The service.** It should stay up and stay useful, not become a spam board.

## What exists to steal

| Data | Where | Why it exists | Protection |
|---|---|---|---|
| Work (title, creator) | DB | The basis of a match | Public by design |
| Rough place (GeoNames city id) | DB | In-person radius matching | Public only as region + country (board) or city (meeting listing) |
| Format (in person / video) | DB | Matching | Public |
| Private link tokens | Only in the person's browser and their optional email | Capability to manage a request / meeting attendance | DB stores SHA-256 hashes only. 256-bit random. |
| Optional email | DB | Tell the person a match exists | AES-256-GCM encrypted with a key from the environment. Deleted when the request closes or expires. |
| Display name per meeting | DB | Recognition inside one meeting | Shown only to joined attendees. Not linked to anything else. Deleted 30 days after the meeting. |
| Venue, video link, organizer note | DB | Running the meeting | Shown only to joined attendees. Deleted 30 days after the meeting. |
| IP address | Memory only | Rate limiting and proof-of-work difficulty | HMAC'd (IPv4 per address, IPv6 per /64) with a key that lives in memory and rotates daily. Never written to disk. Counters expire within 24 hours. |
| Reports | DB | Abuse handling | Admin only. Deleted with the meeting. |
| Admin audit log | DB | Accountability | No IPs. Pruned after 180 days. |
| Timestamps | DB | Expiry | Rounded to the hour to blur timing correlation. Row ids are random so order doesn't leak either *(review)*. |

A full leak gives an attacker: a list of works people want to discuss, rough cities, meeting venues and times for the next month, and some display names. No names, no accounts, no IPs, no emails (unless they also have the key), and nothing linking two requests or two meetings to the same person.

## Attackers

| Who | What they want |
|---|---|
| Spammers and SEO farmers | Public links and free text on a crawled site |
| Stalkers / abusers | Find or follow a specific person, or lure strangers |
| Harassers / trolls | Disrupt meetings, post offensive content |
| Scrapers and data brokers | Build a record of who reads what, where |
| Governments / litigants | Records of readings and meetings (Illich names the FBI) |
| Opportunistic attackers | Generic web exploits: XSS, SQLi, admin takeover, DoS |

## App-specific threats

### T1. Using the site to find or follow someone
- **Joining meetings to learn venues.** Anyone can join any meeting; that is the design (Illich: open to anyone). Mitigation: venue is a public place (guidance), the organizer can remove attendees and close the meeting, meetings are deleted after 30 days, there is no way to see which meetings a person attended. **Accepted risk**, stated in the "How to meet" page.
- **Watching the open board.** Board shows only work + region/country (not city) + format. No dates, counts per city, or names.
- **Linking a display name across meetings.** Display names are free-form per meeting; there is no user id; nothing in the DB links two attendee rows. A person who reuses a distinctive name links themselves; the join form suggests not reusing names.
- **Watching a request's match count** to infer when someone new posts, or posting probes from several cities to triangulate a reader *(review)*. Limited to 3 requests per work per connection per day, plus PoW and posting limits. Residual risk accepted (SECURITY-REVIEW.md).

### T1a. Probing with a chosen travel distance (added before building it)

People now choose how far they will travel: 25, 50, 100, or 200 km. Two in-person requests match only when they are within **both** people's limits.

**What changes for a prober.** A probe posted with limit `r_a` matches a reader with limit `r_v` only within `min(r_a, r_v)`. So:
- Against a reader at 25 or 50 km, a wide probe gains nothing. Its useful reach is still the reader's own limit. This covers the default.
- Against a reader who chose 100 or 200 km, a wide probe covers 4 or 16 times the area of a 50 km probe. Finding that reader's rough region takes 4 to 16 times fewer probes. That is the new cheapening.
- Changing a request's distance on its private page shows a fresh count with the same request. Without a limit, that would be a free probe.
- A 25 km probe draws a smaller circle. That doesn't make a single probe more precise in any way that matters: the stored location is a city, and well-placed 50 km circles can already split neighboring cities. It does make searching more expensive, since each probe covers less.

**Limits chosen, so probing costs at least as much as now:**
1. **Proof-of-work scales with the area a probe covers.** Difficulty is multiplied by `max(1, (r/50)²)`: ×1 for 25 and 50 km, ×4 for 100 km, ×16 for 200 km. The useful reach of any probe is at most its own limit, so the work spent per km² searched is at least today's for every reader. The difficulty is checked at submit time against the distance actually submitted, so a cheap challenge can't be used for a wide request.
2. **A distance change counts as a probe.** It needs its own proof-of-work at the new distance's difficulty. It counts against the same 3-per-work-per-connection-per-day budget. It is also limited to 3 changes per request per day, whatever the connection.
3. **The per-connection budget stays at 3 probes per work per day, at any distance.** On IPv6 it also applies per /48, at 4 times the per-/64 limit, so one free tunnel can't multiply it 65,536 times *(second review)*. The area searchable per connection per day rises only against readers who chose 100 or 200 km, and they chose that exposure. The CPU cost per km², the binding cost for an attacker who rotates addresses, does not fall for any reader.
4. **The distance is never public.** It isn't shown on the board, the meeting pages, or the admin page. It appears only on the request's own private page. Board presence uses a fixed 50 km rule, so watching the board reveals nothing about anyone's chosen distance *(second review)*.

*(Second review)* An honest limit on point 1: proof-of-work is cheap for a determined attacker with native code (about 0.02 core-seconds per 50 km probe). "No cheaper than before" is true, but proof-of-work is a speed bump. The binding limits are the per-/64 and per-/48 budgets, which never get evicted.

Cost to legitimate users: a 200 km request takes about 16 times the base proof-of-work. That is a few seconds on an old phone, and the form says so.
- **Rejoining after removal** *(review)*: the removed person's address is blocked from that meeting for 24 h (memory only).

### T2. Fake organizer luring people / malicious video link
- Guidance everywhere: public places, daytime, leave whenever you want, never a private home.
- Video links: https only, max length, no credentials, rendered as a plain link with a warning that it leaves the site. Never embedded, never auto-opened. Shown only to joined attendees.
- Report link on every meeting; admin can remove meetings.
- The site does not validate venues (by design; core rule 9).

### T3. Guessing or leaking private links
- 256-bit tokens from `crypto.randomBytes`. Guessing is infeasible.
- Only SHA-256 hashes stored. DB leak does not reveal live links.
- `Referrer-Policy: same-origin` so links never leak to the video host or any other site. (`no-referrer` was tried; it makes browsers send `Origin: null` on our own forms.)
- `Cache-Control: no-store` on private pages.
- No logging of request paths.
- Rate limit on token lookups per IP to slow any guessing anyway.

### T3a. Using the site to send email *(second review)*
- Anyone can type anyone's address. Emails contain no typed text and no titles, nothing is sent for held requests, and each address gets at most 3 a day.

### T4. Harvesting notification emails
- Never displayed anywhere, including to the person who entered it (we show "an email is set").
- Encrypted at rest (AES-256-GCM, key from env via HKDF).
- Deleted on close / expiry.
- Email content never includes another person's details.

### T5. Admin takeover
- Admin is disabled unless `ADMIN_SECRET` (≥ 32 chars) is set.
- Constant-time comparison; login rate limited per IP only, after the CSRF check (a global cap let one IP lock the admin out) *(review)*; random session id stored hashed in memory, 2 hour lifetime, `HttpOnly; Secure; SameSite=Strict` cookie; CSRF on every admin action.
- Audit log of every admin action.

### T6. Scraping to build a record
- Public pages carry little: work, city/region, date, format.
- Requests are never public individually; the board aggregates by work + region.
- Rate limits on all pages per IP.
- `robots.txt` disallows meeting and board pages (polite crawlers only).

### T7. Floods and DoS
- Proof-of-work on every write (adaptive per IP and site-wide). Challenges are bound to the client and the current difficulty, signed over salt and challenge, and the key is per process *(review)*.
- Honeypot field and minimum fill time (these only stop naive bots; not counted on) *(review)*.
- Client IP taken only from Fly's edge header; IPv6 limited per /64; limiter memory capped *(review)*. Security counters live in a separate map that is never evicted and fails closed; IPv6 is also limited per /48 *(second review)*.
- `/board` uses a spatial grid, refreshes at most hourly, and works are capped at 2,000 open requests *(second review)*.
- Per-IP rate limits; per-link rate limits.
- Duplicate detection (same IP + work + place within an hour).
- Body size limit (16 KB), header/request timeouts.
- Admin bulk remove and "hold manual entries" switch.
- Open Library lookups are cached and rate limited; a slow upstream cannot hang requests (timeout).
- Accepted: a large botnet can still exhaust a single small server. The host's edge absorbs volumetric attacks.

### T7a. Poisoning shared works *(second review)*
- The first poster of a hand-entered work sets its title and link for everyone. Works with links are held for admin review. Open Library text, which anyone can edit there, is cleaned like user input. Signed work references expire after a day.

### T8. Full database leak or legal demand
- See "What exists to steal". Data is minimal, hashed, encrypted, and short-lived. Backups are kept 7 days, inside snapshots kept 5 days. Deleted rows are also flushed from SQLite's write-ahead log right away *(second review)*.
- Seizing a *running* server also gets its memory, including the daily key that scrambles addresses, so recent posters' addresses could be recovered by brute force. Memory counters are scoped per work and meeting so they don't link a person's actions. Stated on the privacy page *(second review)*.
- Privacy page states exactly what exists so a demand can be answered honestly.

## General web risks (OWASP Top 10, 2021)

| Risk | Defense |
|---|---|
| A01 Broken access control | Capability tokens checked on every private route; organizer actions check the organizer flag on the attendee row; admin routes check session. Tests cover cross-meeting access. |
| A02 Cryptographic failures | HTTPS only (HSTS), AES-256-GCM for email, SHA-256 for token hashes, HMAC for signed values, keys from env. |
| A03 Injection | Parameterized SQL only. All HTML output escaped by a tagged template that escapes by default. URLs validated before use in `href`. Email headers built from fixed text only. |
| A04 Insecure design | This document; minimal data; capability links. |
| A05 Security misconfiguration | Strict CSP (`default-src 'none'`), security headers on every response, generic error pages, no directory listing, non-root container. |
| A06 Vulnerable components | One runtime dependency (nodemailer, only loaded when SMTP is set). Pinned versions, lockfile, `npm audit` in CI. |
| A07 Identification failures | No accounts. Admin as in T5. |
| A08 Integrity failures | Signed (HMAC) hidden form values for work selection and PoW challenges; pinned CI actions. |
| A09 Logging failures | Admin audit log. Errors logged without request bodies, paths, or IPs. |
| A10 SSRF | Server only fetches fixed Open Library URLs with validated keys. User links are never fetched. |

Also: CSRF (double-submit cookie + Origin check), clickjacking (`frame-ancestors 'none'`), open redirects (no user-controlled redirects).

## AI-assisted moderation (added with the feature)

Once a day the app sends the report queue and the held-works queue to an Anthropic model (`claude-haiku-5-5`) and applies its validated decisions. Design in `src/moderation.js`; decision record in DECISIONS.md D-44 to D-48.

### T9. Prompt injection through reports and work titles
Anyone can write a report or enter a work, so every field the model sees is attacker-controlled: report text, titles, creators, links, organizer notes. An attacker would try to make the model approve spam, remove legitimate items, or reveal something.
- **The model has no tools, no web access, and no code execution.** It can only return JSON, and the JSON can only name actions on items from this run.
- **A fixed system prompt** says all item content is untrusted data, never an instruction. The items travel as JSON inside `<untrusted_items>`, with `<` and `>` escaped, so no text can close the block early.
- **The model never sees database ids.** Items get opaque per-run ids (`w1`, `r1`), and decisions naming anything else are discarded.
- **Code enforces the rules regardless of what the model says.** It checks the schema again (exact keys, a known id, an action allowed for that item type, a reason of 200 characters or less) and discards conflicting duplicates. Reports can only be flagged or remove their meeting; reports can't be "approved".
- **Every bad outcome is reversible and visible.** Removals go to a 7-day trash with a restore button and are audit-logged with the reason. More than 20 removals in a run, an invalid response, a refusal, or a truncated response means **no action at all**, and the whole run is flagged for the owner.
- **Reports never remove anything** *(review)*. Reports are grouped per meeting into one item, and the only allowed action is flag_for_owner, with a short summary. A work with a link can't be approved, only removed or flagged, so links stay human-reviewed *(review)*.
- Items get random per-run ids, so one item's text can't easily name others. Half of each batch is reserved for reports, so a flood of held works can't starve them *(review)*.
- Residual risk: a well-crafted injection could still persuade the model to misjudge a single item within those rules, for example removing a legitimate reported meeting as "spam". It is bounded by the cap, logged, restorable, and shown to the owner.

### T10. Getting legitimate items removed by reporting them
*(Revised after review.)* The first version let any report lead to its meeting's removal, so one anonymous report could get a real meeting deleted. Now reports can only be flagged to the owner. Each address can file 3 reports per meeting a day, so junk from one source can't crowd out real reports. Past 500 reports on one meeting, safety reports are still stored. The trash keeps the work row, so a removal can always be restored, even after cleanup removes the work.

### T11. Data sent to a third party
Only the fields listed on the privacy page are sent: no emails, private-link tokens, IP data, display names, venues, video links, organizer notes, or database ids. Phone-like numbers are scrubbed from report text (tested). The privacy page states this.

### T12. The digest endpoint (`GET /admin/digest.json`)
A new read-only surface for an outside reader, such as a scheduled cloud task.
- **Off unless `DIGEST_TOKEN`** (32 or more characters) is set. It is a bearer token compared in constant time, with no cookies involved, so CSRF doesn't apply. Rate limited per address. Unauthenticated requests get a 404, so the endpoint doesn't reveal it exists.
- **Returns only:** site status, uptime, last backup time, whether AI moderation is on, and the latest run's counts, actions, and flagged items (type, reason, and a title only when it is already public: approved works and meeting works) *(review)*.
- Failed attempts count toward a lockout per address and /48. Successful reads have their own limit, so a guesser can't lock the real reader out *(review)*.
- **Never returns:** emails, tokens, IP data, display names, venues, links, report text, meeting ids, or trash ids.
- **It changes nothing.** The token works on no other route: it isn't an admin session and can't call admin actions.
- Residual risk: the model's short reasons appear in the digest, and a reason could paraphrase a report. Phone-like numbers are scrubbed, and the prompt forbids names, but nothing in code can remove a paraphrase.

### T13. Cost and availability
At most one model call a day (40 items, 4,000 output tokens), plus admin "run now". If the key is missing or the API fails, nothing changes and the site works as before. A spending cap on the API key limits the worst case (OWNER-TODO.md).

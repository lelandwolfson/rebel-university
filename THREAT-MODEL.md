# Threat model

Written before the code. Updated after the adversarial review (see SECURITY-REVIEW.md).

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
| IP address | Memory only | Rate limiting and proof-of-work difficulty | HMAC'd with a key that lives in memory and rotates daily. Never written to disk. Counters expire within an hour. |
| Reports | DB | Abuse handling | Admin only. Deleted with the meeting. |
| Admin audit log | DB | Accountability | No IPs. Pruned after 180 days. |
| Timestamps | DB | Expiry | Rounded to the hour to blur timing correlation. |

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
- **Watching a request's match count** to infer when someone new posts. Count only, on a private page that requires your own request. Low value.

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

### T4. Harvesting notification emails
- Never displayed anywhere, including to the person who entered it (we show "an email is set").
- Encrypted at rest (AES-256-GCM, key from env via HKDF).
- Deleted on close / expiry.
- Email content never includes another person's details.

### T5. Admin takeover
- Admin is disabled unless `ADMIN_SECRET` (≥ 32 chars) is set.
- Constant-time comparison; login rate limited per IP and globally; random session id stored hashed in memory, 2 hour lifetime, `HttpOnly; Secure; SameSite=Strict` cookie; CSRF on every admin action.
- Audit log of every admin action.

### T6. Scraping to build a record
- Public pages carry little: work, city/region, date, format.
- Requests are never public individually; the board aggregates by work + region.
- Rate limits on all pages per IP.
- `robots.txt` disallows meeting and board pages (polite crawlers only).

### T7. Floods and DoS
- Proof-of-work on every write (adaptive per IP and site-wide).
- Honeypot field and minimum fill time.
- Per-IP rate limits; per-link rate limits.
- Duplicate detection (same IP + work + place within an hour).
- Body size limit (16 KB), header/request timeouts.
- Admin bulk remove and "hold manual entries" switch.
- Open Library lookups are cached and rate limited; a slow upstream cannot hang requests (timeout).
- Accepted: a large botnet can still exhaust a single small server. The host's edge absorbs volumetric attacks.

### T8. Full database leak or legal demand
- See "What exists to steal". Data is minimal, hashed, encrypted, and short-lived. Backups are kept 7 days.
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

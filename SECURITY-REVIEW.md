# Security review

**Date:** 2026-11-16, before launch.

**Method:** After the app worked, a separate reviewer (a fresh agent that had not seen the build) got THREAT-MODEL.md and the code. It was told to break each defense and to look for anything the model missed. It attacked a locally running server with scripts. It did not edit the code. Every finding below was then fixed, and each fix has a regression test, or the risk was accepted with a reason.

Test names refer to `test/units.test.js` and `test/flow.test.js`. Search for "review finding N".

## Findings and fixes

| # | Severity | Finding | Fix | Test |
|---|---|---|---|---|
| 1 | Medium–high | **Admin lockout.** One IP sent 31 bad logins with no CSRF token and filled a site-wide login counter. That locked the real admin out. | The login form check runs first. Only a per-IP limit applies, with no site-wide cap. The 32+ character secret makes guessing futile. | `review finding 1` |
| 2 | Medium | **Proof-of-work (PoW) stockpiling.** Challenges fetched at base difficulty stayed valid for 2 hours from any IP, so the adaptive difficulty did nothing. | The challenge salt now carries the IP key and the difficulty. Verify rejects a different IP, or a difficulty below a quarter of the IP's current level. TTL is 1 hour. | `review finding 2` |
| 3 | Medium | **PoW forgery and replay.** Moving digits from the number into the salt kept the hash valid and pushed the expiry to the year 58846. The used-challenge list lived in memory, so solutions replayed after a restart. | The signature covers salt and challenge together. The PoW key is random for each process, so a restart invalidates old solutions. | `review finding 3`, and the `otherKey` case |
| 4 | Medium | **IP spoofing and IPv6 rotation.** Client-sent `Fly-Client-IP` and `X-Forwarded-For` were trusted. The Dockerfile turned trust on by default. Each IPv6 address got its own quota. Limiter memory was unbounded. | Only `Fly-Client-IP` is read, and only when `TRUST_PROXY=true` (set in `fly.toml`, where Fly's edge sets the header). `X-Forwarded-For` is ignored. The Dockerfile no longer trusts by default. IPv6 is limited per /64. The limiter holds at most 200,000 keys. | `review finding 4` (three tests) |
| 5 | Medium | **Link injection.** A request that normalized to an existing hand-entered work could attach a link (for example a phishing page) that every attendee then saw. It skipped review. | An existing work is never modified by a later request. | `review finding 5` |
| 6 | Medium | **Location triangulation.** Probe requests from several cities, each read for its match count, can narrow down where a reader is. | Limited to 3 requests per work per connection per day, on top of the posting limits and PoW. Partly accepted; see below. | `review finding 6` |
| 7 | Medium | **Board CPU DoS.** Each `/board` view compared every pair of requests: about 2 s at 10,000 requests. | The board is cached and recomputed only after requests change, at most every 15 s. Video requests no longer need pairwise work. | `review finding 7` (also checks the faster method gives identical results) |
| 8 | Medium | **Meeting harassment.** A removed attendee could rejoin at once and see the venue again. One IP could fill a meeting. | Removing someone blocks their address for that meeting for 24 h. The address is held in memory only. At most 3 joins per meeting per address per day. | `review finding 8` |
| 9 | Low | **Linkability.** Sequential row ids revealed posting order and site-wide counts. The privacy page said "nothing links a request to a meeting", which overstated it. | All ids are random. The privacy page now states exactly what could be inferred. | `review finding 8` checks random attendee ids |
| 10 | Low | **Retention.** Backups sit on a volume that Fly also snapshots, so deleted data can survive about 14 days, not the 7 promised. | The privacy page now says 14 days. | n/a (documentation) |
| 11 | Low | **Open Library abuse.** There was no global limit, and the whole response was buffered before the size check. | Global cap of 600 searches per 10 min. The response is streamed with a 2 MB cap. | `review finding 11` |
| 12 | Low | **URL-stripping bypasses.** `evil。com`, `evil．com`, `пример.рф`, `evil . com`, and `evil[.]com` all got through. | NFKC normalization, Unicode dot folding, internationalized domain patterns, and patterns for obfuscated dots. | `review finding 12` |
| 13 | Low | **Slow-body DoS.** | Timeouts are tighter (8 s headers, 10 s request). Unwanted bodies are no longer read: 413/415 responses close the connection. | not tested |
| 14 | Info | The honeypot and minimum fill time only stop naive bots. | Accepted. The threat model no longer counts them as real defenses. | n/a |

Also found during the browser walk-through, before the review: `Referrer-Policy: no-referrer` made Chrome send `Origin: null` on the site's own forms, so every real browser submission failed. Fixed with `same-origin`. Regression test: the `Origin: null` case in `forms without CSRF token...`.

## What held up

The reviewer tried these and could not break them:

- XSS through every text field and template
- ICS injection
- URL scheme tricks in video and work links
- Email header injection
- SQL injection
- Cross-meeting access with attendee links
- Organizer-only actions taken by attendees
- Forged signed form values
- Static file traversal
- Admin session handling
- Leakage through logs

## Accepted risks

- **Anyone can join a meeting and learn its venue.** This is the design: open to anyone, as Illich proposed. Mitigations: organizers can remove people and close a meeting, the "How to meet" guidance, and deletion after 30 days.
- **Determined probing with many IPs.** An attacker with many addresses (a botnet, or many /64s) can still triangulate a reader's rough area from match counts, or fill a meeting. Every probe costs PoW and a request. In-person matching already implies being within about 50 km, which a meeting would reveal anyway.
- **Volumetric DoS** against a single small machine. Fly's edge absorbs some of it. Beyond that, it is accepted for a free service.
- **The proof-of-work slows bots but cannot stop a well-funded one.** The admin "hold manual entries" switch and bulk remove are the backstop.
- **Removing an attendee who shares an address**, such as library wifi, blocks others on that address from rejoining that one meeting for 24 h.
- **Board freshness:** it can lag by up to 15 s.

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

---

# Second pass: 2026-11-16

**Method:** a new reviewer, a fresh agent, got only THREAT-MODEL.md and the code. It was told not to read this file, DECISIONS.md, or git history, so the first review's findings didn't guide it. It was asked to focus on four areas:
- the defenses added after the first review
- the new travel-distance feature
- proof-of-work, private links, and admin login
- anything that links one person's requests or display names

It attacked a running server and confirmed 10 of 11 findings by running them. Every finding was fixed. Tests are in `test/review2.test.js`, one or more per finding.

## Findings and fixes

| # | Severity | Finding | Fix | Test |
|---|---|---|---|---|
| 1 | High | **The limiter evicts security state.** About 105k cheap page views from one /48 filled the shared counter map. Evicting the oldest 10% then erased every guard: the distance-change cap, the rejoin block, the probe budget, and duplicate checks. Confirmed live: a 4th distance change was blocked, and after a 4-second flood a 5th went through. A removed attendee rejoined. | Security counters now live in their own map. It is never evicted and fails closed (refuses) if it ever fills. Only cheap traffic counters (page views, link lookups, searches) are evictable. | `finding 1` |
| 2 | Medium | **Budgets don't bind on IPv6.** A free tunnel gives a /48, which is 65,536 /64s, each with a fresh budget. | Posting, probing, joining, search, and admin limits also apply per /48, at 4 to 10 times the per-/64 limit. Proof-of-work difficulty also follows /48 activity. | `finding 2` |
| 3 | Medium | **Board DoS.** One work with 10,000 spread-out requests made each board refresh block for 5.8 s, every 15 s. | A spatial grid compares only nearby requests (10,000 requests now take well under 1.5 s, tested). The board refreshes at most hourly. Each work is capped at 2,000 open requests. | `finding 3` (speed, and identical results to checking every pair) |
| 4 | Medium | **Distance leak through the public board.** A request left the board only when matched within both people's distances, so watching the board revealed lower bounds on chosen distances. The 15 s refresh also timed posts to about 15 s. | The board uses a fixed rule independent of chosen distances: nobody within 50 km, and no video match. It refreshes at most hourly. | `finding 4` (every distance combination gives the same board, also over HTTP) |
| 5 | Medium | **Proof-of-work is weak in absolute terms.** A probe costs about 0.02 core-seconds natively. Meanwhile, stacked multipliers (per-IP ×64, site-wide ×16, distance ×16) could demand 320M hashes from an honest user. | Required work is capped at 20M. The threat model now treats proof-of-work as a speed bump; the binding limits are the never-evicted /64 and /48 budgets. | `finding 5` |
| 6 | Medium | **First poster sets shared content.** An attacker could pre-register popular films with a phishing link that every later meeting showed. Open Library titles, which anyone can edit there, kept URLs. Signed work references never expired. | Hand-entered works with a link are always held for admin review. Open Library text is cleaned like user input. Work references expire after 24 hours. | `finding 6`; flow test `hand-entered works...` |
| 7 | Low–medium | **The site emails arbitrary addresses**, even with hold on, and the emails carried the attacker's text (for example "CHEAP MEDS CALL 555..."). | No email for held requests. Emails contain no title or typed text. At most 3 emails per address per day. | `finding 7` |
| 8 | Low–medium | **Search shutdown.** Cache hits counted toward the global Open Library cap, so 16 /64s could turn search off for everyone. | Only real upstream fetches count. Cached answers are always served. A per-/48 tier was added. | `finding 8` |
| 9 | Low | **Rejoin block lapses early.** It was keyed by the daily-rotating address key, so it lasted until the next rotation (about 12 h on average), and a block written across the rotation never applied. | The previous day's key is kept and checked too. | `finding 9` (removal, then past the rotation, then rejoin is refused) |
| 10 | Low | **Memory links a person's actions.** Counter keys like `work-per-ip:<ipKey>|<work>` tied one address's works and meetings together in memory. The scrambling key in the same memory would let someone recover the address. | Per-work and per-meeting counters are keyed by an HMAC of (address key, scope), with no shared prefix. Rejoin data stores only those per-meeting keys. The privacy page now states what a seized running server would hold. | `finding 10` |
| 11 | Low | **Deleted rows stayed in the WAL file**: a closed request's token hash and encrypted email remained in `rebel.db-wal`. | `wal_checkpoint(TRUNCATE)` runs after every user deletion and every hourly cleanup. | `finding 11` (no file in the data folder contains the deleted row) |
| info | Info | `/admin?done=` echoed arbitrary text. Failed logins wrote one audit row each, so they could flood the log. | Only known action names are shown. Failed logins are audited at most once per 15 minutes. | n/a |

## Compared with the first review

- **Bypassed first-review fixes:**
  - *Finding 4 (IPv6 /64 limits, limiter cap)* was bypassed twice: by flooding the limiter until it evicted guards (#1), and by using a whole /48 (#2).
  - *Finding 8 (rejoin block)* was bypassed by the same eviction, and it lapsed at key rotation (#9).
  - *Finding 6 (probe budget)* was multiplied by /48 rotation (#2).
  - *Finding 7 (board DoS)*: the 15 s cache only slowed it; it was still exploitable at scale (#3).
  - *Finding 5 (link immutability)* held as written, but its sibling did not: the *first* poster's link (#6).
  - *Finding 11 (Open Library global cap)*: the fix itself created a way to shut search off (#8).

  All of these are now fixed with tests.
- **First-review fixes that held:**
  - admin lockout (1)
  - proof-of-work binding, forgery, and replay (2, 3)
  - random ids (9)
  - URL stripping (12)
  - XSS, CSRF, ICS, and SQL protections
- **New with the distance feature:** the board leak (#4). The extra proof-of-work for wider distances and the distance-change limits held against direct attack. They fell only to the limiter eviction (#1), now fixed.
- **Lesson:** both reviews found that per-address limits are only as strong as the address bucketing and the memory they live in. Guards now sit in their own map, which fails closed.

## Accepted risks, second pass

Added to the earlier list:

- **Fail-closed guard map.** Filling the guard map (300,000 entries) needs that many actions that passed proof-of-work, spread across many /48s. If it ever happens, new posts are refused until entries expire (at most a day). We prefer that to silently lifting the protections.
- **Proof-of-work is a speed bump.** An attacker with native code and many /48s or IPv4 addresses can still probe. Each probe needs a request, and in-person matching already reveals roughly where someone is within the distance they chose.
- **Board accuracy.** The fixed 50 km rule can list a reader who already has a wider-distance match. The board still truthfully says nobody is nearby, and it lags by up to an hour.
- **A seized running server.** Its memory holds the daily address-scrambling key, so recent addresses could be recovered by brute force. This is stated on the privacy page.

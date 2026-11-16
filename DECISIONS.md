# Decisions

Choices made while building, with the reason. Departures from Illich are marked **(departure)**.

**D-01. Stack: Node 26 standard library, SQLite, server-rendered HTML.** Node now ships an HTTP server, SQLite driver, crypto, and test runner, so the app needs no framework and has one optional dependency. That is the cheapest thing to host and the easiest for one person to keep patched.

**D-02. We do not repeat Illich's shrug about the FBI (departure).** He thought a record of readings and meetings was harmless. Core rule 5 says otherwise, so data is minimal, hashed, encrypted, and deleted on schedule.

**D-03. One request per private link.** The prompt mentions "a cap on open requests per private link". Holding several requests under one link would build a reading list tied to one person, which conflicts with core rule 5. Each request gets its own link, so the cap is one by construction. A person can post as many requests as they like, each separately (subject to IP rate limits).

**D-04. In-person travel distance is the person's choice: 25, 50, 100, or 200 km (miles shown alongside), default 50.** *(Revised; v1 used a fixed 50 km, too tight for rural areas.)* Two requests match in person only within both people's limits. A meeting fits a request when it is within that reader's limit. The distance is shown only on the request's private page, where it can be changed. Four fixed steps keep the form short and make probing costs predictable (THREAT-MODEL.md T1a).

**D-05. "Online only" requires video.** If a person gives no place, the only meeting they can have is on video.

**D-06. The open board shows region and country, not city.** The prompt says "rough area". A small town name next to an unusual title can identify someone, so the board uses the first-level region (state/province) and country. The meeting listing shows the city, as the prompt requires, because the organizer chose to publish a meeting there.

**D-07. Anyone with an open request can start a meeting, even before a match.** Illich: anyone has the right to call a meeting. A meeting with no matches yet still shows on the public listing, like a notice on a bulletin board.

**D-08. Anyone can join a listed meeting without posting a request first.** Core rule 4 (no account to join) and Illich's openness. Joining needs only a display name and the proof-of-work.

**D-09. Later match emails cannot contain the private link.** Only a hash of the link is stored. The first email (sent when the request is posted) contains the link; later match emails say "open the link we sent you earlier". Storing the link encrypted would weaken the "hashes only" rule.

**D-10. At most one match email per request per 24 hours.** Functional notice only, not engagement. Sent when a new compatible request or a compatible meeting appears.

**D-11. Duplicate detection is per IP, in memory.** Rejecting "same work and same place" for everyone would block exactly the people we want to match: two neighbors reading the same book. So duplicates are judged on (hashed IP, work, place) within an hour, held only in memory.

**D-12. Timestamps rounded to the hour.** Less precise timing makes correlation harder in a leak. Expiry does not need minutes.

**D-13. Admin "hold manual entries" switch.** As specified. Held manual works are invisible and do not match until the admin approves them. Books from Open Library keep flowing.

**D-14. Attendee cap of 100 per meeting.** Bounds abuse of a single meeting (sign-up floods). Organizers can close earlier. Illich sets no cap; this is tooling, not a rule about learning.

**D-15. Display names are shown to joined attendees.** Rule 6: visible only to potential peers. Joined attendees are exactly those peers. They are not shown publicly.

**D-16. Public meeting pages don't show an attendee count.** It is not needed to decide to join and tells a watcher when people sign up.

**D-17. Open Library is queried by our server, not the browser.** The person's IP never reaches a third party, and CSP can stay `connect-src 'self'`. Results are cached briefly in memory.

**D-18. Proof-of-work is built in, ALTCHA-style.** A ~2 KB script brute-forces a SHA-256 preimage from a server-signed challenge. Same scheme as ALTCHA, no dependency. Forms need JavaScript to submit; a `<noscript>` note explains why.

**D-19. Removal sticks for 24 hours, from memory only.** The adversarial review showed removed attendees rejoined at once. We keep each new attendee's hashed IP key in memory for 24 hours, so a removal blocks that address from rejoining that meeting. Nothing is written to disk. A person on a shared address (library wifi) can be caught by it; the organizer can close the meeting instead if needed.

**D-20. Reports carry no reporter identity.** A report holds a reason and up to 500 characters of text, with URLs stripped.

**D-21. Hosting: Fly.io.** One small machine (512 MB; the app idles near 140 MB) and a 1 GB volume is around $3–4/month, with daily volume snapshots on top of our own backups, managed TLS, and no server to patch.

**D-22. Video: organizer pastes a link (no automatic rooms).** As decided by the owner. Note on no-account options for the future:
- The public meet.jit.si service has required moderators to sign in (Google, GitHub, or Facebook) since 2023, so it is not "no account" for the organizer. Guests can still join without an account once a moderator is in.
- Self-hosting Jitsi Meet allows anonymous rooms. A small VPS that can carry a few concurrent calls costs roughly $5–20/month plus bandwidth, which would multiply this project's hosting cost and add a real ops burden (TURN, updates). Not recommended for v1.
- Other no-account options exist (e.g. Jitsi via 8x8 "JaaS" free tier needs an account for the operator, not users; some community-run Jitsi instances allow anonymous rooms but their terms change). Re-check before deciding.

**D-23. Errors are logged without paths, bodies, or IPs.** Paths contain private tokens.

**D-24. Request expiry is a delete, not a status.** Nothing is kept once a request is closed or expired.

**D-25. Report reasons.** "Unsafe or suspicious meeting", "Spam", "Someone may be under 18", "Other".

**D-26. Proof-of-work key is random per process.** A restart (each deploy) invalidates open forms' challenges; the form simply asks again. In exchange, no solution can be replayed after a restart.

**D-27. Random row ids.** Sequential ids would reveal posting order and totals, undoing the hour-rounding of timestamps.

**D-28. www redirects to the bare domain** in production.

**D-29. Wider distances cost more proof-of-work, and a distance change counts as a new probe.** A 200 km request needs 16 times the base work, and 100 km needs 4 times (proportional to area). Changing the distance needs proof-of-work for the new distance. It counts against the 3-per-work-per-connection daily budget and is capped at 3 changes per request per day. This keeps probing at least as costly as with a fixed 50 km (THREAT-MODEL.md T1a). The cost to a rural reader is a few extra seconds, once.

**D-30. Video-only and online-only requests store the default distance.** The distance only matters in person, so a sent value is ignored and costs no extra work.

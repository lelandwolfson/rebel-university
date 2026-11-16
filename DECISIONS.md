# Decisions

Choices made while building, with the reason. Departures from Illich are marked **(departure)**.

**D-01. Stack: Node 26 standard library, SQLite, server-rendered HTML.** Node now ships an HTTP server, SQLite driver, crypto, and test runner, so the app needs no framework and has one optional dependency. That is the cheapest thing to host and the easiest for one person to keep patched.

**D-02. We do not repeat Illich's shrug about the FBI (departure).** He thought a record of readings and meetings was harmless. Core rule 5 says otherwise, so data is minimal, hashed, encrypted, and deleted on schedule.

**D-03. One request per private link.** The prompt mentions "a cap on open requests per private link". Holding several requests under one link would build a reading list tied to one person, which conflicts with core rule 5. Each request gets its own link, so the cap is one by construction. A person can post as many requests as they like, each separately (subject to IP rate limits).

**D-04. In-person radius is a fixed 50 km.** A fixed radius keeps the form short and matches "nearby". It roughly covers a metro area. Could become a choice later.

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

**D-19. Removed attendees can rejoin under a new name.** Blocking them would require tracking a person across visits. The organizer can close the meeting to new people instead. Accepted risk.

**D-20. Reports carry no reporter identity.** A report holds a reason and up to 500 characters of text, with URLs stripped.

**D-21. Hosting: Fly.io.** One small machine and a 1 GB volume is around $2–3/month, with daily volume snapshots on top of our own backups, managed TLS, and no server to patch.

**D-22. Video: organizer pastes a link (no automatic rooms).** As decided by the owner. Note on no-account options for the future:
- The public meet.jit.si service has required moderators to sign in (Google, GitHub, or Facebook) since 2023, so it is not "no account" for the organizer. Guests can still join without an account once a moderator is in.
- Self-hosting Jitsi Meet allows anonymous rooms. A small VPS that can carry a few concurrent calls costs roughly $5–20/month plus bandwidth, which would multiply this project's hosting cost and add a real ops burden (TURN, updates). Not recommended for v1.
- Other no-account options exist (e.g. Jitsi via 8x8 "JaaS" free tier needs an account for the operator, not users; some community-run Jitsi instances allow anonymous rooms but their terms change). Re-check before deciding.

**D-23. Errors are logged without paths, bodies, or IPs.** Paths contain private tokens.

**D-24. Request expiry is a delete, not a status.** Nothing is kept once a request is closed or expired.

**D-25. Report reasons.** "Unsafe or suspicious meeting", "Spam", "Someone may be under 18", "Other".

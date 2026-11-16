# Plan

## Stack

- **Node.js 26 LTS**, standard library only: `node:http` for the server, `node:sqlite` for the database, `node:crypto`, `node:test` for tests.
- **One optional dependency**: `nodemailer`, loaded only when SMTP is configured.
- **SQLite** file on a mounted volume. WAL mode.
- **Server-rendered HTML** from tagged template literals that escape by default.
- **Client JS**: one small file for proof-of-work and one line to preselect your time zone. Everything else works without JS.
- **One Docker container**, deployed to Fly.io (about $2–3/month).

Why: the smallest thing one person can maintain. No framework to upgrade, almost no supply chain. See DECISIONS.md D-01.

## Data model

```
works       id, kind (book|article|film|recording), ol_key (books), title, creator,
            link (manual only, never public), norm_key (unique), held (0/1), created_hour
requests    id, token_hash, work_id, place_id (GeoNames id or NULL), online_only,
            format (in_person|video|either), email_enc (nullable),
            status (open|held|closed), last_notified_hour, created_hour, expires_hour
meetings    id (random public id), work_id, place_id, format (in_person|video|both),
            starts_utc, tz, venue, video_url, note, status (open|closed|cancelled),
            created_hour, delete_after_hour
attendees   id, meeting_id, token_hash, display_name, is_organizer
reports     id, meeting_id, reason, text, created_hour
settings    key, value          (hold_manual)
audit_log   id, at_hour, action, target
```

Nothing links a request to a meeting or an attendee. Timestamps are rounded to the hour.

## Pages

Public
- `/` home: what this is, adults only, start a request
- `/request/new` search a work, pick a place and format, post
- `/board` open board: works waiting for a match
- `/meetings` upcoming meetings: work, city, date, format
- `/m/:id` public meeting page, join form, report link
- `/m/:id/report` report form
- `/how-to-meet`, `/why`, `/privacy`, `/terms`
- `/.well-known/security.txt`, `/robots.txt`

Private (capability links)
- `/r/:token` manage a request: matches, joinable meetings, start a meeting, close
- `/r/:token/meet` start a meeting
- `/a/:token` attendee page: venue, link, attendees, .ics, leave; organizer tools if organizer
- `/a/:token/ics`

Admin
- `/admin` login, reports, requests, meetings, held works, hold switch, bulk remove, audit log

## Matching

Two open requests for the same work match when:
- both accept video, or
- both accept in person, both name a city, and the cities are within 50 km.

## Jobs (hourly, in process)

Expire requests (delete), delete meetings 30 days after their date, delete orphan works, prune audit log, daily `VACUUM INTO` backup keeping 7.

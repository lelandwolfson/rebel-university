# Claude Code Prompt: Rebel University (rebeluniversity.org)

You are building a small open source web app called Rebel University. It will live in a new public GitHub repo and deploy to rebeluniversity.org.

## What it is

A matching tool that helps people find others who want to meet and discuss one specific work: a book, article, film, or recording. It is based on the peer-matching network Ivan Illich describes in Deschooling Society (chapter 1, and the "Peer-Matching" section of chapter 6, "Learning Webs"). Read both passages before you design anything. The full text is here: https://theanarchistlibrary.org/library/ivan-illich-deschooling-society.pdf

Illich's version: a person names a title they want to discuss and gives a way to reach them. The system returns everyone else who named the same title. They meet in a public place, such as a coffee shop, and recognize each other by the book on the table. The meeting commits nobody to more than a cup of coffee.

This app keeps that design and changes two things. Identity is anonymous by default. Meetings can be in person, on video, or both.

## Fidelity to Illich

Follow Illich's description as precisely as possible, adapted to the modern world. This is the first priority of the project.

- His text is the specification. Read both passages closely and list every element he describes: what the person submits, what comes back, who can see whom, how people meet, what the system leaves out, and how he answers each objection.
- For each element, build the closest modern equivalent. His computer and return mail become the web app. His telephone call to arrange a meeting becomes the meeting page. His bulletin boards and classified ads become the open board.
- Add nothing he would count as schooling: no curriculum, no instruction, no certification, no ranking of people or works, no authority deciding what is worth reading.
- When this prompt is silent or unclear, his text decides. When a modern convenience conflicts with his design, his design wins.
- The only intended departures are the ones named in this prompt: anonymity in place of name and address, video alongside in-person meetings, the adults-only policy, and the minimum tooling needed to run a public website. Record any other departure in DECISIONS.md with the reason.
- Write FIDELITY.md: a table with one row per element of his design, showing what he describes, how the app implements it, and any difference. Paraphrase him and cite the chapter. Check the finished app against this table during the Verify step.

## Core rules

These come from Illich and from the owner. Treat them as hard constraints. If a feature conflicts with one, leave the feature out.

1. The only basis for a match is the title of a work. No topics, themes, tags, categories, courses, tracks, or reading lists.
2. Open to anyone. No skill levels, no credentials, no age or background fields, no prerequisites, no "beginner" or "advanced" labels.
3. No profiles. No bios, avatars, follower counts, ratings, reviews of people, badges, or history pages.
4. Anonymous first. No account is required to post a request, start a meeting, or join one. Nobody is asked for a real name. A person picks a display name per meeting.
5. Collect the minimum. Store only what a match needs. Illich notes that a record of who read what and met whom could be requested by the state. Design so there is very little to hand over.
6. People become visible only to potential peers. Nobody can browse a list of users.
7. The tool is self-limiting, like a telephone. No feeds, recommendations, streaks, engagement notifications, or growth features. A person uses it to arrange a meeting and then leaves.
8. The organizer of a meeting is its only moderator. No other roles exist inside a meeting.
9. Free interaction and free exchange. The site connects people and states what it recommends. It does not try to control anyone's behavior.
10. Works anywhere in the world. No country, language, or city restrictions.

## How it works

**Requests.** A person searches for a work and posts a request: the work, a rough location (city or region, or "online only"), and whether they want in person, video, or either. They get back a private link to manage the request. They may add an email address to be notified of matches. Email is optional, used only for that request, and deleted when the request closes. Requests expire after 90 days.

**Identifying the work.** Use the Open Library API for books so two people naming the same book land on the same record, across editions. For articles, films, and recordings, allow a manual entry with title, author or creator, and an optional link. Match on the work itself.

**Matches.** When two or more open requests share a work and are compatible (nearby for in person, anywhere for video), each person sees that a match exists and how many people are waiting. Any of them can start a meeting.

**Meetings.** The person who starts a meeting is the organizer. They set a date, time, and time zone. For in person they name a public venue. For video they paste any meeting link (Zoom, Jitsi, anything). A meeting can have both. The public listing shows the work, the city, the date, and the format. The exact venue and the video link are shown only to people who have joined. The meeting page reminds in-person attendees to bring the work and set it on the table so the others can find them.

**Organizer tools.** Edit details, cancel, remove an attendee, close the meeting to new people. Nothing else.

**Open board.** A public page lists works that have open requests with no match yet, with rough area and no names. This is Illich's bulletin board. A reader who wants in posts their own request.

**After the meeting.** No follow-up prompts. Meeting data is deleted 30 days after the meeting date.

## Safety and abuse

- Adults only. The service is for people 18 and older, and every interaction is voluntary. State this plainly on the home page, in the terms, and on the request and meeting forms. Do not add an age checkbox or any age gate. Do not collect a birth date or any ID. The terms should say that the site cannot verify age and that anyone found to be a minor will be removed. Organizers and the admin can remove anyone they believe is under 18, and the report link includes that as a reason.
- The main safety tool is clear guidance on how to meet. Write a short "How to meet" page and show its key points on the meeting form, the meeting page, and in any notification email. The guidance: meet only in well-trafficked public places, meet during the day, pick a place suited to conversation such as a coffee shop, library, or park, never a private home, come and go on your own, share only what you choose to, and leave whenever you want. A meeting commits nobody to more than a cup of coffee. Write it as encouragement toward good meetings, in a plain and friendly voice.
- The site advocates and does not enforce. It is grounded in free interaction and free exchange between adults, and it makes no attempt to control how people meet. Do not validate venues, restrict meeting times, add warnings that trigger on a person's choices, or build any feature that polices behavior. The venue field is a plain text field with the guidance shown beside it.
- No private messaging between users. The meeting page can have a short organizer note and that is all.
- Spam and bot control, with no account and no required email. Build these layers:
  - Remove the reward. Spammers want public links and free text. Public pages show only the work, city, date, and format. Never render a user-entered link on a public page. Manual work entries show title and creator as plain text, and their optional link is visible only on the meeting page to people who joined. Keep free text fields short and strip URLs from them.
  - Invisible checks on every form: a honeypot field and a minimum time between page load and submit.
  - A self-hosted proof-of-work challenge on posting a request, starting a meeting, and joining one. Use an open source option such as ALTCHA or build a simple equivalent. No third-party captcha services, no puzzles for the person to solve. Make the difficulty adaptive: low by default so an old phone clears it in about a second, rising for an IP that posts repeatedly in a short window, and rising site-wide when total posting volume spikes. Do not track visitors over time to do this. Use only the short-lived rate-limit counters.
  - Rate limits per IP and per private link, and a cap on open requests per private link. Keep IP data hashed and short-lived.
  - Duplicate detection: reject the same work and location posted repeatedly in a short window.
  - Admin controls for a flood: bulk remove, and a switch that holds new manual work entries for review while Open Library entries keep flowing.
- Rate limit posting. Add a simple report link on every meeting that goes to the site admin, and a minimal admin page to remove requests and meetings.
- No analytics, trackers, ad code, or third-party fonts. Do not log IP addresses beyond what rate limiting needs, and keep those short-lived.

## Security

Treat this as a public site that will be attacked. Follow standard practice: threat modeling first, secure defaults while building, and an adversarial review before finishing.

**Threat model.** Before writing code, write THREAT-MODEL.md. List who might attack the site, what they want, how they would try, and what limits the damage. Cover the general web risks in the OWASP Top 10 and the risks specific to this app:

- A person using the site to find or follow someone: joining meetings to learn venues, watching the open board, linking a display name across meetings.
- A fake organizer luring people to a place, or posting a malicious video link.
- Guessing or leaking private links to take over a request or a meeting.
- Harvesting notification emails.
- Taking over the admin page.
- Scraping the site to build a record of who is reading what and where.
- Floods and denial of service.
- A full database leak or a legal demand for records.

**Limit the damage.** Assume each attack succeeds once and design so little is lost. Store only hashes of private links. Encrypt notification emails at rest and delete them on schedule. Keep display names per meeting with nothing linking them. Keep the admin page behind a strong secret from the environment, with rate limiting and an audit log. A stolen database should reveal almost nothing about real people.

**Build defaults.** Parameterized queries, output escaping, CSRF protection, strict Content Security Policy and other security headers, HTTPS only, validated and length-capped input, safe handling of the video link (https only, shown as a link with a plain warning that it leaves the site, never embedded), no secrets in the repo, pinned dependencies with an audit step in CI, and error pages that reveal nothing internal.

**Adversarial review.** After the app works, attack it. Use a fresh subagent that has not seen the build, give it THREAT-MODEL.md and the code, and have it try to break each defense and look for anything the model missed. Fix what it finds, add a test for each fix, and record the results in SECURITY-REVIEW.md, including any risk you chose to accept and why.

Add a SECURITY.md and a /.well-known/security.txt telling people how to report a vulnerability.

## Technical direction

- Choose the stack yourself and record why. Favor something small, cheap to host, and easy for one person to maintain: a single server app with SQLite, server-rendered pages, very little client JavaScript, one Docker container.
- The site is free and will stay free. No ads, no payments, no data collection beyond what a match needs. Target hosting cost of a few dollars a month.
- It must run without an operator. Expiry, data deletion, and database backups run on built-in scheduled jobs. Nothing should need manual upkeep week to week.
- Email is optional at the system level too. The app must work fully with no email provider configured, and turn on notifications when SMTP settings are present in the environment.
- Private links are long random tokens. Store only hashes.
- Store times in UTC with the meeting's time zone. Offer an .ics download on the meeting page.
- For location, use a bundled city dataset such as GeoNames with radius matching. Do not call Google services.
- Mobile first, accessible, fast on a poor connection. Plain design, text forward.
- Structure text for translation from the start, English only for now.
- License AGPL-3.0. Include a README, a short "Why this exists" page that paraphrases Illich with a link to the source, and a privacy page that states exactly what is stored and for how long. Do not copy passages of the book into the repo.

## How to work

Work autonomously from start to finish. The owner is busy with other work and will not be available to answer questions. The goal is a working prototype, live-ready, as fast as you can get there with sound code.

- Do not stop for approval. When you face a choice, make the call that best fits the core rules, and record it in DECISIONS.md with one or two sentences of reasoning.
- Stop only for things you cannot do yourself: accounts, payments, secrets, and DNS. Collect those in OWNER-TODO.md and keep building around them.
- If something in this prompt conflicts with the core rules, follow the core rules and note it in DECISIONS.md.
- Commit in small steps with clear messages. Create the GitHub repo as public if the `gh` CLI is authenticated. If it is not, work locally and add the repo step to OWNER-TODO.md.

Build order:

1. **Read and plan.** Read the two Illich passages. Write FIDELITY.md first, then THREAT-MODEL.md, then a short PLAN.md: stack, data model, page list. Then keep going.
2. **Core loop.** Requests, work lookup, matching, the private link flow. Tests for the matching logic.
3. **Meetings.** Create, join, organizer tools, .ics, open board.
4. **Notifications and cleanup.** Optional email, expiry jobs, data deletion, backups.
5. **Safety and admin.** Rate limits, report flow, admin page, the "How to meet" page, terms, and privacy page.
6. **Verify.** Run the test suite. Start the app and walk through the full flow yourself: post two requests for the same book, start a meeting, join it, remove an attendee, cancel. Fix what breaks. Then go through FIDELITY.md row by row and confirm the app matches it.
7. **Adversarial review.** Run the review described under Security and fix what it finds.
8. **Deploy ready.** Pick one low-cost host and write the deployment config for it. Write DEPLOY.md as a short numbered checklist the owner can follow in under 30 minutes: create the hosting account, set the environment variables, deploy, point rebeluniversity.org at it with the exact DNS records to enter, confirm HTTPS.

Finish with a summary: what works, what you decided, and what is waiting in OWNER-TODO.md.

## Decisions already made

- No "someone has read it" option in v1. Illich allows that some groups might want one and doubts it is needed. Leave it out.
- Adults only, stated as policy with no age gate, as described under Safety and abuse.
- Video in v1: the organizer pastes their own link. Do not build automatic room creation. Add a short note in DECISIONS.md on whether a no-account option exists (check the current sign-in rules on the free Jitsi Meet service and the cost of self-hosting) for the owner to consider later.
- Draft the terms and privacy pages in plain language. Add a line to OWNER-TODO.md that a lawyer should review the adults-only and liability wording.

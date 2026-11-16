# Fidelity to Illich

Ivan Illich, *Deschooling Society* (1971). Source: <https://theanarchistlibrary.org/library/ivan-illich-deschooling-society.pdf>.
Passages used: chapter 1, "Why We Must Disestablish School" (the New York example and the three objections), and chapter 6, "Learning Webs", the section "Peer-Matching".

Everything below is a paraphrase. Nothing is quoted from the book.


| # | What Illich describes (paraphrased) | Source | How the app implements it | Difference |
|---|---|---|---|---|
| 1 | A person identifies the specific book, article, film, or recording they want to discuss. | Ch. 1 | The request form starts by choosing one work: a book from Open Library, or a manual entry for an article, film, or recording. | None. |
| 2 | Matching is by the title of a work only, never by an idea, theme, or issue. Theme-matching needs an authority to define the starting point; title-matching leaves that to the author. | Ch. 1, first objection | The only field that decides a match is the work. There are no topics, tags, categories, or reading lists anywhere in the data model. | None. |
| 3 | No information on age, background, world view, competence, or experience is part of the match. Such restrictions usually come from contempt for "ignorant" readers. | Ch. 1, second objection | The request asks for the work, a rough place, a meeting format, and an optional email. Nothing else. No levels, no credentials, no profile. | Place and format are added so in-person meetings are physically possible. They describe where and how to meet, not who the person is. |
| 4 | Anyone can choose any book. No professor or authority picks what is worth reading. | Ch. 1, first objection ("Great Books") | Any book in Open Library, or any manually entered work. No editor's picks, featured works, rankings, or recommendations. | Admin can remove abusive entries and can hold *manual* entries for review during a spam flood (see DECISIONS.md D-13). This screens spam, not taste. |
| 5 | The person gives a way to be reached: name, address, telephone number. | Ch. 1; ch. 6 | The person gets a private link instead. An email is optional and used only to say a match exists. | Intended departure: anonymity replaces name and address. |
| 6 | The system returns everyone who named the same title. | Ch. 1; ch. 6 | The private request page shows that a match exists and how many compatible people are waiting, plus any meetings for the same work they can join. | People are shown as a count, not as names and addresses, because nobody gives a name. The meeting page takes the place of exchanging addresses. |
| 7 | The return goes to people who "recently" took the same initiative. | Ch. 1 | Requests expire after 90 days. | 90 days is our reading of "recently". |
| 8 | The only way to get a name out of the system is to name a title yourself. People are known only to their potential peers. | Ch. 6 | There is no user list and no search for people. Match counts are visible only on a request's private page. Meeting venues, video links, and attendee display names are visible only to people who joined that meeting. | None. |
| 9 | The person then arranges a meeting by telephone. Initiative stays with the individual. | Ch. 1 | Any matched person can start a meeting, setting date, time, time zone, a public venue and/or a video link. Others join from their request page or the public meeting listing. | The meeting page replaces phone calls. |
| 10 | Any person has the right to call a meeting, and nobody can oblige another to attend. | Ch. 6 | Anyone with an open request can start a meeting. Joining is always voluntary, and people can leave a meeting at any time with one button. | None. |
| 11 | First meeting in a public place such as a coffee shop. Partners recognize each other by the book placed next to their cups. | Ch. 1, third objection | The meeting form and meeting page tell in-person attendees to bring the work and set it on the table. The "How to meet" page suggests coffee shops, libraries, and parks. | Video meetings are added. Intended departure. |
| 12 | A meeting commits nobody to more than a cup of coffee, or to ever meeting again. | Ch. 1 | Stated on the home page, the "How to meet" page, and meeting pages. No follow-up prompts, no "meet again", no connections kept. Meeting data is deleted 30 days after the meeting. | None. |
| 13 | No institutional "assistance" with space, schedules, screening, and protection. Leave initiative to the people meeting; cafés and others can host. | Ch. 1, third objection | The site does not pick venues, approve venues, restrict times, or screen people. The venue is a plain text field with guidance beside it. | None. Guidance is advice, not enforcement. |
| 14 | Risk of a wasted hour or an unpleasant meeting is small compared with the risks of schooling. | Ch. 1 | "How to meet" page: public place, daytime, come and go on your own, leave whenever you want. | None. |
| 15 | A record of readings and meetings could be obtained by the FBI. Illich shrugs this off. | Ch. 1 | We do not shrug. We keep almost nothing: hashed links, no names, no accounts, no IP logs, encrypted optional email deleted on close, everything deleted on schedule. | Deliberate departure, stated in the prompt (core rule 5). Recorded in DECISIONS.md D-02. |
| 16 | Peer-matching needs no currency, credits, or incentives, only a communications network. | Ch. 6 | Free. No points, badges, streaks, credits, or payments. | None. |
| 17 | Simple operation: describe the activity, get back the matches. Early form by return mail, later by terminal. | Ch. 6 | Web pages. Optional email plays the role of return mail. | Modern equivalent. |
| 18 | A complement of bulletin boards and classified ads lists titles for which there is no match yet. No names are given. Readers who are interested enter their own names into the system. | Ch. 6 | The open board lists works with open requests and no match yet, with a rough area (region and country, or "online") and no names. Each entry links to posting your own request for that work. | None. |
| 19 | Peer-matching helps people participate in several peer groups at once and encourages local life in cities. | Ch. 6 | A person can hold any number of requests, each with its own link. In-person matching uses the distance each person will travel (25–200 km, default 50), and both limits must hold. | Requests are not linked to each other, so the system cannot assemble a person's reading list. |
| 20 | Public matching will be abused, like the phone and the mail. Some protection is needed. Illich suggests allowing only pertinent printed information (the title) plus the means to reach the person, or items from a special catalogue. | Ch. 6 | Public pages show only the work, city or region, date, and format. User links never appear on public pages. Free text is short and stripped of URLs. Books come from a catalogue (Open Library). Proof-of-work, rate limits, a report link, and an admin page handle spam. | Spam tooling is the minimum needed to run a public website. Intended departure. |
| 21 | Concern about dangers should not hide the larger benefits. | Ch. 6 | The site advocates good practice and does not police behavior. No warnings triggered by people's choices. | None. |
| 22 | Matching is not limited by age group, class, or sex; meetings should not be conscripted by age. | Ch. 6 | No demographic fields at all. | The terms say, in one plain sentence, that the site is for people 18 and older. Nothing else on the site mentions age, and there is no age gate. Intended departure required by the owner (DECISIONS.md D-38). |
| 23 | The ideal is an institution that increases the chance that people who share a specific interest at a given moment can meet, "no matter what else they had in common". | Ch. 6 | Matching ignores everything except the work, a place, and a format. | None. |
| 24 | Illich mentions some groups might want to match only people who have already read the work. He doubts it is needed. | Ch. 1, second objection | Not built. | None. Prompt confirms. |

## Things the app deliberately leaves out

Per Illich and the core rules: curriculum, instruction, certification, ranking of people or works, featured or recommended works, profiles, reviews, ratings, followers, feeds, streaks, engagement notifications, private messaging, any roles beyond the meeting organizer.

## Verification

Checked on 2026-11-16 against the running app (browser walk-through on localhost plus the HTTP flow test in `test/flow.test.js`).

| # | Result | How it was checked |
|---|---|---|
| 1 | Matches | Searched Open Library for "deschooling society" in the browser, picked the book; entered "The Fire Next Time" by hand as a book. |
| 2 | Matches | Schema has no topic/tag/category fields (`src/store.js`). Two requests match only when `work_id` is equal (`compatible()` in `src/matching.js`, tested). |
| 3 | Matches | Request form fields: work, city or online, format, optional email. Nothing else. |
| 4 | Matches | Board is sorted alphabetically; no featured or ranked lists anywhere. Admin hold applies only to hand-entered works (tested: books keep flowing while hold is on). |
| 5 | Matches (intended departure) | Posting returns a private link; email optional, encrypted (tested: plaintext not in DB). |
| 6 | Matches | Request page shows "1 other person wants to discuss this work" after a second compatible request (tested), plus joinable meetings. |
| 7 | Matches | Requests get `expires_hour` = posted + 90 days; hourly job deletes them (tested). |
| 8 | Matches | No user list route exists. Public meeting page shows no venue, note, or names (tested). Names visible only on `/a/<token>`. |
| 9 | Matches | Started a meeting in the browser from the request page; it appeared on the matching request page and `/meetings` (tested). |
| 10 | Matches | Any open request can start a meeting; attendees have a "Leave this meeting" button (tested). |
| 11 | Matches | "Bring the work and set it on the table" shown on home, meeting form, public meeting page, attendee page, emails, and .ics. |
| 12 | Matches | Coffee line on home, How to meet, and every meeting page. No follow-ups exist in code. Meetings deleted 30 days after the date (tested). |
| 13 | Matches | Venue is a plain text field with guidance beside it; no venue validation or time restrictions beyond "in the future". |
| 14 | Matches | "How to meet" page and the tips box. |
| 15 | Matches (deliberate departure) | See the privacy page and THREAT-MODEL.md; IPs never written to disk. |
| 16 | Matches | No points, credits, payments. |
| 17 | Matches | Confirmation email carries the private link; match notices at most daily (tested with a memory mailer). |
| 18 | Matches | `/board` lists unmatched works with region and country only; matched works disappear from it (tested). Each entry links to posting your own request. |
| 19 | Matches | Separate links per request. Travel distance chosen per request, both limits apply (Portland–Salem match only at 100 km on both sides; edges of every distance tested). Re-checked 2026-11-16 after the distance change. |
| 20 | Matches | Hand-entered links shown only on attendee pages (tested: not on board). URLs stripped from notes (tested). PoW, honeypot, rate limits, report link, admin page all exercised in tests. |
| 21 | Matches | No behavior-triggered warnings anywhere. |
| 22 | Matches | No demographic fields. The age policy is one sentence in the terms and appears nowhere else (tested); no age gate. Re-checked 2026-11-16. |
| 23 | Matches | Matching ignores everything but work, place, and format. |
| 24 | Matches | No "has read it" option. |

Re-walked in a browser on 2026-11-16 after the travel-distance change and the second review. Covered: a 200 km request from Bend, Oregon (extra proof-of-work), changing it to 100 km, starting a meeting, joining, removing the attendee, a refused rejoin from the same address, and cancelling. The rows above still hold. Row 18's board now uses a fixed 50 km rule and refreshes about hourly (DECISIONS.md D-31). That is still Illich's notice board of titles with no match, without names.

Gaps found during the walk-through and fixed: real browsers' form posts were rejected (Origin header), duplicate author names in Open Library results, and an over-long organizer page. See the git log.

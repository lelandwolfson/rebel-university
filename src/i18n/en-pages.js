import { html } from '../html.js';

// Long-form English pages. A translation adds a sibling file with the same exports.

const ILLICH_URL = 'https://theanarchistlibrary.org/library/ivan-illich-deschooling-society.pdf';

export function home(ctx, tipsBlock) {
  return html`<section class="hero">
<h1>Find someone to talk with about the thing you're reading.</h1>
<p class="lede">Name a book, article, film, or recording. When someone else names the same one, you can meet over coffee or on a video call and talk about it.</p>
<p><a class="button" href="/request/new">Name a work</a> <a class="button secondary" href="/meetings">See upcoming meetings</a></p>
<p class="adults"><strong>For adults (18+).</strong> Every meeting is voluntary, and it commits nobody to more than a cup of coffee.</p>
</section>

<section>
<h2>How it works</h2>
<ol class="steps">
  <li><strong>Name the work.</strong> Search for a book, or type in an article, film, or recording.</li>
  <li><strong>Say roughly where you are</strong>, or choose online only, and whether you'd meet in person, on video, or either.</li>
  <li><strong>Keep your private link.</strong> No account, no name, no profile. An email for match notices is optional.</li>
  <li><strong>When someone else names the same work nearby</strong> (or on video), either of you can start a meeting. Anyone can join.</li>
  <li><strong>Meet in a public place</strong> with the work on the table so you can find each other. Stay as long as you like. Leave whenever you want.</li>
</ol>
<p>The work is the only thing that matches people. There are no topics, levels, courses, or profiles. Nobody decides what is worth reading. If nobody has named your work yet, it goes on the <a href="/board">open board</a>, without your name, for others to see.</p>
</section>

${tipsBlock}

<section>
<h2>Where this comes from</h2>
<p>In 1971 Ivan Illich proposed a simple service: tell it a title you want to discuss, and it tells you who else asked for the same title. You meet in a coffee shop and find each other by the book on the table. <a href="/why">Read why this exists.</a></p>
</section>`;
}

export function why() {
  return html`<h1>Why this exists</h1>
<p>Rebel University is a small, working version of an idea from Ivan Illich's book <cite>Deschooling Society</cite> (1971). Illich argued that schools tie learning to curricula, certificates, and institutions, and that people learn better when they can find each other on their own terms. He sketched several "learning webs" to make that easier. One was a peer-matching network. This site is an attempt to build it.</p>

<h2>His design, in short</h2>
<p>In the first chapter Illich describes a service in New York City. A person tells a computer the title of a book, article, film, or recording they want to discuss, plus how to reach them. A few days later they get back a list of everyone else who recently named the same title. They phone each other and arrange to meet. Until then, they know each other only by the fact that they wanted to talk about the same work.</p>
<p>In the chapter "Learning Webs" he returns to it. The only way to get anyone's contact details out of the system is to name a title yourself, so people become known only to their potential peers. Titles with no match yet go up on bulletin boards and in classified ads, without names, so anyone interested can add themselves.</p>

<h2>Why the title, and nothing else</h2>
<p>Illich expected three objections, and his answers shape this site.</p>
<ul>
  <li><strong>Why not match people on an idea or theme?</strong> Because themes need someone in charge to define them, which turns the meeting into a class. A specific work lets its author set the terms, and lets the readers meet as equals. Anyone can choose any work. No panel of professors picks the reading list.</li>
  <li><strong>Why not match on age, background, or skill?</strong> Illich thought such filters usually come from contempt for people who are presumed not to understand. People who read something because it interests them have every right to meet and puzzle over it together.</li>
  <li><strong>Why not provide rooms, schedules, screening, and protection?</strong> That is what schools do, at great cost. Leave the initiative to the people meeting. A café will do. A first meeting obliges nobody to stay longer than one cup of coffee, or ever to meet again.</li>
</ul>

<h2>What we changed</h2>
<ul>
  <li><strong>Anonymous by default.</strong> Illich's version used names and addresses. Here you get a private link instead, and you pick a name for each meeting.</li>
  <li><strong>Video as well as in person</strong>, so people far apart can still meet.</li>
  <li><strong>Adults only</strong>, as a stated policy.</li>
  <li><strong>We keep as little as possible.</strong> Illich noted that such a system would create a record of who read what and met whom, and treated that lightly. We don't. See the <a href="/privacy">privacy page</a>.</li>
</ul>

<h2>What we leave out on purpose</h2>
<p>No courses, levels, certificates, rankings, recommendations, profiles, followers, feeds, or reminders to come back. Like a telephone, you use it to arrange a meeting and then you put it down.</p>

<p>Read the source: Ivan Illich, <a href="${ILLICH_URL}" rel="noopener noreferrer"><cite>Deschooling Society</cite></a>, chapter 1 and the "Peer-Matching" section of chapter 6.</p>`;
}

export function howToMeet() {
  return html`<h1>How to meet</h1>
<p>Meeting a stranger to talk about a book is one of the oldest good ideas there is. A few habits make it go well.</p>

<h2>Pick a good place</h2>
<ul>
  <li><strong>Somewhere public and busy</strong>, where people come and go: a coffee shop, a library, a park, a bookshop café.</li>
  <li><strong>Somewhere you can talk.</strong> Quiet enough to hear each other, not so quiet you feel watched.</li>
  <li><strong>Never someone's home</strong>, and not a place you can't easily leave.</li>
  <li><strong>During the day</strong> is best for a first meeting.</li>
</ul>

<h2>Find each other</h2>
<p>Bring the work and set it on the table. That's how the others will know you. You don't need to describe yourself in advance.</p>

<h2>Look after yourself</h2>
<ul>
  <li><strong>Come and go on your own.</strong> Get there and home under your own steam.</li>
  <li><strong>Share only what you choose to.</strong> First names are plenty. You don't owe anyone your address, workplace, or number.</li>
  <li><strong>Leave whenever you want.</strong> A meeting commits nobody to more than a cup of coffee, and nobody has to meet again.</li>
  <li>If someone makes you uncomfortable, go. If a meeting looks wrong, use the report link on its page.</li>
</ul>

<h2>Video meetings</h2>
<ul>
  <li>The organizer pastes a link to any video service. It leaves this site, and we don't check where it goes. If a link looks odd, don't open it.</li>
  <li>You can keep your camera off, use any name, and leave at any time.</li>
</ul>

<h2>Organizers</h2>
<p>If you start a meeting, you're its only moderator. You can edit it, close it to new people, remove anyone (including anyone you believe is under 18), or cancel it. Pick a place you'd be happy to meet a stranger in yourself.</p>

<h2>Who can join</h2>
<p>Anyone who names the same work, or finds the meeting on the listings, can join. That openness is the point, so choose places and share details with that in mind.</p>
<p>This site is for adults (18+). Every meeting is voluntary.</p>`;
}

export function privacy(ctx) {
  const mail = ctx.app.mailer.enabled;
  return html`<h1>Privacy</h1>
<p>We store only what a match needs, and delete it on a schedule. There are no accounts, no analytics, no trackers, no ads, and no third-party fonts or scripts.</p>

<h2>What we store, and for how long</h2>
<table>
<thead><tr><th>What</th><th>Why</th><th>Deleted</th></tr></thead>
<tbody>
<tr><td>The work you name (title, author or creator; for hand-entered works, an optional link)</td><td>It is the basis of a match</td><td>When no request or meeting uses it any more</td></tr>
<tr><td>Your request: the work, the city you picked (or "online only"), the meeting format, the hour it was posted</td><td>To find matches</td><td>When you close it, or 90 days after posting</td></tr>
<tr><td>A hash of your private link</td><td>To recognize the link when you return. We cannot turn the hash back into the link.</td><td>With the request or meeting</td></tr>
<tr><td>Your email address, if you give one</td><td>To tell you a match exists. Encrypted. Never shown to anyone.</td><td>When you remove it, close the request, or the request expires</td></tr>
<tr><td>Meetings: work, city, date, time zone, format, venue, video link, organizer note</td><td>To run the meeting</td><td>30 days after the meeting date</td></tr>
<tr><td>Your display name in a meeting</td><td>So the people in that meeting can recognize each other</td><td>When you leave, or 30 days after the meeting</td></tr>
<tr><td>Reports: the meeting, a reason, and optional text. Nothing about who sent it.</td><td>To handle abuse</td><td>When dismissed, or with the meeting</td></tr>
<tr><td>Backups of the database</td><td>To recover from failure</td><td>After 7 days</td></tr>
</tbody>
</table>
<p>Times are stored rounded to the hour. Nothing links one request to another, or a request to a meeting, or a display name in one meeting to any other.</p>

<h2>What we don't store</h2>
<ul>
  <li>Your name, unless you type it as a display name.</li>
  <li>Your IP address. To limit spam we keep short counters in memory, keyed by a scrambled form of the address that changes every day. They are never written to disk and expire within an hour.</li>
  <li>Logs of the pages you visit.</li>
  <li>Your birth date or any ID.</li>
</ul>

<h2>Who sees what</h2>
<ul>
  <li><strong>Everyone:</strong> the open board (works with no match yet, with region and country only), and the meeting listing (work, city, date, format).</li>
  <li><strong>You, with your private link:</strong> your request and how many people match it.</li>
  <li><strong>People who join a meeting:</strong> its venue, video link, note, and the display names of others who joined.</li>
  <li><strong>The site admin:</strong> requests and meetings (never emails), reports, and the audit log of admin actions.</li>
</ul>

<h2>Cookies</h2>
<p>One cookie that protects forms from cross-site forgery. It holds a random value and nothing about you. The admin has a second cookie when signed in.</p>

<h2>Other services</h2>
<ul>
  <li>When you search for a book, our server asks <a href="https://openlibrary.org" rel="noopener noreferrer">Open Library</a>. Your browser does not contact them, so they don't see your address.</li>
  <li>${mail ? 'Emails are sent through our mail provider, which handles the message in transit.' : 'Email notices are currently switched off.'}</li>
  <li>Video links go to whatever service the organizer chose. Their privacy terms apply there.</li>
  <li>City data comes from <a href="https://www.geonames.org" rel="noopener noreferrer">GeoNames</a> (CC BY 4.0) and is stored on our server.</li>
</ul>

<h2>Requests for data</h2>
<p>If anyone, including a government, asks for records, this page describes everything that exists. Most of it is gone within weeks.</p>

<h2>Your choices</h2>
<p>Close a request, remove your email, or leave a meeting from your private link at any time. That deletes the data right away (and from backups within 7 days).</p>`;
}

export function terms() {
  return html`<h1>Terms</h1>
<p>Plain-language terms. By using the site you agree to them.</p>

<h2>Adults only</h2>
<p>Rebel University is for people 18 and older. We do not ask for ages and cannot verify them. Anyone found to be under 18 will be removed. Organizers and the site admin can remove anyone they believe is under 18, and every meeting has a report link for this.</p>

<h2>Everything is voluntary</h2>
<p>The site helps adults find each other to talk about a work. Every request, meeting, and conversation is your own choice. Nobody is obliged to meet, to stay, or to meet again.</p>

<h2>What the site does and does not do</h2>
<ul>
  <li>It lists requests and meetings and shows people who want to discuss the same work how to find each other.</li>
  <li>It does <strong>not</strong> check who people are, check venues or video links, supervise meetings, or vouch for anyone.</li>
  <li>We recommend ways to meet well on the <a href="/how-to-meet">How to meet</a> page. We don't enforce them. You are responsible for your own choices and safety.</li>
</ul>

<h2>Liability</h2>
<p>The site is provided free and as is, without any warranty. To the extent the law allows, the people who run it are not liable for anything that happens at or because of a meeting, or for content that users post, or for the site being unavailable or losing data.</p>

<h2>Don't</h2>
<ul>
  <li>Use the site to harass, deceive, follow, or harm anyone.</li>
  <li>Post spam, advertising, or anything illegal.</li>
  <li>Try to break or overload the site, or collect data about people who use it.</li>
</ul>
<p>The admin may remove any request or meeting that breaks these terms, without notice.</p>

<h2>Changes</h2>
<p>We may change these terms. The current version is always on this page.</p>

<h2>Open source</h2>
<p>The code is free software under the GNU Affero General Public License v3.0.</p>`;
}

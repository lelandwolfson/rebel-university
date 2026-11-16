# Owner to-do

Things only you can do: accounts, payments, secrets, DNS, legal.

- [ ] **Publish the repo.** Creating a public GitHub repository was blocked by this session's permission settings, so the code is committed locally only. From the repo folder, run:
  `gh repo create lelandwolfson/rebel-university --public --source . --push`
  The source URL in the footer and security.txt assumes this name. If you use another, set `SOURCE_URL` (and `SECURITY_CONTACT` if needed) with `fly secrets set`.

- [ ] **Deploy.** Follow [DEPLOY.md](DEPLOY.md): Fly.io account and payment card, `APP_SECRET` and `ADMIN_SECRET`, DNS records for rebeluniversity.org.
- [ ] **The first deploy is the first real test of the Docker image.** Docker wasn't usable on the build machine (no permission to the Docker daemon), so the image was never built. Instead, the Dockerfile and fly.toml were checked line by line, and the app was run with the image's exact files, install command, and environment. That check found and fixed three problems: the volume permissions, memory, and a second machine. Watch `fly logs` during the first `fly deploy --ha=false`. If the build or start fails, the log will say why. To test before deploying, run `docker build -t rebel . && docker run --rm -p 8080:8080 -e APP_SECRET=$(openssl rand -base64 48) rebel` on any machine with Docker, then open http://localhost:8080/healthz.
- [ ] **Save `ADMIN_SECRET`** in your password manager.
- [ ] **Lawyer review.** Have a lawyer review the terms (`/terms`, `src/i18n/en-pages.js`), especially the adults-only wording and the liability section, and the privacy page.
- [ ] **Security contact.** Decide where vulnerability reports go. Default is GitHub private vulnerability reporting: turn it on under the repository's Settings → Security → "Private vulnerability reporting". Or set `SECURITY_CONTACT` to an email address.
- [ ] **Email notices (optional).** Pick an SMTP provider and set the `SMTP_*` secrets. Without them the site works, just without match emails. If you add email, set up SPF/DKIM for the sending domain as your provider instructs.
- [ ] **Off-site backups (optional).** Backups are on the same Fly volume plus Fly's snapshots. For a copy elsewhere, periodically run `fly ssh sftp get /data/backups/rebel-YYYY-MM-DD.db`. They contain encrypted emails and meeting details, so store them carefully and delete old ones.
- [ ] **Video without accounts (later).** See DECISIONS.md D-22 for notes on Jitsi and self-hosting.
- [ ] **Dependabot.** It is configured in `.github/dependabot.yml` with a 14-day cooldown. Merge its pull requests when CI passes.

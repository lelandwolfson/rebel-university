# Owner to-do

Only what is still open. The site is live at https://rebeluniversity.org.

- [ ] **Digest token.** Move `DIGEST_TOKEN` from `~/rebel-university-secrets.txt` into your password manager, then delete that file. It is already staged as a Fly secret and takes effect at the next deploy. Give it only to the cloud task that reads `https://rebeluniversity.org/admin/digest.json` (header `Authorization: Bearer <token>`). It can read that endpoint and nothing else.
- [ ] **AI moderation key (optional).** Create an Anthropic API key for this site only, with a monthly spending cap:
  1. In the Anthropic Console (console.anthropic.com), create a workspace named `rebel-university` (Settings → Workspaces).
  2. Open that workspace's limits and set a monthly **spend limit**, for example $5. The daily run uses a few cents a month at most.
  3. Create an API key inside that workspace (Settings → API keys). The spend limit applies to every key in the workspace.
  4. Set it: `fly secrets set ANTHROPIC_API_KEY=sk-ant-... --app rebel-university`. This restarts the app.

  To turn it off, run `fly secrets unset ANTHROPIC_API_KEY`, or use **Pause** on the admin Moderation page. To revoke the digest token, run `fly secrets unset DIGEST_TOKEN`.
- [ ] **Admin sign-in.** Sign in once at https://rebeluniversity.org/admin with `ADMIN_SECRET` to confirm it works. (Checked: wrong secrets and requests without a session are refused. The real secret was never typed into the live site during setup.)
- [ ] **Lawyer review.** Have a lawyer review the terms (`/terms`, `src/i18n/en-pages.js`), especially the liability section and the one-sentence age policy, and the privacy page.
- [ ] **Email notices (optional).** Pick an SMTP provider and set the `SMTP_*` secrets with `fly secrets set` (see DEPLOY.md). Without them the site works, just without match emails. If you add email, set up SPF/DKIM for the sending domain as your provider instructs.
- [ ] **Off-site backups (optional).** Backups are on the Fly volume plus Fly's 5-day snapshots. For a copy elsewhere, periodically run `fly ssh sftp get /data/backups/rebel-YYYY-MM-DD.db`. Store them carefully and delete old ones.
- [ ] **Video without accounts (later).** See DECISIONS.md D-22.

## Ongoing

- **Updates:** merge Dependabot pull requests when CI passes, then `fly deploy --ha=false`.
- **Fly CLI:** installed at `~/.fly/bin/fly`. Add `~/.fly/bin` to your PATH to use it as `fly`.
- **Cost:** about $3–4 a month (one 512 MB machine and a 1 GB volume in `iad`). Check https://fly.io/dashboard for the actual bill.

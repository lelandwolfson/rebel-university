# Deploy to Fly.io

About 30 minutes. Expected cost: about $2–3 a month (one shared-cpu-1x machine with 256 MB, a 1 GB volume, volume snapshots). Fly requires a payment card on the account.

You need a terminal with this repo checked out.

1. **Create a Fly.io account** at <https://fly.io/app/sign-up> and add a payment card.

2. **Install the CLI and sign in.**
   ```sh
   curl -L https://fly.io/install.sh | sh
   fly auth login
   ```

3. **Create the app.** From the repo folder:
   ```sh
   fly apps create rebel-university
   ```
   If the name is taken, pick another and change `app = "..."` at the top of `fly.toml` to match.

4. **Create the data volume** (same region as `primary_region` in `fly.toml`, `iad` by default):
   ```sh
   fly volumes create rebel_data --size 1 --region iad --yes
   ```

5. **Set the secrets.** These never go in the repo.
   ```sh
   fly secrets set APP_SECRET="$(openssl rand -base64 48)" ADMIN_SECRET="$(openssl rand -base64 48)"
   ```
   Then save `ADMIN_SECRET` in your password manager. You can't read it back from Fly. To see it once now, run `fly ssh console -C 'printenv ADMIN_SECRET'` after the first deploy. Don't change `APP_SECRET` later: it would make stored emails unreadable and invalidate open forms.

   Optional, email notices (any SMTP provider):
   ```sh
   fly secrets set SMTP_HOST=smtp.example.com SMTP_PORT=587 SMTP_USER=... SMTP_PASS=... SMTP_FROM="Rebel University <no-reply@rebeluniversity.org>"
   ```
   Optional, a security contact email for `/.well-known/security.txt`:
   ```sh
   fly secrets set SECURITY_CONTACT=security@rebeluniversity.org
   ```

6. **Deploy.**
   ```sh
   fly deploy
   ```
   Check it: `curl https://rebel-university.fly.dev/healthz` should print `ok`. (Use your app name if you changed it.)

7. **Add the domain to Fly.**
   ```sh
   fly certs add rebeluniversity.org
   fly certs add www.rebeluniversity.org
   fly ips list
   ```
   `fly ips list` shows a shared `v4` address and a `v6` address. If there is no `v6` line, run `fly ips allocate-v6` and list again.

8. **Enter DNS records** at your domain registrar, replacing the placeholders with the addresses from step 7:

   | Type | Name | Value |
   |---|---|---|
   | `A` | `@` | the `v4` address from `fly ips list` |
   | `AAAA` | `@` | the `v6` address from `fly ips list` |
   | `CNAME` | `www` | `rebel-university.fly.dev` (your app name + `.fly.dev`) |

   Remove any other `A`, `AAAA`, or `CNAME` records for `@` and `www` (registrars often add parking records). Set TTL to 300 or the lowest offered.

9. **Confirm HTTPS.** Certificates are issued once DNS resolves, usually within minutes, sometimes up to an hour.
   ```sh
   fly certs show rebeluniversity.org
   ```
   When it says the certificate is issued, open <https://rebeluniversity.org>. `http://` should redirect to `https://`, and `www` should redirect to the bare domain.

10. **Sign in to the admin page** at <https://rebeluniversity.org/admin> with your `ADMIN_SECRET`.

## Afterwards

Nothing needs weekly upkeep. Expired data is deleted hourly and a database backup is written daily to `/data/backups` (7 kept), on top of Fly's daily volume snapshots (7 kept).

- Logs: `fly logs`
- Update: `git pull && fly deploy`
- Restore a backup: `fly ssh console`, then `cp /data/backups/rebel-YYYY-MM-DD.db /data/restore.db && mv /data/restore.db /data/rebel.db && rm -f /data/rebel.db-wal /data/rebel.db-shm`, exit, and run `fly machine restart` right away.

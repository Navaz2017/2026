# Running Enrolla on your own server (Dell PowerEdge T620)

Everything here is free and runs on the one machine: Node.js, PostgreSQL, Redis (optional), nginx. **No cloud account, no card, no forex.**
Files (documents, photos, letters) are kept on the server's own disk; email goes through any SMTP account.

> **Honesty note.** I verified the pieces on Linux: the production build, starting in production mode on local storage,
> real SMTP delivery, backup + restore (data identical, tampered backups rejected), PDF fonts from the built code, and the systemd
> unit syntax. I have **not** run this whole guide on a real T620, so do a dry run before real applicants depend on it.

## 0. Decide how people will reach it
| Option | What you need | Good for |
|---|---|---|
| **A. Cloudflare Tunnel** (free) | a free Cloudflare account and a domain name on it (domains cost money; a temporary random `trycloudflare.com` address is free but changes) | the internet, even if your ISP blocks incoming connections (common: carrier-grade NAT) |
| **B. Your own domain + nginx + Let's Encrypt** | a domain, and a public IP address with ports 80/443 forwarded to the server | the internet, if your ISP gives a real public IP |
| **C. Local network only, plain http** | nothing | testing / a school office. Phones must be on the same Wi-Fi. Set `COOKIE_SECURE=false`. **The Android SMS-forwarder app requires https**, so it will not work in this mode. |

Parents' phones on mobile data and the SMS-forwarder phone both need A or B (https).

## 1. Prepare the machine
- **BIOS/iDRAC → "AC Power Recovery" = On** (or Last), so it starts by itself after a power cut.
- Put it on a **UPS** (and install `nut` so the server shuts down cleanly when the battery is low).
- Disks: use the PERC controller for **RAID 1** (mirror) for the OS and data if you have two or more disks.
- Install **Ubuntu Server 24.04 LTS** (free). During setup enable OpenSSH.
- **Clock must be correct** (authenticator codes and SMS signatures fail if it drifts > 5 min): `sudo apt install -y chrony`.
- Firewall: `sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable` (skip 80/443 for option A).

## 2. Install software
```bash
sudo apt update && sudo apt install -y git curl postgresql redis-server nginx openssl rsync
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
psql --version; node -v        # PostgreSQL 16 on Ubuntu 24.04, Node v20
```
Redis is only for letters/WhatsApp; it listens on localhost by default. Skip it if you will not send letters yet.

## 3. User, folders, database
```bash
sudo useradd --system --create-home --home-dir /opt/enrolla --shell /usr/sbin/nologin enrolla
sudo mkdir -p /etc/enrolla /var/lib/enrolla/files /var/lib/enrolla/wa-sessions /var/log/enrolla /var/backups/enrolla
sudo chown -R enrolla:enrolla /var/lib/enrolla /var/log/enrolla /var/backups/enrolla
sudo chmod 700 /var/backups/enrolla

sudo -u postgres psql -c "CREATE USER enrolla WITH PASSWORD 'CHOOSE_A_LONG_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE admissions OWNER enrolla;"
```
PostgreSQL listens on localhost only by default — keep it that way.

## 4. Get and build the code
```bash
sudo -u enrolla git clone -b claude/amazing-allen-v8q4e9 https://github.com/Navaz2017/2026.git /opt/enrolla/src
# the unit files expect /opt/enrolla/backend, /opt/enrolla/web, /opt/enrolla/ops:
sudo -u enrolla ln -s /opt/enrolla/src/backend /opt/enrolla/backend
sudo -u enrolla ln -s /opt/enrolla/src/web /opt/enrolla/web
sudo -u enrolla ln -s /opt/enrolla/src/ops /opt/enrolla/ops

cd /opt/enrolla/backend && sudo -u enrolla bash -c 'PUPPETEER_SKIP_DOWNLOAD=1 npm ci && npx prisma generate && npm run build'
```
## 5. Configure
```bash
sudo cp /opt/enrolla/ops/backend.env.example /etc/enrolla/backend.env
sudo cp /opt/enrolla/ops/web.env.example /etc/enrolla/web.env
sudo chown root:enrolla /etc/enrolla/*.env && sudo chmod 640 /etc/enrolla/*.env
openssl rand -hex 32     # run three times: JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, DATA_ENC_KEY
sudo nano /etc/enrolla/backend.env     # fill in the secrets, DATABASE_URL password, your addresses, SMTP details
sudo nano /etc/enrolla/web.env
```
**Back up `/etc/enrolla/backend.env` somewhere safe and separate.** Losing `DATA_ENC_KEY` makes stored authenticator secrets and SMS-phone keys unreadable.

Create the database tables and the first owner account:
```bash
cd /opt/enrolla/backend
sudo -u enrolla /opt/enrolla/ops/with-env.sh npx prisma migrate deploy
sudo -u enrolla /opt/enrolla/ops/with-env.sh env OWNER_EMAIL=you@example.org OWNER_PASSWORD="a-long-password-here" npx tsx scripts/create-owner.ts
```
Build the website (use your real https API address; it is baked in):
```bash
cd /opt/enrolla/web && sudo -u enrolla bash -c 'npm ci && NEXT_PUBLIC_API_URL=https://api.example.org npm run build'
```

## 6. Start everything (and on every boot)
```bash
sudo cp /opt/enrolla/ops/systemd/*.service /opt/enrolla/ops/systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now enrolla-api enrolla-web enrolla-worker enrolla-backup.timer
# only if you use WhatsApp (see §9): sudo systemctl enable --now enrolla-wa
systemctl status enrolla-api        # "active (running)"; the first lines of `journalctl -u enrolla-api` warn if the database is behind
curl -s http://127.0.0.1:4000/healthz
```
## 7. Make it reachable
**Option B (domain + nginx):**
```bash
sudo cp /opt/enrolla/ops/nginx/enrolla.conf /etc/nginx/sites-available/enrolla.conf   # edit example.org -> your domain
sudo ln -s /etc/nginx/sites-available/enrolla.conf /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d example.org -d api.example.org
```
**Option A (Cloudflare Tunnel):** install `cloudflared` from Cloudflare's site, create a tunnel, and map `example.org → http://127.0.0.1:3000` and `api.example.org → http://127.0.0.1:4000`. No nginx or open ports needed.

**Option C (LAN only):** in `/etc/enrolla/web.env` set `COOKIE_SECURE=false`, set `NEXT_PUBLIC_API_URL=http://SERVER_IP:4000`, `PUBLIC_API_URL=http://SERVER_IP:4000`, `WEB_URL=http://SERVER_IP:3000`, `CORS_ORIGINS=http://SERVER_IP:3000`, rebuild the web app, and bind the services to the LAN (remove `-H 127.0.0.1` from the web unit). Uploads work (the browser falls back to built-in hashing), but the SMS-forwarder app will not.

## 8. First sign-in checklist
1. Open the site, sign in as the owner → **Security**: set up the authenticator and **write down the 8 recovery codes**.
2. **Revenue sharing**: confirm 30% / 30%; set the **Airtel Money and Mpamba numbers** applicants pay to.
3. **SMS phones**: register the phone (shows its ID + key once) and install the Android forwarder (`sms-forwarder/README.md`).
4. Send a test payment through the whole flow with a small amount before real applicants.

## 9. WhatsApp linking (optional)
It needs a real browser on the server (Ubuntu 22.04):
```bash
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt install -y ./google-chrome-stable_current_amd64.deb      # also installs the libraries Chrome needs
echo 'WHATSAPP_CHROME_PATH=/usr/bin/google-chrome-stable' | sudo tee -a /etc/enrolla/backend.env
cd /opt/enrolla/backend && sudo -u enrolla bash -c 'set -a; . /etc/enrolla/backend.env; set +a; npx tsx scripts/wa-check.ts'   # must end with "All good"
sudo systemctl enable --now enrolla-wa
```
Run exactly one instance. Each institution's login lives in its own folder under `WA_DATA_DIR` (`session-<institution id>`), included in the nightly backup.
Read `docs/whatsapp.md` first (it is an unofficial method; numbers can be banned).

## 10. Backups (do not skip)
`enrolla-backup.timer` runs `ops/backup.sh` every night at 01:30: database dump + uploaded files + WhatsApp sessions, checksummed, kept 14 days in `/var/backups/enrolla`.
- **Attach a second disk or USB drive**, mount it (e.g. `/mnt/backup`), and keep the `COPY_TO=` line in `enrolla-backup.service`. One copy on the same disk is not a backup.
- Run one by hand: `sudo systemctl start enrolla-backup && journalctl -u enrolla-backup -n 5`.
- **Practise a restore** once a month into a spare database:
  `sudo -u enrolla TARGET_DATABASE_URL=postgresql://enrolla:PW@127.0.0.1/spare RESTORE_FILES_DIR=/tmp/restore-test /opt/enrolla/ops/restore.sh /var/backups/enrolla/<date> --yes`
- A real restore: stop the services first (`sudo systemctl stop enrolla-*`), run `restore.sh <backup> --yes`, start them again.

## 11. Updating to a new version
```bash
cd /opt/enrolla/src && sudo -u enrolla git pull
cd backend && sudo -u enrolla bash -c 'npm ci && npx prisma generate && npm run build'
sudo -u enrolla /opt/enrolla/ops/with-env.sh npx prisma migrate deploy
cd ../web && sudo -u enrolla bash -c 'npm ci && NEXT_PUBLIC_API_URL=https://api.example.org npm run build'
sudo systemctl restart enrolla-api enrolla-worker enrolla-web      # run a backup first!
```

## 12. When things go wrong
| Problem | Do this |
|---|---|
| Owner lost phone **and** recovery codes | on the server: `cd /opt/enrolla/backend && sudo -u enrolla /opt/enrolla/ops/with-env.sh npx tsx scripts/reset-mfa.ts you@example.org`. Then sign in and set it up again. |
| School staff lost phone | the owner opens **Users → Reset two-step** for them. |
| Browser shows 500 errors | `journalctl -u enrolla-api -n 50`. A line starting `!! DATABASE IS OUT OF DATE` means run `prisma migrate deploy`. |
| Emails never arrive | check `SMTP_*` in `backend.env`; without `SMTP_HOST`, emails are only written to the log (reset links can be read from `journalctl -u enrolla-api`). |
| Uploads fail on a big video | nginx `client_max_body_size` (210m for the API block) and the 200 MB limit. |
| After a power cut | services start by themselves; check `systemctl --failed` and that the clock is right (`timedatectl`). |
| Disk filling up | uploaded files grow over time: `du -sh /var/lib/enrolla/files /var/backups/enrolla`. |

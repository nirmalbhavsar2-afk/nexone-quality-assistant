# Deploying NexOne Quality Assistant — Team Edition

This is the multi-user version of the app: everyone on your team logs into
the same server with their own account, sees the same live projects and
candidates, and permissions (Admin / Recruiter / QA Agent / Viewer) are
enforced by the server itself — not just hidden in the UI. That's the
piece a single shared HTML file can't do, which is why this needs an
actual server instead of a file you email around.

You don't need to know Docker or Linux administration to get this running,
but you do need to actually provision a small cloud server and run a few
commands on it — I can't click "deploy" on your behalf from here. Budget
about 20-30 minutes for a first-time setup.

There are two paths below. **Render.com (Option A) is the one I'd pick** —
it's a web dashboard, not a terminal, and it gives you free HTTPS
automatically. Option B (a plain VPS) is for if you want full control or
already have a server you pay for.

---

## Before you start: generate a JWT secret

Both options need a long random secret used to sign login sessions. Run
this once anywhere you have Node installed (or ask me to generate one for
you) and save the output — you'll paste it into an environment variable
in a minute:

```
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## Option A: Render.com (recommended — free HTTPS, no server admin)

Render builds your Dockerfile for you and gives you a `https://your-app.onrender.com`
URL with HTTPS already set up. Their free tier works for evaluating this;
for daily team use, their cheapest paid "Starter" instance ($7/mo at time
of writing — verify current pricing on render.com) keeps the app from
sleeping between uses and gives the database a persistent disk.

1. **Push this `server/` folder to a GitHub repository.** Render deploys
   from a git repo, not a zip upload. If you don't already have one:
   create a new empty repo on GitHub, then from this folder:
   ```
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```
   (`.env` is already excluded via `.gitignore` — never commit real
   secrets to the repo.)

2. **On [render.com](https://render.com):** New + → Web Service → connect
   the repo you just pushed.

3. Render should auto-detect the `Dockerfile`. If it asks, set:
   - **Environment:** Docker
   - **Region:** whichever is closest to your team
   - **Instance type:** Starter (or Free, to try it out first)

4. **Add a persistent disk** (Render dashboard → your service → Disks):
   - Mount path: `/data`
   - Size: 1 GB is plenty to start (it's just SQLite + resume text)

   This is the step that makes your data survive redeploys — don't skip
   it. Without it, every deploy wipes your candidates and users.

5. **Set environment variables** (Render dashboard → Environment):
   | Key | Value |
   |---|---|
   | `JWT_SECRET` | the random string you generated above |
   | `ADMIN_EMAIL` | your email, becomes the first Admin login |
   | `ADMIN_PASSWORD` | a real password — change it after first login |
   | `DATA_DIR` | `/data` |
   | `NODE_ENV` | `production` |
   | `ANTHROPIC_API_KEY` | *(optional)* only if you want live AI scoring instead of the built-in mock engine |

6. **Deploy.** Render builds the image and gives you a URL like
   `https://nexone-quality.onrender.com`. Open it, log in with the admin
   email/password you set, and change that password immediately from
   Settings → Users.

7. **Custom domain (optional):** Render → Settings → Custom Domains lets
   you point something like `quality.nexellencetalent.com` at it with a
   free managed TLS cert.

That's it — your team logs into that URL from any browser, anywhere.

---

## Option B: a plain cloud VPS (DigitalOcean / Lightsail / Hetzner / etc.)

Use this if you already have a small cloud server, or want to run
multiple internal tools on one box. Any $5-6/mo droplet-class VPS with
Docker installed is enough for a small team.

### 1. Get a server and point a domain at it

Spin up a small Ubuntu VPS from any provider. Note its public IP. In your
domain's DNS settings, add an A record (e.g. `quality.yourcompany.com` →
that IP). DNS propagation can take a few minutes to a few hours.

### 2. Install Docker on the server

```
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```
(log out and back in for the group change to apply, or just use `sudo`
for the docker commands below)

### 3. Copy this `server/` folder onto the VPS

From your own machine:
```
scp -r server/ youruser@your-server-ip:~/nexone-quality-assistant
```

### 4. Configure environment variables

On the server:
```
cd ~/nexone-quality-assistant
cp .env.example .env
nano .env      # fill in JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
```

### 5. Start it

```
docker compose up -d --build
```

This builds the image and starts it listening on `localhost:8080` inside
the server (see `docker-compose.yml` if you want a different port). The
SQLite database lives in a named Docker volume, so `docker compose down`
and `docker compose up -d` again won't lose your data — only
`docker compose down -v` would.

### 6. Put HTTPS in front of it (do not skip this)

The app sets its login cookie as `Secure` in production mode, meaning
browsers will only keep you logged in over **HTTPS**. Serving it over
plain HTTP will make login silently fail to persist. The easiest way to
get free, auto-renewing HTTPS on a VPS is [Caddy](https://caddyserver.com/):

```
sudo apt install -y caddy
```

Then edit `/etc/caddy/Caddyfile` to just:
```
quality.yourcompany.com {
    reverse_proxy localhost:8080
}
```

```
sudo systemctl restart caddy
```

Caddy automatically requests and renews a Let's Encrypt certificate for
your domain the first time it starts, as long as the DNS A record from
step 1 is already pointing at this server. Your app is now live at
`https://quality.yourcompany.com`.

### 7. Log in and lock it down

Open the URL, log in with the admin email/password from your `.env`,
and change the password from Settings → Users. Add your teammates there
too (Admin → Users → Add User) with the appropriate role.

### Updating later

```
cd ~/nexone-quality-assistant
git pull        # or scp the updated files over again
docker compose up -d --build
```

---

## What each role can actually do (enforced server-side)

- **Admin** — everything, plus user management and scoring/policy settings.
- **Recruiter** — create reviews, run analysis, QA-override candidates, add notes, export.
- **QA Agent** — review and override AI scores/recommendations, add notes; cannot create new reviews or manage settings/users.
- **Viewer** — read-only across the board.

These are enforced in the API itself (`server/auth.js` + per-route
middleware), not just hidden buttons — a Viewer account cannot write data
even by calling the API directly.

## Backing up your data

The entire team's data (users, projects, candidates, scores, notes, audit
trail) lives in one SQLite file. To back it up:

- **Render:** the persistent disk is backed up per Render's own disk
  snapshot policy — check their current docs. For your own copy, you can
  shell into the instance (Render dashboard → Shell) and download
  `/data/app.db`.
- **VPS:** `docker cp <container_id>:/data/app.db ./backup-$(date +%F).db`
  — safe to run while the app is live (SQLite WAL mode handles this).

## Enabling live AI scoring (optional)

By default the app runs on a deterministic built-in evaluation engine —
no external API calls, no cost, fully explainable. If you want candidate
evaluation to instead call the Anthropic API for live AI-assisted
scoring, set `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`) as an
environment variable on whichever hosting option you chose, then restart
the app. The key is read only on the server and is never sent to
anyone's browser. Leave it unset to stay on the free built-in engine.

## A note on what I verified vs. what I couldn't from here

I ran the full application end-to-end against this exact codebase —
login, multi-user creation with role enforcement, project creation,
candidate analysis, QA overrides with audit trail, notes, and CSV export
all work correctly, including the job-hopper and 1985-seniority
screening policies. I also verified `production` mode correctly marks
the login cookie `Secure`, which is why the HTTPS step above matters.

What I could *not* do from this sandboxed workspace is actually build
the Docker image (outbound access to Docker Hub is blocked here) or
provision real cloud infrastructure — those steps happen for the first
time when you run them on Render or your VPS. If the build fails on
first try on your platform, it's almost certainly a straightforward
environment issue (wrong Node version, missing env var) rather than a
problem with the app logic itself — send me the error and I can help
debug it.

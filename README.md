# Opus Build Day, Bangalore: the pile

The event page for Claude Community's Opus Build Day (26 September, 9 AM). It has a physics pile where each block is an attendee, a builder directory, teams, a collider that uses Claude to invent project ideas, and a wall.

The stack has two parts and no server of our own:

```
Browser ──► GitHub Pages (index.html, css/, js/)
               │ supabase-js (publishable key)
               ▼
            Supabase
             ├── Auth       guest (anonymous) sign-in + optional magic-link email
             ├── PostgreSQL profiles, skills, teams, wall, announcements, chat
             ├── Realtime   new blocks drop into everyone's pile, live wall/teams
             ├── RLS        who may change what (sql/schema.sql)
             └── Edge Function `collider` → Claude API (key stays server-side)
```

## Repository layout

```
index.html                 page shell (same markup, fonts and scripts as before)
css/style.css              the original styles, unchanged, plus a small announcement bar
js/config.js               Supabase URL + publishable key (the only thing you edit)
js/supabase.js             creates the client, maps errors to friendly codes
js/auth.js                 guest sessions, magic links, host check
js/builders.js             profiles + user_skills + user_interests
js/teams.js                teams + team_members
js/wall.js                 wall_posts
js/announcements.js        host announcements
js/collider.js             calls the collider Edge Function
js/realtime.js             database change feeds + presence/sparks room
js/app.js                  the original UI and physics, now reading from and writing to Supabase
sql/schema.sql             tables, RLS policies, RPCs, triggers, realtime publication
supabase/functions/collider/index.ts   Claude-powered collider (Deno)
.nojekyll                  serve files as-is on GitHub Pages
```

The UI is unchanged. Where the page used to keep data in the `S.builders / S.teams / S.wall` state and `localStorage`, it now loads that state from PostgreSQL, writes changes back, and re-renders when Realtime says something changed. The old "view-only link → send a code to the host" workaround is gone because everyone can now write their own rows.

## Setup

### 1. Create the Supabase project

1. Create a project (for example `opus-build-day`) at https://supabase.com.
2. Open **SQL Editor**, paste all of `sql/schema.sql`, and run it. You can run it again safely.
3. Go to **Authentication → Sign In / Providers**:
   * Switch on **Allow anonymous sign-ins**. This is the default `AUTH_MODE`, and it lets people join with no sign-up step.
   * Leave **Email** on so people can link an email and sign back in from another device.
4. Go to **Authentication → URL Configuration**:
   * **Site URL**: `https://<your-user>.github.io/<repo>/`
   * **Redirect URLs**: add the same URL, plus `http://localhost:8000/` for local testing.
5. Go to **Authentication → Rate Limits**. Everyone at the venue shares one Wi-Fi IP, so raise **anonymous sign-ins per hour** well above the number of attendees (for example 500).
6. Email: Supabase's built-in sender only allows a couple of emails per hour. That's fine for guest mode, where email is optional. If you plan to rely on emails (magic links or linking emails), set up custom SMTP under **Authentication → Emails → SMTP Settings** (Resend, SendGrid, Postmark and so on).

### 2. Point the page at the project

In **Project Settings → API Keys**, copy the project URL and the **publishable** key into `js/config.js`:

```js
window.APP_CONFIG = {
    SUPABASE_URL: 'https://xxxx.supabase.co',
    SUPABASE_KEY: 'sb_publishable_xxxxx',
    AUTH_MODE: 'anonymous',      // or 'email' for magic-link only
    COLLIDER_ENABLED: false      // true once step 4 is done
};
```

The publishable key is meant to be public, and RLS is what protects the data. Never put the `service_role`/secret key, the database password, or any Anthropic or OpenAI key in this repo. `js/supabase.js` refuses to start if it sees a secret key.

If `SUPABASE_URL` is empty, the page runs in read-only preview mode using the small sample in `index.html`.

### 3. Publish on GitHub Pages

1. Merge this branch into `main`.
2. Go to **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`**.
3. The site goes live at `https://<your-user>.github.io/<repo>/`, and every push to `main` updates it.

To run it locally, use any static server:

```bash
python3 -m http.server 8000   # then open http://localhost:8000/
```

### 4. Turn on the collider (optional, needs an Anthropic API key)

The collider runs server-side so the Claude key never reaches the browser.

```bash
npm i -g supabase               # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase secrets set ALLOWED_ORIGIN=https://<your-user>.github.io   # optional CORS lock-down
supabase functions deploy collider --no-verify-jwt
```

Then set `COLLIDER_ENABLED: true` in `js/config.js`.

* The function checks the caller's own session itself, which is why it's deployed with `--no-verify-jwt`. It only accepts builder ids, reads the profiles from the database, and builds the prompt server-side.
* Each person gets 20 calls per hour (`COLLIDER_HOURLY_LIMIT`), tracked in `ai_usage`.
* The model defaults to `claude-opus-5`. Change it with `supabase secrets set COLLIDER_MODEL=...`. If the model declines a request, it is retried server-side on Anthropic's recommended fallback.

### 5. Make yourself a host

Add your block on the live site and link your email when prompted (so you can get back in from any device). Then run this in the SQL Editor:

```sql
update public.profiles set is_host = true
where id = (select id from auth.users where email = 'you@example.com');
```

Reload the page and a **Host desk** appears at the bottom. From there you can publish announcements (shown live at the top of every open page, for example "Lunch moved to 1:15 PM") and remove any block, team or note. The browser can never set `is_host` itself because the column isn't writable by the `authenticated` role.

## Data model

| Table | What it holds | Who can write |
|---|---|---|
| `profiles` | one block per person: name, role, building, linkedin, shape, tone, `is_host` | own row; host can delete |
| `user_skills` | "What you bring" chips | own rows (via `save_profile` RPC) |
| `user_interests` | "Looking for" chips | own rows (via `save_profile` RPC) |
| `teams` | name, idea, needs (up to 4), owner | owner; host can delete |
| `team_members` | who's on which team (up to 8, enforced by trigger) | yourself; team owner or host can remove |
| `wall_posts` | kind + message (280 chars) | author; host can delete |
| `announcements` | host notices | hosts only |
| `chat_messages` | `general`, `team:<id>`, `user:<a>:<b>` rooms (schema ready, no UI yet) | room members |
| `ai_usage` | collider rate limiting | Edge Function only |

Anyone can read profiles, teams, the wall and active announcements, even without signing in, just like the original public page. A visitor only gets a guest account the first time they add a block, post, or use the collider.

## Pre-event test checklist

1. A new visitor can open the site (and in an incognito window).
2. **Throw your block in** saves, and the block drops into the pile with a "you!" ring.
3. A second browser sees the new block drop in without refreshing.
4. **Edit my block** changes the card and the block's shape and colour.
5. Refreshing keeps everything, including "Edit my block" for the same person.
6. Start a team. A second person can join, leave, and sees "Team is full" at eight.
7. Post to the wall. It appears on a second device within a second or two.
8. Adding an email sends a confirmation. **Sign in with email** on another device brings back the same block.
9. A normal user sees no **Remove** button on other people's cards, and a direct API call to delete them changes nothing (RLS).
10. Host: publish an announcement and check it appears on every open page; then take it down.
11. Collider: **Collide**, **Surprise me** and **Who should I meet?** return ideas (if enabled).
12. **Throw a spark** lands on other open screens, and "N people on this page right now" updates.
13. Mobile Chrome and Safari work.

## Next up (V1.1)

`chat_messages` already has its schema, RLS and realtime set up. A general/team chat UI is the natural next step, followed by an "online now" list built on the same presence channel the sparks use.

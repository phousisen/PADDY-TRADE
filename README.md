# PaddyTrade — Live Version

This is the real, live PaddyTrade app. It connects directly to your Supabase
database (real logins, real permissions enforced by the database itself, real
data shared across everyone who logs in).

Your Supabase URL and key are already filled in for you in
`.env.local.example` — see step 3 below.

## Getting this live on the internet (no coding required)

### 1. Upload this folder to GitHub

1. Go to github.com and log in.
2. Click the "+" icon (top right) → "New repository".
3. Name it `paddytrade` (or anything you like), leave it Public or Private, don't check any boxes, click "Create repository".
4. On the next page, click "uploading an existing file".
5. Unzip the file I gave you, then drag the **entire contents** of the `paddytrade-live` folder (not the folder itself — the files and folders inside it) into the upload box.
6. Scroll down, click "Commit changes".

### 2. Connect Vercel to that GitHub repository

1. Go to vercel.com and log in.
2. Click "Add New..." → "Project".
3. Find your `paddytrade` repository in the list and click "Import".
4. Vercel will detect it's a Vite project automatically — you don't need to change any build settings.

### 3. Add your Supabase keys to Vercel (important — do this before deploying)

1. Still on that import screen, find "Environment Variables".
2. Add these two, exactly as shown:
   - Name: `VITE_SUPABASE_URL` — Value: `https://fclawqlzncgmlfoctjhk.supabase.co`
   - Name: `VITE_SUPABASE_ANON_KEY` — Value: `sb_publishable_XKNZ6X2VDITz2-GDsUtS6g_h6Jxn5Wt`
3. Click "Deploy".

Wait about a minute. Vercel will give you a real web address (something like
`paddytrade.vercel.app`) — that's your live app, reachable from any device,
anywhere.

### 4. Log in

Use one of the three accounts you created in Supabase earlier:
- `hq@paddytrade.local` — sees everything, all locations, reports
- `manager@paddytrade.local` — Battambang location only, can't edit/delete
- `staff@paddytrade.local` — Battambang location only, can't edit/delete

## Making changes later

Any time I give you updated code, repeat step 1 (upload the new files to the
same GitHub repository, overwriting the old ones) — Vercel automatically
redeploys within about a minute of any change to GitHub. You won't need to
touch Vercel again after the first setup.

## Adding real users for other locations

Right now there are 3 demo logins, all either HQ or tied to Battambang. To add
a real manager or staff account for another location:

1. In Supabase → Authentication → Users → Add user (set their email + password, toggle Auto Confirm ON).
2. In Supabase → SQL Editor, run (replacing the email and location name):

```sql
UPDATE public.profiles
SET role = 'manager', location_id = (SELECT id FROM public.locations WHERE name = 'Siem Reap Main Hub')
WHERE id = (SELECT id FROM auth.users WHERE email = 'newmanager@paddytrade.local');
```

Use `role = 'staff'` instead of `'manager'` for a staff account.

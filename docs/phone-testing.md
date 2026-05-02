# Testing the PWA on a real phone

## The problem you'll hit first: `Camera not available in this browser`

When you open the PWA from a phone using a plain LAN URL like `http://192.168.1.101:5173`, the camera capture screen throws:

> Camera not available in this browser. Use Chrome / Safari / Edge on a device with a front camera.

This message comes from [`apps/web/src/lib/camera.ts:57`](../apps/web/src/lib/camera.ts), which checks `navigator.mediaDevices?.getUserMedia` before starting capture. The check is correct — the browser has genuinely hidden the API. The cause is the **secure-context** rule:

- `getUserMedia` (camera), `navigator.geolocation` (geo-fence), `Notification` (push), and `serviceWorker` (PWA installability) are only exposed on secure origins.
- A "secure origin" is **HTTPS** _or_ exactly `localhost`/`127.0.0.1`.
- `http://192.168.x.x` is plain HTTP from a non-localhost host → the APIs are not exposed; nothing the app does can re-enable them.

This applies to every modern browser (Chrome, Safari, Firefox, Edge) on every platform. There's no permission prompt to override and no PWA setting that turns it off.

### Quick "does this URL work?" matrix

| URL pattern you open | Camera + geo + PWA install? |
|---|---|
| `http://localhost:5173` (laptop browser) | ✓ |
| `http://127.0.0.1:5173` (laptop browser) | ✓ |
| `http://192.168.x.x:5173` (phone or laptop) | ✗ |
| Public IP via router port-forward, plain HTTP | ✗ |
| `https://*.ngrok-free.app` (phone) | ✓ |
| `https://*.trycloudflare.com` (phone) | ✓ |
| `https://your-app.vercel.app` (phone) | ✓ |
| `http://localhost:5173` via Chrome DevTools USB port-forward (phone) | ✓ — origin is `localhost` from the phone's view |

## Options

Listed from "fastest to set up for a one-developer MVP" to "more setup, more permanent". Pick whichever fits where you are in the project.

### 1. ngrok tunnel (recommended for now — already wired up)

What this repo's [`pnpm tunnel`](../package.json) script targets. Free tier gives you one **static domain** (`some-words-1234.ngrok-free.app`) that survives restarts.

**Setup once:**
1. `scoop install ngrok` (or download from <https://ngrok.com/download>).
2. Sign up at <https://dashboard.ngrok.com/signup>; copy authtoken.
3. `ngrok config add-authtoken <token>`.
4. Claim free static domain at <https://dashboard.ngrok.com/cloud-edge/domains>.
5. Edit `apps/web/.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-DOMAIN.ngrok-free.app
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<same anon key as before>
   ```
6. Edit `tunnel` script in root `package.json` to: `ngrok http --url=YOUR-DOMAIN.ngrok-free.app 5173`.

**Per session:** run `pnpm supabase:start`, `pnpm dev`, `pnpm tunnel` in three terminals; open the ngrok URL on your phone.

**Pros:** Works from cellular, stable URL, single tunnel covers PWA + Supabase API (Vite proxy in [`apps/web/vite.config.ts`](../apps/web/vite.config.ts)).
**Cons:** 40 req/min rate limit on free tier; ngrok is in the request path (TLS terminates there); URL is publicly reachable while the tunnel is up.

### 2. Chrome DevTools USB port forwarding (free, no tunnel, single phone)

Tether your Android phone to the laptop with a USB cable; Chrome forwards `localhost:5173` from the phone to the laptop. From the phone's view the URL is `http://localhost:5173` — which **is** a secure context. Camera and geo work without HTTPS.

**Setup:**
1. On phone: Settings → About phone → tap *Build number* 7 times to enable Developer options. Then Developer options → USB debugging on.
2. Connect phone to laptop via USB cable. Approve the "Allow USB debugging?" prompt on the phone.
3. On laptop Chrome, go to `chrome://inspect/#devices`. Phone should appear under "Remote Target".
4. Click *Port forwarding…* button. Add: `5173` → `localhost:5173`. Tick *Enable port forwarding*.
5. On phone, open `http://localhost:5173` in Chrome.

**Pros:** Free; truly local (no traffic leaves the laptop); fastest iteration loop because you're hitting your dev server directly.
**Cons:** Only works while phone is tethered + USB debugging is on; one phone at a time; no cellular; not how a real worker would access the app.

Best for **iterating on UI/camera flow** when you don't need to simulate a real worker's network conditions.

### 3. Cloudflare Tunnel (`cloudflared`)

Free, more permanent than ngrok if you have a domain (or use the random `*.trycloudflare.com` URL). Supports multiple hostnames through one tunnel.

**Setup:**
1. Install `cloudflared` (winget, scoop, or <https://github.com/cloudflare/cloudflared/releases>).
2. **Quick test (no account, random URL):** `cloudflared tunnel --url http://localhost:5173` — gives you a `*.trycloudflare.com` URL that works for the duration of the process.
3. **Persistent named tunnel:** `cloudflared tunnel login`, `cloudflared tunnel create attendance`, point it at your Cloudflare-managed domain via DNS, run `cloudflared tunnel run attendance`. Setup takes ~15 minutes the first time.

**Pros:** Free, no rate limit, persistent URL with custom domain, no Cloudflare account needed for quick tests.
**Cons:** More setup than ngrok for the persistent variant; needs a domain on Cloudflare.

### 4. Hosted Supabase + Vercel/Netlify deploy

The "long-term right answer" for an MVP that anyone other than you will touch.

**Setup:**
1. Create project at <https://supabase.com/dashboard>; pick the closest region; save the DB password in your password manager.
2. `npx supabase login`, `npx supabase link --project-ref <REF>`, `npx supabase db push`, `npx supabase functions deploy <name>`.
3. Run the `scripts/ci-setup.sh` (or equivalent) against the hosted DB to create your admin user.
4. Connect this repo to Vercel or Netlify. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the hosted project's values in the Vercel/Netlify env settings.
5. Push. Vercel/Netlify gives you a permanent `https://yourname.vercel.app` URL with proper TLS.

**Pros:** Real isolation, real HTTPS, no daily setup, multiple workers can install the PWA independently, free tier covers MVP traffic.
**Cons:** Slower iteration loop (push → CI → preview), and you're now running schema migrations against a real (free-tier) DB so be careful with `db reset`.

### 5. Tailscale Funnel

If you already use Tailscale, `tailscale funnel 5173` exposes your local port over HTTPS at `https://<your-machine>.tail-scale-id.ts.net`. Free for personal use.

**Pros:** No extra account, HTTPS, persistent URL.
**Cons:** Requires Tailscale on the laptop; the URL is associated with your Tailscale identity.

### 6. mkcert + LAN HTTPS

Generate a local-CA-signed cert, install the root CA on the phone, serve Vite on HTTPS over your LAN IP.

**Setup:**
1. `scoop install mkcert` (or <https://github.com/FiloSottile/mkcert>).
2. `mkcert -install` on the laptop.
3. `mkcert 192.168.1.101 localhost 127.0.0.1` → produces `.pem` cert + key.
4. Update `apps/web/vite.config.ts` `server.https = { cert: …, key: … }`.
5. On the phone: copy `rootCA.pem` from `mkcert -CAROOT`, install via Settings → Security → Install a certificate → CA certificate. (Android may show "Network may be monitored" — that's normal.)
6. Open `https://192.168.1.101:5173` on phone.

**Pros:** No third-party tunnel; works on the local Wi-Fi.
**Cons:** Per-phone CA install (annoying once, prohibitive for 5+ devices); no cellular; trusting your laptop's CA is something users should refuse from real apps.

### 7. Browser flag override (DESKTOP CHROME ONLY — for completeness)

Chrome desktop has a flag: `--unsafely-treat-insecure-origin-as-secure=http://192.168.1.101:5173`. Launching Chrome with this argument forces the listed origin to be treated as secure.

**Why it's listed for completeness only:** the flag does not exist on mobile Chrome (Android/iOS). It's only useful if you want to test the camera flow on the laptop's webcam against a LAN URL — not for phone testing.

## What I'd actually do

For now (single dev, MVP, "I want to use my phone"): **option 1 (ngrok)**, set up once, used on demand. The Vite proxy in `apps/web/vite.config.ts` is already configured for it.

When you start sharing builds with anyone else, even informally: **option 4 (hosted Supabase + Vercel)**. Setup time pays for itself the first time someone other than you tries to install it.

## References

- [WICG: Secure Contexts spec](https://w3c.github.io/webappsec-secure-contexts/)
- [MDN: navigator.mediaDevices.getUserMedia — security](https://developer.mozilla.org/docs/Web/API/MediaDevices/getUserMedia#security)
- [Chrome remote debugging port forwarding](https://developer.chrome.com/docs/devtools/remote-debugging/local-server/)
- [ngrok docs — static domains](https://ngrok.com/docs/network-edge/domains-and-tcp-addresses/)
- [Cloudflare Tunnel quick start](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/)

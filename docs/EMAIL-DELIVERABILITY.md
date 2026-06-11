# EMAIL DELIVERABILITY — SPF, DKIM, DMARC

Transactional mail Chippi sends from its **own** domain (follow-up digests,
broker weekly reports, system notifications via Resend) needs DNS
authentication or it lands in spam — or gets rejected outright by Gmail/Yahoo's
bulk-sender rules. This doc is the exact record set and where to verify it.

> **This is a MANUAL DNS action.** These records live in the DNS provider for
> the sending domain (wherever `usechippi.com` DNS is hosted), **not** in this
> repo. No code here can create them, and there is no env var that substitutes
> for them. Someone with DNS access has to add them and confirm propagation.

---

## Two kinds of mail — only ONE needs these records

1. **User-connected Gmail / Outlook sending (no action needed).**
   When a realtor connects their own Gmail/Outlook (via the integrations layer)
   and the agent sends *as that user*, the mail rides the **user's own domain
   and the provider's** SPF/DKIM/DMARC. Google/Microsoft already authenticate
   it. We add nothing — and we *must not* try to, since it isn't our domain.

2. **Transactional mail from the app's own domain (records REQUIRED).**
   Mail the platform sends itself — via **Resend** (`RESEND_API_KEY`,
   `RESEND_FROM_EMAIL`, default sender `notifications@alerts.usechippi.com`) —
   comes from a Chippi-owned domain. That domain needs SPF, DKIM, and DMARC, or
   deliverability suffers and modern inbox providers may reject it.

The records below are for case 2 only.

---

## The records

Assume the sending subdomain is **`alerts.usechippi.com`** (matches the Resend
default `notifications@alerts.usechippi.com`). Adjust the host to whatever
`RESEND_FROM_EMAIL`'s domain actually is.

> **Source of truth for the exact values is the Resend dashboard.** Resend →
> Domains → add/select the sending domain. It generates the precise DKIM
> key, the SPF include, and a Return-Path/MX (for the custom return path).
> Copy those values verbatim — the templates below show the *shape*, but the
> DKIM selector and key are unique to our account and must come from Resend.

### 1. SPF — authorizes Resend to send for the domain

A single TXT record on the sending domain. Merge into an existing SPF record if
one already exists — a domain must have **exactly one** SPF TXT record.

```
Type:  TXT
Host:  alerts.usechippi.com        (or "send.usechippi.com" per Resend)
Value: v=spf1 include:amazonses.com ~all
```

(Resend sends via Amazon SES; it will tell you the exact `include:` to use.)

### 2. DKIM — cryptographically signs the mail

Resend gives you a CNAME (or TXT) DKIM record with an account-specific
selector. Add it exactly as shown in the dashboard.

```
Type:  CNAME (commonly) or TXT
Host:  <selector>._domainkey.alerts.usechippi.com
Value: <unique value from Resend dashboard>
```

> Do **not** invent the selector or key — paste Resend's generated values.

### 3. DMARC — tells inboxes what to do with mail that fails SPF/DKIM

One TXT record at the `_dmarc` host of the organizational domain. Start in
monitor mode (`p=none`) to collect reports without risking legit mail, then
tighten to `quarantine` and finally `reject` once reports are clean.

```
Type:  TXT
Host:  _dmarc.usechippi.com
Value: v=DMARC1; p=none; rua=mailto:dmarc@usechippi.com; fo=1; adkim=s; aspf=s
```

Progression once you've watched reports for a week or two:

```
p=none        →  p=quarantine; pct=100   →  p=reject
```

---

## Verify

1. **Resend dashboard → Domains:** the domain should flip to **Verified** once
   SPF + DKIM propagate (minutes to a few hours depending on the DNS provider's
   TTL).
2. **Command line spot-check:**
   ```
   dig +short TXT alerts.usechippi.com          # SPF present
   dig +short CNAME <selector>._domainkey.alerts.usechippi.com   # DKIM present
   dig +short TXT _dmarc.usechippi.com          # DMARC present
   ```
3. **End-to-end:** send a test transactional mail to a Gmail account, open
   "Show original," and confirm **SPF: PASS**, **DKIM: PASS**, **DMARC: PASS**.
4. **Watch DMARC reports** at the `rua=` mailbox for a couple of weeks before
   tightening `p=none` → `quarantine` → `reject`.

---

## When to revisit

- We change the sending domain or `RESEND_FROM_EMAIL`.
- We switch email providers away from Resend (SPF/DKIM would need to point at
  the new provider).
- DMARC reports show legitimate mail failing — loosen and investigate before
  enforcing `reject`.

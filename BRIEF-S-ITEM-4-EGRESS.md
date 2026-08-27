# BRIEF S, ITEM 4. THE EGRESS DECISION.

Report. Measured 2026-08-27 from this machine. Nothing proposed before the
numbers.

Egress under test: `124.120.193.93`, `ppp-124-120-193-93.revip2.asianet.co.th`,
AS17552 True Online, Bangkok, TH. That is a RESIDENTIAL consumer broadband IP,
which matters and is established in section 3.

---

## 1. WHAT EACH OF THE FOUR ACTUALLY REFUSES

Read the body, not the status code. Every line below is a live probe, not a log
entry.

### Las Vegas, PrimeGov

TCP 443 OPEN in 40ms. Nothing is dropping packets.

    GET https://lasvegas.primegov.com/api/v2/PublicPortal/ListArchivedMeetings?year=2026
    -> HTTP 403, 4,548 bytes, server: cloudflare, cf-ray ...-BKK
    -> <title>Attention Required! | Cloudflare</title>
    -> "This website is using a security service to protect itself from
        online attacks. The action you just performed triggered the security
        solution."

Byte-identical, 4,548 bytes every time, under all three user agents the repo
uses (`philipkwong-agents/1.0`, the compatible-Mozilla scraper string, and a
full Chrome 120 string). Repeat requests answer in 12 to 16ms, which is an
edge-cached decision rather than an evaluation.

No `cf-mitigated` header. No challenge page. No cookie set. Nothing to solve.
This is a Cloudflare WAF block, not a JS challenge and not a rate limit. Same
result on the JSON API and on the HTML portal, so it is not endpoint-specific.

### San Antonio, PrimeGov

It is the same block, not a similar one.

    lasvegas.primegov.com   -> 104.18.14.242, 104.18.15.242
    sanantonio.primegov.com -> 104.18.14.242, 104.18.15.242   identical
    longbeach.primegov.com  -> same 4,548-byte page

Three PrimeGov tenants, one Cloudflare zone, one byte-identical block page. The
policy belongs to PrimeGov the vendor, not to any city. Asking Las Vegas to
allowlist us cannot work, because Las Vegas does not own the rule.

### Anaheim, Granicus

Anaheim is not blocked and never was. The listing answers right now:

    GET https://anaheim.granicus.com/ViewPublisher.php?view_id=2
    -> HTTP 200, 6,951,743 bytes, server: Apache
    -> 53 Council/Planning meetings parsed, 2025+

What fails is two DOCUMENT hosts, and they fail at the packet level:

    local.anaheim.net    74.118.32.68    :80 DROPPED   :443 DROPPED
    records.anaheim.net  74.118.32.119   :80 DROPPED   :443 DROPPED
    www.anaheim.net      104.18.41.204   :443 OPEN in 9ms
    anaheim.granicus.com 69.5.90.4       reachable

DROPPED means eight seconds of silence with no RST. An ACL discarding packets,
not a closed port. Both hosts sit in the city's own 74.118.32.0/24.

### SEMARNAT

The adapter's own header comment is wrong, and it has been wrong for weeks.

It says the hosts are "HTTP-only (no TLS on 443) and unreachable from non-Mexico
egress (connection refused / dropped)". Measured:

    sinat.semarnat.gob.mx  :80  TCP OPEN in 298ms
    sinat.semarnat.gob.mx  :443 TCP OPEN in 306ms

Neither refused, neither dropped. Both accept the handshake. Then:

    :80  GET sent, 59 seconds of total silence, then ECONNRESET, 0 bytes back
    :443 TCP open, but 30 seconds of silence to a TLS ClientHello.
         Port open, no TLS server behind it.

TCP accepted and then never answered, on both ports, is a scrubbing middlebox or
a stateful filter in front of the origin. It is not a refusal and it is not a
country route failure: `www.gob.mx/semarnat` answers HTTP 200 from this same
machine in 3.3 seconds, so Mexico is reachable and this host is not.

---

## 2. ONE EGRESS, OR FOUR PROBLEMS WEARING ONE LABEL

Four problems, three mechanisms, and one of them is not an egress problem.

| Source | Mechanism | Layer |
|---|---|---|
| Las Vegas | Cloudflare WAF block, PrimeGov's rule | application |
| San Antonio | the identical rule, same zone, same IPs | application |
| Anaheim | ACL packet drop on two city-owned hosts | network |
| SEMARNAT | TCP accepted then discarded by a middlebox | network/transport |

Las Vegas and San Antonio are ONE problem. Anaheim and SEMARNAT are separate
per-host filters that happen to reject the same source IP.

### It is IP. It is not header, not session, not a client-side app.

- Not header. Three user agents, byte-identical 4,548-byte responses.
- Not session. No challenge is offered anywhere. There is no cookie to acquire,
  no token to carry, nothing to keep warm.
- Not a client-side app with no server route. Las Vegas's blocked endpoint is a
  plain JSON API that returns 187,447 bytes of parseable JSON the moment it
  answers. Anaheim's is static HTML. SEMARNAT's is a static year index. Every
  one of the four has a real server route and we already know how to read it.

---

## 3. WHICH EGRESS ACTUALLY SATISFIES THEM

Three egresses tested against the same URLs.

| Egress | Las Vegas | Anaheim docs | SEMARNAT |
|---|---|---|---|
| Bangkok residential, AS17552, this machine | 403 | dropped | silent |
| US datacentre, Anthropic fetch | 403 | ECONNREFUSED :443 | ECONNRESET |
| Google Cloud us-west1, AS396982, Oregon | 200 | 200 | 200 |

What came back on the third egress, read rather than assumed:

- Las Vegas: 187,447 bytes of real meeting JSON, with ids, dateTime and
  documentList.
- Anaheim: `local.anaheim.net/docs_agend/questys_pub/50953/Agenda.html`, 38,698
  bytes, the real City Council agenda for 2026-08-25, carrying two Development
  Agreement items and ten public-hearing references.
- SEMARNAT: HTTP 200, title `GACETA ECOLOGICA: PROYECTOS EN EVALUACION DE
  IMPACTO AMBIENTAL`, listing 2026, 2025, 2024 and 2023 as links.

The axis is not country and it is not datacentre-versus-residential. A Thai
residential IP fails. A US datacentre IP fails. A different US datacentre IP
passes all three. What separates them is per-IP and per-ASN reputation, which is
the cheapest kind of blocker to defeat, because a clean IP is nearly free.

Correction to the standing record, which has said the opposite for weeks:
SEMARNAT is NOT geo-blocked to Mexico, and the Mexico-egress requirement written
into `agents/scraper/sources/semarnat.ts` and repeated at GLI-ROADMAP line 283
is not real. The Gaceta index is reachable from Oregon.

---

## 4. THE PRIZE, MEASURED RATHER THAN ESTIMATED

Las Vegas. 59 Council/Planning meetings 2025 to date, every one carrying an
agenda document, currently yielding zero.

    2025   34 meetings   22 City Council   12 Planning Commission
    2026   25 meetings   16 City Council    9 Planning Commission

Anaheim. 53 Council/Planning meetings listed 2025+. Resolving every viewer link
on every one of them, the documents land on four hosts:

    53  records.anaheim.net    unreachable
    30  local.anaheim.net      unreachable
    28  anaheim.granicus.com   reachable
    23  www.anaheim.net        reachable

25 of the 53 have EVERY published document on an unreachable host. 5 more are
mixed. All 25 stranded meetings are City Council; Planning Commission is
unaffected. That is the substantive loss: City Council is where development
agreements are approved, and the single agenda pulled through a working egress
carried two of them.

San Antonio. Flagging a premise the measurement does not support. San Antonio
was retired on FEED DEATH, not on blocking: its Legistar answered HTTP 200 with
a newest matter of 2021-09-24. PrimeGov is a different and live feed for the
same city. So "it would return" is plausible, but it is a market-readmission
question with its own evidence bar, not an egress consequence. Unblocking egress
makes it ASKABLE. It does not answer it.

SEMARNAT. Egress is not what stands between us and Mexico. The index is alive
and reachable. The blocker is that the weekly-Gaceta PDF parser was never built,
deferred behind an egress problem that does not exist. That is now a build
question, and it sits behind Las Vegas and Anaheim in value because those two
are covered markets and Mexico is not.

---

## 5. THE OPTIONS, WITH COSTS

| Option | Cost | Verdict |
|---|---|---|
| US-region GitHub Actions runner | $0 | Test this first. |
| Small US VPS, Hetzner or DO or Fly | $4 to $6/mo | Fallback if the runner is blocked. |
| Fetch-proxy API, Jina reader or Firecrawl | $0 to ~$20/mo | Works today. Third-party on the capture path. |
| Residential proxy | $50 to $500/mo | Not indicated. Do not buy. |
| Session-aware fetch, headless browser | build time | Not indicated. |

The last two are ruled out by measurement rather than by preference. A
residential proxy cannot be the answer to a block that a residential IP already
fails and a datacentre IP passes. A session-aware fetch cannot be the answer
where no session is ever offered.

GitHub Actions is not a guess here. This repo ALREADY runs one:
`.github/workflows/manual-portal-check.yml`, `ubuntu-latest`, on a Thursday
cron, with checkout. The host is proven; only its egress against these four
hosts is untested.

The honest gap in this report. The working egress is Google Cloud. GitHub hosted
runners are Azure. Both are clean cloud IPs with no abuse history, which is the
property that appears to matter, but they are not the same ASN and Azure has not
been measured. That test is free and takes about ten minutes.

---

## 6. RECOMMENDATION

Spend nothing yet. Run the decisive free test first.

1. Add a `workflow_dispatch` diagnostic workflow that probes all four hosts from
   `ubuntu-latest` and prints status, byte count and body head for each.
2. Dispatch it. Read the four results.
3. If it passes, item 4 is closed for $0 by item 5's host, which is exactly the
   outcome the brief hoped for, and the two adapters need no code change beyond
   deleting a wrong comment.
4. If it fails, a $5/mo US VPS is the next step, and the residential proxy is
   still never the answer.

The decision this unblocks is therefore NOT "which proxy do we buy". It is
"capture moves to a hosted US runner", which item 5 requires anyway.

---

## 7. FOUND, NOT ASKED FOR

1. `agents/scraper/sources/semarnat.ts` states a geo-block that does not exist,
   and GLI-ROADMAP line 283 repeats it. A described blocker stood in for a
   measured one and gated a build for weeks. Same family as standing rule 11.
2. The Anaheim loss is not "Anaheim". It is Anaheim CITY COUNCIL specifically,
   and the Planning Commission half has been arriving the whole time. A
   market-level label hid a body-level gap, which is standing rule 8's shape: a
   label read as the thing it names.
3. `local.anaheim.net` is a host named `local` that the city publishes publicly
   as its primary agenda link. It is reachable from a clean egress, so this is
   not misconfiguration on their side, but it is a fragile dependency worth its
   own staleness probe.
4. San Antonio's PrimeGov feed is live while the Legistar feed it was retired on
   is dead. Whatever `verify:staleness` probes, it did not notice that a retired
   market has a second and healthier feed.

---

## 8. THE ANSWER. MEASURED ON THE RUNNER, 2026-08-27.

`.github/workflows/egress-probe.yml`, run 33055499319, `ubuntu-latest`,
completed success. Runner egress: `68.220.61.195`, San Jose, California,
**AS8075 Microsoft Corporation**. Azure, which is the combination section 5
named as the honest gap.

Every port that dropped our packets from Bangkok answers:

    lasvegas.primegov.com:443     OPEN        local.anaheim.net:80/443     OPEN
    sanantonio.primegov.com:443   OPEN        records.anaheim.net:80/443   OPEN
    sinat.semarnat.gob.mx:80/443  OPEN

And every body is real, read rather than inferred from a status code:

| Probe | Status | Bytes | What came back |
|---|---|---|---|
| Las Vegas PrimeGov | 200 | 187,325 | real meeting JSON |
| San Antonio PrimeGov | 200 | 644,733 | real meeting JSON |
| `local.anaheim.net` City Council agenda | 200 | 232,143 | the real agenda |
| `records.anaheim.net` | 302 | 181 | redirect to `CookieCheck.aspx` |
| SEMARNAT Gaceta index | 200 | 3,602 | `GACETA ECOLOGICA` index |
| CONTROL, Anaheim Granicus | 200 | 6,951,774 | agrees with Bangkok |

**ITEM 4 IS CLOSED, AND IT COST NOTHING.** The recommendation in section 6 holds
exactly: no proxy, no VPS, no residential egress, no session work. Capture moves
to the hosted US runner that item 5 needs anyway, and all four sources come with
it.

`records.anaheim.net` is the one nuance and it is not an egress one. A 302 to
`CookieCheck.aspx` is a session handshake, so that host needs a cookie jar on
the fetch. That is an implementation detail worth naming so it is not later
rediscovered as a block.

### What the runner does NOT unlock, which is worth as much as what it does

The two permit portals in the market scorecard, `permits.anaheim.net` and
`citizenaccess.clarkcountynv.gov`, still do not answer. Both time out waiting for
network idle from a clean egress, because both are CLIENT-SIDE JAVASCRIPT
APPLICATIONS with no plain server route. `permits.anaheim.net` resolves to
74.118.32.62, inside the same `/24` as the two Anaheim hosts that now answer, so
its IP is demonstrably reachable and the block is the application's shape rather
than the network.

**So layer 8, building permits, is blocked by architecture and not by egress, in
both markets tested.** The egress decision does not touch it, and no amount of
proxy money would have. That is the fourth category the brief asked about, "a
client-side app with no server route", and it is the only one of the four that
turned out to be real.

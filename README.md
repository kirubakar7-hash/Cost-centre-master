# SolidPro Cost Centre Portal

Internal web portal for **Solidpro Engineering Support Pvt Ltd**. It is the single source of truth
for cost centres. Employees use it to find the right cost centre code in seconds. Finance uses it
to maintain the cost centre master and its owners under audit, and to publish budget, actuals and
allocations that reconcile to each legal entity's trial balance. Cost centre owners, BU heads and
Management see budget against actuals for the cost centres they are responsible for, and owners explain
their variances.

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Auth.js v5 with Microsoft Entra ID ·
Postgres with row-level security (Supabase in production, embedded PGlite for local demos) ·
Recharts · to be deployed on Vercel at `https://costcentre.solidpro-engineering.com`.

**Status: Phase 3.** Phase 1 delivered Microsoft sign-in, the Cost Centre Finder, and Admin
uploads of the cost centre master and owner mapping. Phase 2 added **My Cost Centres** (budget
against actuals, variances, Excel export), the **Budget & Actuals upload** with trial-balance
reconciliation, and **maker-checker** approval of every upload. Phase 3 adds **reconciliation per legal
entity** (India and the US close their months independently, each in its own currency), a line-level
**history of every financial figure** a publish changes, the **Allocations upload** and an *Allocations
received* panel, **variance explanations** by owners, and Finance **Reports** (audit log, upload evidence
register, user access review, variance commentary coverage, failed searches) with audited Excel exports.
All three phases are code-complete. Production deployment, Entra ID configuration and the decision on
FX-converted consolidation remain ([§13](#13-roadmap)).

---

## Contents

1. [Business problem](#1-business-problem)
2. [Roles](#2-roles)
3. [Architecture](#3-architecture)
4. [Security model](#4-security-model)
5. [Quick start (local demo)](#5-quick-start-local-demo)
6. [Environment variables](#6-environment-variables)
7. [Microsoft Entra ID SSO](#7-microsoft-entra-id-sso)
8. [Supabase setup](#8-supabase-setup)
9. [Deploy to Vercel](#9-deploy-to-vercel)
10. [Granting roles](#10-granting-roles)
11. [Testing](#11-testing)
12. [Acceptance criteria](#12-acceptance-criteria)
13. [Roadmap](#13-roadmap)
14. [Known limitations and next steps](#14-known-limitations-and-next-steps)

Finance users should read the [Finance Admin Guide](docs/ADMIN_GUIDE.md), which covers the monthly SOP
(the Budget & Actuals close for each entity, allocations and variance commentary), upload rules,
trial-balance reconciliation, maker-checker, the reports, the quarterly user access review and every error code.

---

## 1. Business problem

Cost centre codes currently live in spreadsheets that Finance maintains. Employees who raise expense
claims, purchase requests and invoices guess the code or email Finance to ask. Mis-coded costs then
need reclassification journals at month-end. Owners are not recorded consistently, and no one can
easily see who changed a code and when.

The portal fixes this:

- **Finder.** Any employee can search by name, code, BU, department, owner or keyword, in any order and
  with partial words, and copy the code with one click. If nothing matches, the portal shows the
  Finance contact and logs the search so that Finance can add keywords.
- **Controlled master data.** Finance changes the master only through validated Excel/CSV uploads.
  An upload is all-or-nothing, is checked again when it is published, and every change is audited.
  Cost centres are never deleted; they are deactivated instead.
- **Ownership.** Every active cost centre has an owner and a backup owner. The owner mapping also
  controls who can see a cost centre's budget and actuals, and who can explain its variances.
- **Budget against actuals.** *My Cost Centres* shows owners, BU heads and Management the month,
  year-to-date and full-year figures for their cost centres, broken down by GL group and month, with
  variances over ±10% flagged and an Excel export.
- **Reconciled, approved financials.** Finance loads budget and actuals from Tally through the same
  validated uploads. Each legal entity keeps its own books, so a month's actuals cannot be published until
  each entity's cost centre totals equal **that entity's** trial balance, and a second Finance user must
  approve every upload. India and the US can close the same month on different days.
- **Variance explanations.** Owners, backup owners and BU heads explain lines that run more than ±10% over
  or under budget. Finance monitors the coverage before the month is signed off.
- **Allocations.** Finance loads shared-service recharges (IT, rent and so on); each receiving cost centre
  shows them for information.
- **Audit evidence.** Finance has filterable reports with Excel export for the audit log, the evidence of
  every upload, a periodic user access review and variance commentary coverage.

**How the figures are calculated** (`src/lib/fiscal.ts`, `src/lib/financials.ts`, `src/lib/currency.ts`):

- The fiscal year starts in April (`FY_START_MONTH=4`): FY 2026-27 is April 2026 to March 2027.
- **Variance = Actual − Budget**, so a **positive variance is an overspend**. Variance % is variance ÷ |budget|.
- A line is **flagged** when the variance is more than ±10% of budget, or when there is an actual against a zero budget.
  Cost centres, BUs and GL groups are flagged on their year-to-date figures; the month card and the monthly trend
  on that month's figures.
- **YTD** runs from the first month of the fiscal year to the *As of* month. The *As of* selector lists the months
  in which the user can see published actuals, latest first.
- **Full-year outturn = YTD actual + budget for the remaining months of the fiscal year.**
- **Currencies.** Amounts are stored and shown in each entity's own currency: `IN` in INR, `US` in USD, `UK` in GBP.
  They carry no currency symbol; each block says which currency it is in. INR uses Indian digit grouping
  (12,34,567), USD and GBP Western grouping. **Amounts in different currencies are never added together**:
  My Cost Centres shows one KPI row and one total per currency. Converting to one reporting currency is an
  open decision ([§13](#13-roadmap)).
- **Allocations received** are shown for information only. They are not added to a cost centre's actuals.

## 2. Roles

Roles are **read from the database on every request**. The session cookie only says who the user is.
Removing a grant or changing an owner therefore takes effect immediately.

| Role | How a user gets it | Phase 1 (delivered) | Phase 2 (delivered) | Phase 3 (delivered) |
|---|---|---|---|---|
| **Employee** | Any account on an allowed domain that can sign in | Finder: search active cost centres; see code, alias, BU, department, owner name and entity; copy the code; "Contact Finance" when nothing matches. **No financial data.** | No change: no *My Cost Centres* menu and **no financial data** | No change: no explanations, no allocations, no reports |
| **CC Owner / Backup** | Named as `Owner_Email` or `Backup_Owner_Email` in the owner mapping upload | Finder | **My Cost Centres** for their own cost centres only: month, YTD and full-year budget, actual and variance, outturn, GL-group breakdown and monthly trend, ±10% flags, **Export to Excel** | **Variance explanations**: explain any GL line of their cost centres that has published actuals; flagged lines without an explanation are marked *Explanation needed*. **Allocations received** panel (memo only). The export adds *Variance explanations* and *Allocations* sheets |
| **BU Head** | A `BU_Head` grant for a BU in `ccp.cc_access` (sees the whole BU), or named as `BU_Head_Email` in the owner mapping (sees those cost centres) | Finder | **My Cost Centres** for every cost centre in their BU (or those naming them), with a by-BU summary | Explain variances and see allocations for the same cost centres |
| **Finance Admin** | A `Finance` grant in `ccp.cc_access` | Finder and **Admin**: template download; upload, validate, publish and discard of the master and owner mapping; data-quality exceptions; recent uploads; audit log; failed-searches report. **The only role that can write master data.** | **Budget & Actuals upload** with trial-balance reconciliation; **maker-checker** on every upload (the preparer uploads and enters the trial balance, a *different* Finance user approves and publishes); *Awaiting approval* queue; *Published periods* register; My Cost Centres for every cost centre | Trial balance **per legal entity**, so entities close independently; **Allocations upload** (maker-checker); may explain variances on any cost centre; **Reports**: audit log, upload evidence register, user access review, variance commentary coverage and failed searches, each with an audited Excel export |
| **Management / CFO** | An `Mgmt` grant in `ccp.cc_access` | Finder (read access to all cost centres is already enforced in the database) | **My Cost Centres**: company-wide, read-only, consolidated totals and a by-BU table | Consolidated totals **per currency**; reads every explanation and allocation; **cannot add explanations**; no Reports (Finance only) |

Management cannot see the Admin area or the Reports. The audit log, trial-balance entries, financial line
history and every report are visible to Finance only; the published-periods register (`ccp.periods`) to
Finance and Management. A user can hold several roles; the menu shows *My Cost Centres* to everyone except
plain employees, and *Admin* and *Reports* to Finance.

## 3. Architecture

```mermaid
flowchart LR
  B["Browser<br/>(desktop / mobile)"] -->|HTTPS| PX
  B <-->|"OIDC sign-in<br/>(authorization code)"| ENTRA["Microsoft Entra ID<br/>SolidPro tenant"]
  subgraph VERCEL["Vercel · Next.js 16"]
    PX["src/proxy.ts<br/>require session · roll 30-min cookie<br/>nonce CSP · security headers"] --> APP["App Router<br/>pages + route handlers"]
    APP --> SES["lib/session.ts<br/>roles = ccp.my_roles() per request"]
    APP --> SVC["lib/search · financials · comments · allocations · reports<br/>lib/upload/*: parse → validate → stage →<br/>reconcile per entity → approve"]
    SES --> DB1["lib/db withUser()<br/>BEGIN · SET LOCAL ROLE cc_app ·<br/>set_config('app.user_email')"]
    SVC --> DB1
  end
  DB1 -->|"TLS · pooled (pg)"| PG[("Postgres / Supabase<br/>schema ccp<br/>RLS policies · audit triggers")]
```

| Path | What it is |
|---|---|
| `src/proxy.ts` | Runs before every request. Unauthenticated page requests are redirected to `/login` and API requests get `401`. Also sets the CSP nonce. |
| `src/lib/auth.config.ts`, `src/lib/auth.ts` | Auth.js configuration: Entra ID provider, tenant and domain checks, session lifetimes, login audit events |
| `src/lib/session.ts` | Current user and roles (from the database), `requireFinanceApi()` |
| `src/lib/db/core.ts` | `pg` / PGlite drivers, migrations, `withUser()` request scope |
| `src/lib/search.ts` | Finder query: multi-word, partial, any order, active cost centres only |
| `src/lib/financials.ts` | My Cost Centres read model: month, YTD, full-year budget and outturn, GL breakdown, monthly trend, BU consolidation. Every query runs under RLS, so it never filters by user itself. |
| `src/lib/fiscal.ts`, `src/lib/currency.ts` | Fiscal year (`FY_START_MONTH`), variance and ±10% flag rules; entity → currency and number format |
| `src/lib/comments.ts`, `src/lib/allocations.ts` | Variance explanations (list, who may add, add); *Allocations received* (month and fiscal YTD per source cost centre) |
| `src/lib/reports.ts` | Finance reports: filter parsing and whitelisting, audit log, upload evidence register and batch detail, user access review and its exceptions, variance commentary coverage, failed searches |
| `src/lib/upload/` | Templates (ExcelJS), parser, validation rules (`validate.ts`, `validate-financials.ts`, `validate-allocations.ts`), and the stage → trial balance → approve/publish/discard service (`service.ts`) |
| `src/app/(portal)/` | Finder (`/`), My Cost Centres (`/my`, `/my/[code]`), Admin (`/admin`), Reports (`/admin/reports` and one page per report; the old `/admin/audit` redirects there) |
| `src/app/api/` | `search`, `cc/[code]/export`, `cc/[code]/comments`, `admin/templates/[kind]`, `admin/upload`, `admin/upload/[id]` (reconcile, publish, discard), `admin/reports/[report]` (Excel exports), `auth/[...nextauth]` |
| `src/components/` | `UploadPanel.tsx` (preparer), `admin/` (approval queue, reconciliation and allocation-run tables), `cc/` and `charts/` (My Cost Centres, explanation form and markers), `reports/` |
| `db/migrations/` | `001_schema.sql` (tables), `002_security.sql` (role, RLS, triggers, audit), `003_financials.sql` (trial balances, period register, maker-checker evidence), `004_segregation_of_duties.sql` (database-level maker-checker), `005_phase3.sql` (per-entity reconciliation, line history, allocations upload, register audit), `006_comments.sql` (variance explanations) |
| `scripts/` | `db.ts` (migrate, seed, reset), `build-templates.ts` |

**Data model** (schema `ccp`):

- `cost_centres` is the master. It is never deleted. Its `entity` (`IN`, `US`, `UK`) sets the currency of its figures.
- `cc_owners` holds one owner mapping per cost centre.
- `cc_access` holds explicit grants: Finance, Mgmt, BU_Head, and per-cost-centre grants.
- `financials` holds the budget and actual for each cost centre, month (`YYYY-MM`) and GL group, in the entity's
  currency. A null `actual` means a budget-only month (no actual yet), not zero.
- `financials_history` holds every financial line a publish added, changed or removed: old and new budget and
  actual, the batch, who and when. It is append-only and readable by Finance only. Lines published before
  Phase 3 have no history.
- `trial_balances` holds the trial-balance total that the preparer entered for each **month and entity** of a
  financials upload, with who entered it and when.
- `periods` is the register of published actuals, one row per **month and entity**: CC actuals total, TB total,
  batch, who published it and when. Rows published before Phase 3 were reconciled on a combined total and keep
  entity `ALL` until that month is published again. Every change to the register is audited.
- `allocations` holds shared-service recharges: one line per receiving cost centre, month and source cost centre,
  with the amount and its basis. A cost centre cannot allocate to itself. Loaded by the Allocations upload and
  audited row by row.
- `comments` holds variance explanations for a cost centre, month and GL group. They are append-only, and each
  one is also written to the audit log.
- `audit_log` is append-only.
- `failed_searches` holds searches that found nothing.
- `upload_batches` holds uploads being staged and the upload evidence (type `master`, `owners`, `financials` or
  `allocations`), including `approved_by`.

## 4. Security model

Security is layered, so no single control has to be perfect:

```
 Entra ID SSO ──► tenant + domain check ──► proxy (session, headers) ──► server-side role check ──► Postgres RLS
 (who you are)    (are you SolidPro?)        (signed in? fresh?)          (Finance for admin)       (what rows you get)
```

| Layer | Control | Where |
|---|---|---|
| **Identity** | Microsoft Entra ID OIDC only. There are no local passwords and no self-registration. The issuer is pinned to the SolidPro tenant (`/{tenant-id}/v2.0`). | `auth.config.ts` |
| | The token's `tid` claim must equal `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID`. This blocks the "nOAuth" attack, where a user from another tenant sets an `email` claim on our domain. | `signIn` callback |
| | The email (`email`, or `preferred_username` if there is no email) must be on `ALLOWED_EMAIL_DOMAINS`. It is checked at sign-in **and on every session refresh**. | `signIn` and `jwt` callbacks |
| | Recommended: turn on **Assignment required** on the Entra Enterprise App, so that only members of a chosen security group can sign in. | Entra admin centre |
| **Session** | Encrypted JWT cookie (Auth.js: HttpOnly, SameSite=Lax, Secure on HTTPS) with a **30-minute rolling idle timeout**. `maxAge` is 1800 s and the proxy re-issues the cookie on each request. There is also a **10-hour absolute limit** and a client-side idle timer that signs the user out after 30 minutes without input. | `config.ts`, `proxy.ts`, `IdleTimeout.tsx` |
| **Edge** | The proxy requires a session on every path except `/login` and `/api/auth/*`. It sets a nonce-based CSP with `strict-dynamic` and `frame-ancestors 'none'`. `next.config.ts` adds HSTS (2 years, preload), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` and `Permissions-Policy`, and removes `X-Powered-By`. Pages are marked `noindex`. | `proxy.ts`, `next.config.ts` |
| **Server** | Roles come from `ccp.my_roles()` on every request and are never cached in the cookie. Admin and report pages redirect non-Finance users. Admin and report APIs return `403` and log `ACCESS_DENIED`. A cost centre page (`/my/[code]`) or export that the user may not see returns **the same 404 as a code that does not exist**, so it never confirms that another cost centre exists, and logs `ACCESS_DENIED`. Uploads are checked for type (`.xlsx`/`.csv`), size (5 MB) and row count (5,000; 60,000 for Budget & Actuals). IDs are checked to be UUIDs. Search, template and export responses are `Cache-Control: private, no-store`. | `session.ts`, `app/api/**`, `my/[code]/page.tsx`, `components/reports/guard.ts` |
| **Database** | Each request runs in a transaction as `cc_app`, a role with no `BYPASSRLS`, no `DELETE` on cost centres and no direct write access to the audit log, using `set_config('app.user_email', …)`. **RLS policies decide which rows each user gets** from `cc_access` and `cc_owners`, so a bug or a tampered request in the app cannot widen access. Schema `ccp` is not exposed through Supabase's REST API (the `anon` and `authenticated` roles are revoked). | `002_security.sql`, `db/core.ts` |
| **Integrity** | Triggers block deletion of cost centres. Deactivating a cost centre removes its owner mapping, and that removal is audited. Every insert, update and delete on `cost_centres`, `cc_owners`, `cc_access`, `allocations` and the period register `periods` is written to `audit_log` with who, when, old and new values (only the changed fields) and the upload batch id. Every financial line a publish adds, changes or removes is written to `financials_history` with its old and new values, and the publish also writes one `UPLOAD_PUBLISHED` event with each month's and entity's totals before and after. `audit_log`, `financials_history` and `comments` reject `UPDATE`, `DELETE` and `TRUNCATE`, even from the privileged migration connection. | `002_security.sql`, `005_phase3.sql`, `006_comments.sql` |
| **Reconciliation** | Each entity is reconciled to its own trial balance in its own currency: for every month and entity with actuals, the cost centre actuals in the file must equal the TB total the preparer entered for that entity, within `RECON_TOLERANCE` (default 0). Publishing reconciles again in the same transaction. A financials upload replaces only the month-and-entity pairs it contains and must cover every cost centre of that entity that already has figures in the month (`INCOMPLETE_PERIOD`). An older upload cannot overwrite a month and entity, or an allocation run, that was published after it was prepared. RLS lets Finance insert and update register rows but delete only legacy `ALL` rows. | `upload/service.ts`, `upload/validate-financials.ts`, `005_phase3.sql` |
| **Maker-checker** | `publishUpload` refuses an upload whose uploader is the signed-in user, and only the uploader can enter the trial balance (`UPLOAD_MAKER_CHECKER`, on by default). This applies to all four upload types. `uploaded_by` is taken from the database identity, not from the request. Publishing re-validates the file and, for financials, re-reconciles every month and entity to the trial balance in the same transaction. RLS lets only Finance write `trial_balances`, and only with `entered_by` = the signed-in user. **The database enforces the same rules** (defence in depth): a trigger refuses to mark a batch Published when `published_by = uploaded_by`, a trigger refuses a trial balance from anyone but the uploader, and RLS refuses an upload recorded under another user's name. | `upload/service.ts`, `003_financials.sql`, `004_segregation_of_duties.sql` |
| **Variance explanations** | `ccp.can_comment()` allows Finance and the cost centre's owner, backup owner and BU head (from the owner mapping, a per-cost-centre grant or a BU-wide `BU_Head` grant). The Management role alone does not allow it, and employees cannot. RLS accepts an explanation only under the signed-in user's own email and only on a GL line with published actuals. Explanations are append-only (a trigger rejects edits and deletions, even by the table owner) and each one writes a `COMMENT` audit row. The comment API accepts only JSON, refuses cross-site requests (a foreign or opaque `Origin`, or `Sec-Fetch-Site: cross-site`/`same-site`) and logs refused attempts as `ACCESS_DENIED`. | `006_comments.sql`, `lib/comments.ts`, `api/cc/[code]/comments`, `api/cc/_lib/origin.ts` |
| **Reports** | Finance only. Every query runs under RLS, and the tables behind the reports (audit log, uploads, trial balances, line history, failed searches, other users' grants) are Finance-only in the database. Filters are validated, checked against the values present in the database and passed only as bind parameters. Each export is read and logged as `EXPORT` (entity `report`, with the filters and the row count) in the same transaction, so there is no export without an audit record. An export holds at most 50,000 rows per sheet and says when it was cut off. | `lib/reports.ts`, `app/(portal)/admin/reports/**`, `api/admin/reports/**` |
| **Events** | `LOGIN`, `LOGIN_DENIED`, `LOGOUT` (sign-out or idle), `ACCESS_DENIED`, `TEMPLATE_DOWNLOAD`, `UPLOAD_VALIDATED`, `UPLOAD_REJECTED`, `UPLOAD_PUBLISHED`, `UPLOAD_DISCARDED`, `TB_ENTERED`, `RECON_PASSED`, `RECON_FAILED` and `EXPORT` (cost centre or report) are logged through `ccp.log_event()`, which accepts only a fixed list of actions and always records the caller's identity. `COMMENT` is written by a trigger on `comments`. `VIEW_FINANCIALS` is also on the list but is not written yet. | `auth.ts`, `logout/route.ts`, `upload/service.ts`, `my/[code]/page.tsx`, `api/cc/**`, `api/admin/reports/**`, `006_comments.sql` |

**Excel library.** The portal uses **ExcelJS**, not SheetJS. The npm `xlsx` package (0.18.5) has
unpatched vulnerabilities: prototype pollution (CVE-2023-30533) and ReDoS (CVE-2024-22363). The
patched SheetJS builds are distributed only from `cdn.sheetjs.com`, not from the npm registry.
Uploaded files are parsed on the server only.

## 5. Quick start (local demo)

You need Node.js 20 or later. No database or Microsoft setup is required.

```bash
npm install
cp .env.example .env.local
#   edit .env.local:
#     AUTH_SECRET=<output of: npx auth secret   or   openssl rand -base64 32>
#     AUTH_DEMO_MODE=true
npm run dev
```

Open <http://localhost:3000>. When `DATABASE_URL` is not set, the first request creates an embedded
Postgres (PGlite) database in `./.pglite`, runs the migrations and loads demo data. The demo data has
10 active cost centres in two entities (India in INR, the US in USD), 1 inactive cost centre (`IN-ENG-199`)
and FY 2026-27 financials for 6 GL groups: **published actuals for April to September 2026** (in the
*Published periods* register, one reconciled row per month and entity) and **budget only for October 2026 to
March 2027**. Some lines run deliberately more than 10% over or under budget. Two shared-service cost centres
recharge IT (`IN-SSV-302`) and office costs (`US-SSV-401`) for April to September 2026. The login page then offers **demo users**:

| Demo user | Role | What to try |
|---|---|---|
| `arun.kumar@solidpro-es.com` | Employee | Search `chen des`, `laptop` or `ineng101`; search something that does not exist. No *My Cost Centres* menu |
| `meena.raj@solidpro-es.com` | CC Owner (`IN-ENG-101`, `IN-ENG-102`) | **My Cost Centres**: her two cost centres. Open `IN-ENG-101`: *Travel & Conveyance* and *Software & Licences* are flagged and marked *Explanation needed*; add an explanation. *Allocations received* shows the IT recharge. Change **As of**, **Export to Excel**. Open `/my/IN-SAL-501`: 404 |
| `vikram.iyer@solidpro-es.com` | BU Head, Engineering | **My Cost Centres**: every Engineering cost centre with figures this year, with one INR and one USD block; `US-ENG-201` is flagged. He can explain variances for all of them. (Inactive `IN-ENG-199` has no FY 2026-27 figures, so it is not listed.) |
| `kavya.s@solidpro-es.com` | Finance Admin (**preparer**) | **Admin**: download a template, upload it, read the errors, enter the trial balance. **Reports**: all five. She cannot publish her own uploads |
| `deepa.m@solidpro-es.com` | Finance Approver (**checker**) | **Admin → 3. Awaiting approval**: review and **Approve & publish** Kavya's uploads |
| `rajesh.n@solidpro-es.com` | Management / CFO | **My Cost Centres**: company-wide totals per currency and the by-BU table; reads explanations but cannot add one; no Admin or Reports |

**Try per-entity reconciliation and maker-checker**

1. Sign in as **Kavya**. Download the **Budget & Actuals** template and, on its `Financials` sheet, enter
   the US entity's October 2026, one row for each US cost centre:
   `US-ENG-201, 2026-10, Employee Costs, 54000, 61500`,
   `US-SSV-401, 2026-10, Rent & Facilities, 15600, 15600` and
   `US-SAL-601, 2026-10, Employee Costs, 54000, 52300`.
2. Under **2. Upload & validate**, choose **Budget & Actuals**, select the file and click **Validate**. The
   period table shows one row, **2026-10 · US · USD**, with CC actuals of 129,400.
3. Enter `129000` as the trial-balance total and click **Reconcile to TB**: it shows a difference of 400 and
   *Does not match*. Enter `129400` and reconcile again: **✓ Reconciled**.
4. Under **3. Awaiting approval**, *Approve & publish* is disabled for Kavya (segregation of duties).
5. Sign out, sign in as **Deepa**, and click **Approve & publish**. **Published periods** now lists
   *2026-10 · US* and **Recent uploads** shows Deepa under *Approved by*. India has not closed October, and its
   figures are untouched. In **Reports → Upload evidence register**, open the batch: the trial-balance entry,
   `TB_ENTERED`, `RECON_FAILED`, `RECON_PASSED` and `UPLOAD_PUBLISHED`, and the financial line changes.

The upload replaces the whole of the US entity's October 2026, so the other 15 US budget lines for October
are removed. Users who see both entities (Finance, Management, Vikram) now get October 2026 as the default
*As of* month, where India has no actuals yet; choose September 2026 to compare like with like ([§14](#14-known-limitations-and-next-steps)).

**Try variance explanations, allocations and the reports**

1. As **Meena**, open `IN-ENG-101` for September 2026 and add an explanation for *Travel & Conveyance*. It shows
   with her name and time and cannot be edited. As **Rajesh**, the same page is read only.
2. As **Kavya**, open **Reports → Variance commentary coverage**, choose September 2026: 1 of 8 flagged lines is
   explained. **User access review** lists 3 exceptions (Kavya and Deepa are Finance users who also own or back up
   shared-service cost centres; Nisha R is both backup owner and BU head of `IN-SAL-501`). **Audit log** shows the
   `COMMENT`; every export you make appears there as `EXPORT`.
3. As **Kavya**, upload an **Allocations** file with `IN-ENG-101, 2026-09, IN-SSV-302, 150000, Headcount (44 of 120)`
   and `IN-ENG-102, 2026-09, IN-SSV-302, 60000, Headcount (18 of 120)`. It validates as one run (source `IN-SSV-302`,
   2 receiving cost centres, 210,000). Once **Deepa** publishes it, it replaces the whole September IT run, so
   `IN-ENG-103` and `IN-SAL-501` no longer receive one for that month. Add a row with source `US-SSV-401` and
   the whole file is rejected (`CROSS_ENTITY`).

To start again with fresh demo data, stop the dev server, then delete `./.pglite` (or run `npm run db:reset`).
Do this once if your `./.pglite` was created before Phase 3: the migrations add the new tables to an existing
database, but the demo data is loaded only into an empty one, so an older database keeps its earlier US figures
and its combined (*All (pre-Phase 3)*) register rows.
To build the Excel templates into `./templates/`, run `npm run templates`.

To try **real Microsoft sign-in** locally, set the three `AUTH_MICROSOFT_ENTRA_ID_*` variables
([§7](#7-microsoft-entra-id-sso)) and register `http://localhost:3000/api/auth/callback/microsoft-entra-id`.

## 6. Environment variables

Every variable is described in [`.env.example`](.env.example). Phase 3 adds none.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `AUTH_SECRET` | **Yes** | — | Encrypts the session cookie. Generate it with `npx auth secret` or `openssl rand -base64 32`. Use a different value for each environment. |
| `AUTH_URL` | Production | auto-detected | Public URL, e.g. `https://costcentre.solidpro-engineering.com`. On Vercel, set it for **Production only**. The comment API also accepts this host as same-origin. |
| `AUTH_MICROSOFT_ENTRA_ID_ID` | For SSO | — | Application (client) ID |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | For SSO | — | Client secret **value** |
| `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID` | For SSO (**always set**) | — | Directory (tenant) ID. Pins the issuer and turns on the `tid` check. Required: without it Microsoft sign-in is disabled (fail closed). |
| `ALLOWED_EMAIL_DOMAINS` | No | `solidpro-es.com` | Comma-separated list of domains allowed to sign in. Owner, backup and BU-head emails in uploads must also use these domains. The user access review flags any grant outside them. |
| `FINANCE_CONTACT_EMAIL` | No | `finance@solidpro-es.com` | Shown when a search finds nothing |
| `AUTH_DEMO_MODE` | No | `false` | `true` shows the demo-user picker with no password. It only works with the embedded PGlite demo database: it is ignored whenever `DATABASE_URL` is set and when `VERCEL_ENV=production`. |
| `DATABASE_URL` | Production | — (PGlite) | Postgres connection string. For Supabase, use the pooler string. **Do not add `?sslmode=`**, because it overrides the two SSL variables below. |
| `DATABASE_POOL_MAX` | No | `5` | Connection pool size for each server instance |
| `DATABASE_SSL` | No | on | Set to `false` to turn off TLS for a local Postgres. `sslmode=disable` in the URL does the same. |
| `DATABASE_SSL_STRICT` | No | `true` | Set to `false` to skip verification of the server certificate. The connection is still encrypted. See [§8](#8-supabase-setup). |
| `PGLITE_DATA_DIR` | No | `./.pglite` | Folder for the embedded database when `DATABASE_URL` is not set. `memory` keeps it in memory only. |
| `ALLOW_EMBEDDED_DB` | No | — | `true` allows PGlite when `NODE_ENV=production`, e.g. for an `npm run build && npm start` demo. Never use it for a real deployment. |
| `UPLOAD_MAKER_CHECKER` | No | on | Maker-checker on every upload: the uploader cannot publish their own upload, and only the uploader can enter the trial balance. Only the exact value `false` turns it off, for a single-user demo or test. **Never turn it off in Production.** |
| `RECON_TOLERANCE` | No | `0` | Largest allowed difference between the cost centre actuals of one month and entity and that entity's trial-balance total, in the entity's own currency (so `1` means ₹1 for India and $1 for the US). The default `0` means they must be equal to the paisa or cent. Negative or non-numeric values are treated as `0`. |
| `FY_START_MONTH` | No | `4` | First month of the fiscal year (1–12). `4` = April, so FY 2026-27 runs April 2026 to March 2027. Drives YTD, full-year budget and outturn. Read at start-up and not validated, so set only a whole number from 1 to 12. |
| `NEXT_DIST_DIR` | No | `.next` | Alternate Next.js build folder, so that two builds can run side by side on one machine. Do not set it on Vercel. |
| `CONFIRM_RESET` | Scripts | — | `yes` is required before `npm run db:reset` will drop a **remote** database |

> The `npm run db:*` scripts **do not read `.env.local`**. Export the variables in your shell, or run
> `npx tsx --env-file=.env.local scripts/db.ts migrate`. If you do neither, the scripts quietly work
> on the local PGlite database instead.

## 7. Microsoft Entra ID SSO

Do these steps in the **Microsoft Entra admin centre** (entra.microsoft.com). You need the
Application Administrator role or higher.

1. **Register the app.** Go to *App registrations → New registration* (under *Entra ID*, or *Identity → Applications* in older menus).
   - Name: `SolidPro Cost Centre Portal`
   - Supported account types: **Accounts in this organizational directory only (single tenant)**
   - Redirect URI: platform **Web**, `https://costcentre.solidpro-engineering.com/api/auth/callback/microsoft-entra-id`
2. **Add the development redirect.** Go to *Authentication → Web → Add URI*:
   `http://localhost:3000/api/auth/callback/microsoft-entra-id`. Add a URI for a staging host here too
   if you use one. Leave both *Implicit grant* boxes **unticked**, because the portal uses the
   authorization-code flow.
3. **Copy the IDs.** On *Overview*:
   - **Application (client) ID** → `AUTH_MICROSOFT_ENTRA_ID_ID`
   - **Directory (tenant) ID** → `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID`
4. **Create a secret.** Go to *Certificates & secrets → Client secrets → New client secret*, for example
   with a 12-month expiry. Copy the **Value**, not the *Secret ID*, into `AUTH_MICROSOFT_ENTRA_ID_SECRET`.
   Set a calendar reminder to rotate it before it expires. Sign-in stops working when it expires.
5. **Set API permissions.** The portal requests only `openid profile email`. Under *API permissions*,
   make sure Microsoft Graph delegated `openid`, `profile` and `email` are listed, then click
   **Grant admin consent for SolidPro**. The default `User.Read` permission can stay; the app does not use it.
6. **Optionally add the email claim.** Under *Token configuration → Add optional claim → ID → `email`*. The portal
   uses the `email` claim and falls back to `preferred_username` (the UPN). Either one must be on
   `ALLOWED_EMAIL_DOMAINS`.
7. **Restrict sign-in (recommended).** Go to *Enterprise applications → SolidPro Cost Centre Portal → Properties*,
   set **Assignment required? = Yes**, then under *Users and groups* add the security group allowed
   to use the portal, e.g. all employees. Users outside the group are stopped by Microsoft before they
   reach the portal. Conditional Access policies such as MFA and compliant devices apply as usual.
8. **Set the environment variables** on Vercel ([§9](#9-deploy-to-vercel)) and redeploy. Sign in as a test
   user. A `LOGIN` row should appear in **Reports → Audit log**.

How it fits together: the sign-in callback is `/api/auth/callback/microsoft-entra-id`. The portal checks
the `tid` claim against the tenant ID and the email domain against `ALLOWED_EMAIL_DOMAINS`. A failed
check shows *Access denied* on the login page and logs `LOGIN_DENIED`. Signing out of the portal does
not sign the user out of Microsoft 365.

## 8. Supabase setup

1. **Create a project.** Pick the region closest to users, e.g. *South Asia (Mumbai)*. Save the database password.
2. **Get the connection string.** Go to *Project → Connect → Connection string*.
   - For the **app** (Vercel), use the **Transaction pooler** string on port **6543**. Transaction pooling is
     safe here, because the role and user settings are set with `SET LOCAL` and `set_config(..., true)` and
     last only for the current transaction.
   - For **migrations**, use the same string, or the Session pooler or direct connection.
3. **Run the migrations from your machine.** The scripts do not read `.env.local`:
   ```bash
   export DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres'
   npm run db:migrate          # creates schema ccp, role cc_app, RLS, triggers
   ```
   The migrations are recorded in `ccp.schema_migrations` and are safe to re-run.
4. **Demo data (optional).** Run `npm run db:seed` **only on a demo or staging project**. The seed gives
   Finance, Mgmt and BU-head rights to the demo addresses on the real `solidpro-es.com` domain, for example
   `kavya.s@` and `rajesh.n@`. **Never seed production.**
5. **Bootstrap the first Finance admin.** See [§10](#10-granting-roles).
6. **Check the setup.**
   - *Project Settings → Data API → Exposed schemas* should list only `public` (and `graphql_public`). **Do not add `ccp`.**
   - In the SQL editor, run
     `select relname, relrowsecurity from pg_class where relnamespace = 'ccp'::regnamespace and relkind = 'r';`.
     Every table except `schema_migrations` should show `true`.
7. **TLS.** Certificate verification is on by default. If the connection fails with
   `self-signed certificate in certificate chain`, Node does not trust Supabase's CA. You have two options:
   - Download the CA from *Project Settings → Database → SSL Configuration* and point `NODE_EXTRA_CA_CERTS` at it.
     This is the stronger option and works well for running scripts locally.
   - Set `DATABASE_SSL_STRICT=false`. The connection stays encrypted, but the server's identity is not verified.

## 9. Deploy to Vercel

1. **Import the project.** Push the repository to GitHub. In Vercel, go to *Add New → Project*, import the repo
   and accept the defaults: framework Next.js, `next build`, Node 20+.
2. **Set the function region.** Under *Settings → Functions → Function Region*, pick the region closest to the
   Supabase database, e.g. `bom1` (Mumbai), to keep queries fast.
3. **Add the environment variables.** Go to *Settings → Environment Variables*. Set these for **Production**:
   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Supabase transaction-pooler string ([§8](#8-supabase-setup)) |
   | `AUTH_SECRET` | New random value, different from the one used locally |
   | `AUTH_URL` | `https://costcentre.solidpro-engineering.com` (Production only) |
   | `AUTH_MICROSOFT_ENTRA_ID_ID` / `_SECRET` / `_TENANT_ID` | From [§7](#7-microsoft-entra-id-sso) |
   | `ALLOWED_EMAIL_DOMAINS` | `solidpro-es.com` |
   | `FINANCE_CONTACT_EMAIL` | Finance shared mailbox |

   - Do **not** set `AUTH_DEMO_MODE` in Production. It is ignored there anyway.
   - Leave `UPLOAD_MAKER_CHECKER`, `RECON_TOLERANCE` and `FY_START_MONTH` unset (maker-checker on, tolerance
     0.00, April year start) unless Finance has approved a different value.
   - Run `npm run db:migrate` against the database before deploying, so that every migration up to
     `005_phase3.sql` and `006_comments.sql` is applied. On a database that already holds published months,
     `005_phase3.sql` keeps them as combined register rows (entity `ALL`, shown as *All (pre-Phase 3)*) until
     each month is published again per entity.
   - For Preview deployments, use a **separate staging database**, or protect them with Vercel
     Deployment Protection.
   - Variables that are sensitive (secret, database URL) should be marked *Sensitive*.
4. **Deploy.** Run *Deployments → Redeploy*, or push to the production branch.
5. **Set up the custom subdomain.**
   1. In Vercel, go to *Settings → Domains → Add* and enter `costcentre.solidpro-engineering.com`.
   2. At the DNS provider for `solidpro-engineering.com`, create a **CNAME** record:
      `costcentre` → `cname.vercel-dns.com`. If Vercel shows a project-specific target, use that instead.
   3. Wait for Vercel to verify the domain and issue the TLS certificate. This is automatic and usually
      takes a few minutes.
   4. Check that the Entra redirect URI uses this host and that `AUTH_URL` matches it.
6. **Smoke test.**
   - Sign in with a company account.
   - A personal Microsoft account is refused.
   - Search returns results.
   - A non-Finance user gets `403` from `/api/admin/templates/master` and `/api/admin/reports/audit-log`, and
     is sent back to the Finder from `/admin/reports`.
   - A cost centre owner sees only their own cost centres under **My Cost Centres**, and `/my/<another code>`
     shows the 404 page. **Export to Excel** downloads a workbook. The owner can add a variance explanation
     to a line with published actuals.
   - The response headers include `Strict-Transport-Security` and `Content-Security-Policy`.
   - `LOGIN`, `ACCESS_DENIED`, `COMMENT` and `EXPORT` appear in **Reports → Audit log**.

## 10. Granting roles

- **Owner, backup and BU head** for each cost centre come from the **owner mapping upload**. Finance
  maintains them in the portal. No SQL is needed.
- **Finance, Management and BU-wide BU Head** are explicit grants in `ccp.cc_access`. There is no
  screen for these, so IT runs the SQL as a controlled change, for example in the Supabase SQL editor.
  Setting `app.user_email` records the person running the SQL as the actor in the audit log. Without it,
  the actor is `system`.

```sql
begin;
select set_config('app.user_email', 'it.admin@solidpro-es.com', true);   -- who is making the change

-- Finance Admin (full access + Admin area)
insert into ccp.cc_access (user_email, role, created_by) values ('name@solidpro-es.com', 'Finance', 'CHG-1234');
-- Management / CFO (read-only, all cost centres)
insert into ccp.cc_access (user_email, role, created_by) values ('cfo@solidpro-es.com', 'Mgmt', 'CHG-1234');
-- BU Head for a whole BU (bu must match cost_centres.bu exactly, e.g. 'Engineering')
insert into ccp.cc_access (user_email, role, bu, created_by) values ('head@solidpro-es.com', 'BU_Head', 'Engineering', 'CHG-1234');

-- Revoke
delete from ccp.cc_access where user_email = 'name@solidpro-es.com' and role = 'Finance';
commit;
```

Emails must be **lower case** (the database enforces this) and must be the address the user signs in
with. Changes take effect on the user's next page load.

**Review access** in **Reports → User access review**: one row per access right, from the owner mapping and from
these grants, with exceptions flagged and an export for certification. The Admin Guide describes the quarterly
review.

**Grant at least two Finance users.** With maker-checker on (the default), a different Finance user must
approve every upload, so a single Finance user cannot publish anything.

## 11. Testing

```bash
npm test          # vitest: unit and database tests against an in-memory PGlite; no network or Supabase needed
npm run lint      # TypeScript type check (tsc --noEmit)
npm run build     # production build
```

Tests live in `tests/*.test.ts` (227 tests in 8 files). They use a fresh in-memory database with the real
migrations and the demo seed. `tests/helpers.ts` provides `freshDb()`, `resetDb()`, `as(user, sql)` (run as
`cc_app` with RLS), `asSuper()`, and the demo users, including `KAVYA` (preparer) and `DEEPA` (approver).

| File | Covers |
|---|---|
| `tests/rls.test.ts` | Row-level security for every role, including tampered or direct SQL, also on `trial_balances` and `periods`; write restrictions; comments only on one's own cost centres and as oneself; no-delete; deactivation cascade; audit trail contents; append-only audit log; failed-search logging |
| `tests/search.test.ts` | Term parsing; multi-word, partial and any-order search; code with or without dashes; owner, keyword, BU and department search; inactive cost centres excluded; LIKE and injection safety; **< 1 s with 510 cost centres** |
| `tests/validate.test.ts` | Date and CSV/XLSX parsing (including the generated templates); every master and owner-mapping validation rule and warning; `ALLOWED_EMAIL_DOMAINS`; the end-to-end upload workflow: reject, stage, publish with batch-id audit, re-validation at publish, discard, **maker-checker** (including `UPLOAD_MAKER_CHECKER=false`), Finance-only, row limit |
| `tests/financials.test.ts` | Period and amount parsing (Indian grouping, brackets, currency symbols, rounding); every Budget & Actuals validation rule and warning, with the completeness and size checks per month and entity; period summaries per entity and currency; fiscal-year and variance helpers; the My Cost Centres read model for owner, BU head, Management, Finance and employee |
| `tests/reconciliation.test.ts` | The financials publish workflow end to end (Kavya prepares, Deepa approves): trial balance and reconciliation **per entity**, publish blocked and logged until every entity reconciles, maker-checker (also in the database), entities closing independently, line history (`financials_history`), the period register (per entity, legacy `ALL` rows), budget-only and multi-period files, `RECON_TOLERANCE`, re-validation at publish, RLS on `trial_balances`, `periods` and `financials_history` |
| `tests/allocations.test.ts` | Every allocations validation rule and warning; run summaries; the stage → approve/publish workflow (maker-checker, run replacement, row-level audit with the batch id, re-validation at publish, discard); RLS; database constraints |
| `tests/comments.test.ts` | Who may explain a variance (`ccp.can_comment`); explanations only on lines with published actuals and only as oneself; text limits; append-only explanations and their `COMMENT` audit rows; the *Allocations received* read model; the comment API's cross-site check |
| `tests/reports.test.ts` | Filter parsing and whitelisting; the five reports (audit log, upload evidence register with its segregation-of-duties check and batch detail, user access review exceptions, variance commentary coverage, failed searches) for Finance, and that other roles get nothing |

## 12. Acceptance criteria

Acceptance criteria, how each one is met, and the evidence for it. *Manual* means the
criterion is checked in the UAT smoke test ([§9](#9-deploy-to-vercel), step 6) or the demo walkthroughs ([§5](#5-quick-start-local-demo)).

### Phase 1

| # | Acceptance criterion | How it is met | Proven by |
|---|---|---|---|
| 1 | Only SolidPro Microsoft 365 accounts can sign in. There is no self-registration and there are no local passwords. | Entra ID single-tenant OIDC, `tid` check and domain allow-list in the `signIn` and `jwt` callbacks; `LOGIN_DENIED` is logged | Manual (personal and external accounts are refused) |
| 2 | The session ends after 30 minutes of inactivity. | Rolling 30-minute JWT re-issued by the proxy, client idle timer, 10-hour absolute limit | Manual |
| 3 | Every page and API needs sign-in. | `proxy.ts` (redirect or `401`) plus a check in each route | Manual |
| 4 | An employee finds a cost centre by partial, multi-word, any-order search across code, alias, BU, department, owner and keywords (e.g. `chen des` finds *Design Chennai*). | `lib/search.ts` | `search.test.ts`: *"chen des" finds IN-ENG-101 Design Chennai*, *matches partial words*, *matches words in any order*, *finds by owner name*, *finds by keyword*, *finds by BU and department* |
| 5 | Search results appear in under 1 second. | One SQL query over active cost centres, with a 300 ms client debounce | `search.test.ts`: *each search (incl. RLS transaction setup) completes in < 1000 ms with 510 active CCs* |
| 6 | Inactive cost centres never appear in the Finder. | `status = 'Active'` filter | `search.test.ts`: *never returns the inactive IN-ENG-199* |
| 7 | The code can be copied with one click. | *Copy code* button with a clipboard fallback | Manual |
| 8 | When nothing matches, the user sees "Contact Finance", and the search is logged for keyword maintenance. | Finder message; `ccp.log_failed_search()`; **Reports → Failed searches** | `rls.test.ts`: *log_failed_search collapses keystrokes from the same user into one row with the longest term*; `reports.test.ts`: *groups terms by count with users and first/last seen, within the date range* |
| 9 | Employees see no financial data, even when calling the API directly or changing IDs. | RLS on `financials`, `allocations`, `comments`, `audit_log`, `upload_batches`, `failed_searches` | `rls.test.ts`: *Employee sees 0 rows in every protected table, even with direct SQL* |
| 10 | Owners see only their own cost centres, BU heads see their BU, and Finance and Management see everything. | `ccp.visible_cc_codes()` in the RLS policies | `rls.test.ts`: *Owner sees financials only for their own cost centres; ID tampering returns nothing*, *A backup owner sees the cost centres they back up*, *BU head sees all Engineering financials and none from Sales / Shared Services*, *Mgmt sees all financials*, *Finance sees all financials, the audit log, uploads and failed searches* |
| 11 | Only Finance can change master data or use Admin. | RLS write policies; admin page redirect; admin APIs return `403` and log `ACCESS_DENIED` | `rls.test.ts`: *Mgmt cannot insert or update cost centres*, *Non-finance users cannot insert cost centres or change owners/grants* |
| 12 | Finance can download templates and upload the master and owner mapping as `.xlsx` or `.csv`. | `/api/admin/templates/[kind]`, `/api/admin/upload`; `npm run templates` writes the same files to `templates/` | `validate.test.ts`: *reads the generated .xlsx templates: header row only, no example data rows*, *the template with its example rows filled in stages cleanly and publishes*, the `parseCsv` suite, *rejects other file types* |
| 13 | An invalid file is rejected as a whole, with a row-by-row error report covering duplicate codes and aliases, missing owner or backup, external emails, an inactive cost centre with an owner, and bad dates. Nothing is partly loaded. | `lib/upload/validate.ts`; the batch is marked `Rejected` | `validate.test.ts`: `validateMaster` and `validateOwners` suites (*duplicate codes in the file (case/space-insensitive)*, *alias already used by another cost centre in the database*, *cost centre with no backup owner*, *owner / backup / BU head not on the allowed domain*, *inactive cost centre cannot get an owner*, …); *a file with an error is Rejected and cannot be published* |
| 14 | A clean file shows a preview (new, updated, unchanged and warnings) and is then published or discarded. Publishing validates the file again against the current data. | `lib/upload/service.ts` | `validate.test.ts`: *a clean master upload is Validated, then publish upserts and audits with the batch id*, *publish is blocked when the master changed after staging and re-validation fails*, *a validated upload can be discarded and then not published*, *only Finance can stage or publish* |
| 15 | Cost centres cannot be deleted. Deactivation needs a close date and removes the owner mapping. | `cost_centres_no_delete` trigger, CHECK constraints, `tg_cc_deactivated` | `rls.test.ts`: *Nobody can delete a cost centre — not Finance, not even the superuser*, *Deactivating a cost centre removes its owner mapping and logs DEACTIVATE + DELETE*; `validate.test.ts`: *deactivating via a master upload removes the owner mapping; all audit rows carry the batch id* |
| 16 | Every change is audited with who, what, when and the old and new values, and the audit log cannot be changed. | Audit triggers, `log_event()`, append-only triggers | `rls.test.ts`: *Finance can update a cost centre; audit_log records who and only the changed column*, *audit_log is append-only and cannot be written directly by the app* |
| 17 | The portal works on mobile and follows the SolidPro brand (Blue `#16469D`, Red `#E01A22`, Grey `#939597`, Maven Pro). | Responsive Tailwind layout and brand tokens in `globals.css` | Manual |
| 18 | Security headers are sent. | CSP (nonce), HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` | Manual (`curl -I`) |

### Phase 2

| # | Acceptance criterion | How it is met | Proven by |
|---|---|---|---|
| 19 | Owners and backups see budget against actuals only for their own cost centres, BU heads for their BU, and Finance and Management for every cost centre. Employees see none. | `lib/financials.ts` runs every query under RLS (`ccp.visible_cc_codes()`) | `financials.test.ts`: *owner: listMyCostCentres returns exactly her two cost centres with correct totals*, *BU head sees only Engineering cost centres*, *Finance sees every cost centre*, *employee: no cost centres, no periods, nothing by direct code*; `rls.test.ts`: *Owner sees financials only for their own cost centres; ID tampering returns nothing* |
| 20 | Opening or exporting a cost centre the user may not see looks exactly like a code that does not exist (404), and the attempt is logged. | `getDetail()` returns nothing; the page and export return the same 404 and log `ACCESS_DENIED` | `financials.test.ts`: *URL tampering: an owner gets nothing for a cost centre she does not own*; Manual (404 page and audit entry) |
| 21 | The cost centre page shows month, YTD and full-year budget, actual and variance, and the full-year outturn (YTD actual + remaining budget), as of a chosen month. | `getTotals()`, `fiscalYear()`, *As of* selector | `financials.test.ts`: *as of an earlier month, YTD stops at that month and later actuals count as outturn budget*, *fiscalYear*, *variance: positive = overspend; pct is null when budget is 0* |
| 22 | Variances over ±10% are flagged. | `variance()` in `lib/fiscal.ts`; red markers on cost centres, BUs, GL groups and months | `financials.test.ts`: *GL breakdown flags exactly the seeded hotspots for IN-ENG-101*, *IN-ENG-102 flags its under-spend hotspot (Professional Fees)* |
| 23 | Expense breakdown by GL group (table and bar chart), monthly Budget vs Actual trend, and a consolidated by-BU view for Management, Finance and BU heads. | `getGlBreakdown()`, `getMonthlyTrend()`, `consolidate()`; Recharts | `financials.test.ts`: *monthly trend: 12 FY points, actual null after the as-of month*, *management: consolidate() by BU adds up to the rows and to an independent SQL total*; Manual (charts, mobile) |
| 24 | A cost centre's figures can be exported to Excel, and the export is logged. | `/api/cc/[code]/export?period=YYYY-MM` (Summary, GL Breakdown, Monthly Trend, Variance explanations and Allocations sheets); `EXPORT` event | Manual |
| 25 | Finance uploads budget and actuals as `.xlsx` or `.csv`. An invalid file is rejected as a whole with a row-by-row report; budget-only months are supported. | `lib/upload/validate-financials.ts` | `financials.test.ts`: the `validateFinancials` suite (*unknown or missing cost centre*, *invalid period*, *invalid amounts*, *duplicate line (same CC / period / GL, case- and format-insensitive)*, *MISSING_ACTUAL: a period with actuals must have an Actual on every row (0, not blank)*, *WOULD_REMOVE_ACTUALS: a budget-only file for a period with published actuals*, *FUTURE_ACTUAL: actuals cannot be posted after the current month*, *CC_CLOSED: no actuals after an inactive cost centre was closed*, *INCOMPLETE_PERIOD: a file must cover every cost centre that already has figures in that month*, *reports every problem in one pass*), the `normalizePeriod` and `parseAmount` suites; `reconciliation.test.ts`: *staging rejects actuals for a future month (DB clock) and budget-only files for published months* |
| 26 | **Publishing is blocked if cost centre totals do not reconcile to the trial balance.** | The preparer enters the TB total for each month and entity with actuals; `publishUpload` reconciles again in the same transaction and refuses any month and entity whose difference exceeds `RECON_TOLERANCE` (default 0.00) | `reconciliation.test.ts`: *publishing before any trial balance is entered is blocked for each entity and logged (RECON_FAILED)*, *a correct IN trial balance with a wrong US one fails reconciliation for US only; publishing stays blocked*, *a file with several periods needs a matching trial balance for each period and entity*, *RECON_TOLERANCE allows a small difference; the default (0) does not* |
| 27 | Maker-checker: a different Finance user approves and publishes every upload, and only the preparer enters the trial balance. | `publishUpload`, `enterTrialBalance`; *Awaiting approval* queue; database triggers | `validate.test.ts`: *maker-checker: the uploader cannot publish their own upload (master and owners)*, *maker-checker cannot be sidestepped by passing a differently-cased uploader email*, *UPLOAD_MAKER_CHECKER=false lets the uploader publish their own upload*; `reconciliation.test.ts`: *only the preparer can enter trial balances, only for periods and entities with actuals in the file*, *the correct US trial balance reconciles both entities; the preparer still cannot publish her own upload*, *the uploader is recorded from the database identity, so letter case cannot defeat maker-checker*, *blocks self-publish and non-preparer trial balances even when the app layer is bypassed* |
| 28 | A corrected month can be re-uploaded and replaces the published month; the *Published periods* register shows CC actuals against the TB, who published and when; the batch keeps the evidence (batch id, SHA-256, TB entered by and at, approved by). | `publishFinancials` replaces every line of each month and entity in the file; `ccp.periods`, `ccp.trial_balances`, `upload_batches.approved_by` | `reconciliation.test.ts`: *DEEPA publishes: September is replaced by the file exactly, other periods are untouched*, *a published batch is final: no re-publish, no new trial balance, no discard*, *a new past period (2026-03, FY 2025-26) with both entities needs both TBs and gets two register rows*, *a budget-only upload for future months needs no trial balance and publishes*; Manual (Admin page) |

### Phase 3

| # | Acceptance criterion | How it is met | Proven by |
|---|---|---|---|
| 29 | Each legal entity is reconciled to its own trial balance, and entities close independently: a file for one entity replaces only that entity's month. | Trial balances and the period register keyed by month and entity; `publishFinancials` replaces only the month-and-entity pairs in the file | `reconciliation.test.ts`: *a correct IN trial balance with a wrong US one fails reconciliation for US only; publishing stays blocked*, *a bare period key is refused when that period has actuals for two entities*, *entities close independently: a US-only file replaces US September and leaves India untouched*, *a single-entity file accepts a bare period key and registers only that entity*, *ccp.periods is readable by Finance and Management only; only legacy rows can be deleted*; `financials.test.ts`: *PERIOD_TOTAL_TOO_LARGE is checked per legal entity (each entity reconciles to its own TB)* |
| 30 | Amounts are kept in each entity's own currency and amounts in different currencies are never added together. | `lib/currency.ts`; period summaries per entity and currency; one KPI row and one total per currency in My Cost Centres | `financials.test.ts`: *with an entity map: one summary per period and legal entity, in that entity's currency*; Manual (My Cost Centres as Rajesh shows separate INR and USD blocks) |
| 31 | Every financial line a publish adds, changes or removes is kept with its old and new values; the history cannot be changed and only Finance can read it. | `ccp.financials_history`, written in the publish transaction; append-only triggers; RLS | `reconciliation.test.ts`: *line history: every changed, added and removed line, with old and new values and the batch id*, *line history records exactly the lines that changed; an identical re-upload records nothing*, *financials_history is readable by Finance only and is append-only for everyone* |
| 32 | Finance uploads allocations with the same validation, all-or-nothing and maker-checker controls. Each upload replaces each run (month × source cost centre) it contains, cross-entity recharges are refused, and every allocation change is audited. | `lib/upload/validate-allocations.ts`, `publishAllocations`; `allocations_audit` trigger; constraints in `005_phase3.sql` | `allocations.test.ts`: the `validateAllocations` suite (*SELF_ALLOCATION (case- and space-insensitive)*, *CROSS_ENTITY: a US source cannot allocate to an IN cost centre (or vice versa)*, *INVALID_PERIOD and FUTURE_ACTUAL (allocations are actual recharges)*, *INVALID_AMOUNT (not a number, or too large) and ZERO_AMOUNT*, *CC_CLOSED: a closed cost centre cannot receive allocations after its close month*, *CC_CLOSED: a closed cost centre cannot be the source of a recharge after its close month either*, *DUPLICATE_LINE: same receiving CC, period and source (case-insensitive)*, *DIRECT_SOURCE warns once per Direct source cost centre*, *OVER_ALLOCATED warns when a run recharges more than the source actually cost that month*, *reports every problem in one pass*); *maker-checker: KAVYA cannot publish her own run; DEEPA publishes and the run is replaced exactly*, *CROSS_ENTITY: a US source recharging an IN cost centre is rejected and cannot be published*, *publish re-validates: a receiving cost centre closed after staging blocks the run*, *non-Finance users cannot stage or publish allocations, nor write them directly*, *database constraints back up the file rules* |
| 33 | An owner sees the allocations her cost centres receive, for the month and fiscal YTD, for information only. | `lib/allocations.ts` under RLS; *Allocations received* panel and *Allocations* export sheet | `comments.test.ts`: *IN-ENG-101, Sep 2026: the IN-SSV-302 recharge with its basis, month and fiscal YTD*, *YTD follows the fiscal year and the As-of month*, *is filtered by RLS: an employee sees nothing; an owner sees nothing for another CC*; `allocations.test.ts`: *an owner reads only the allocations her cost centres receive*; Manual (panel and export) |
| 34 | The owner, backup owner, BU head and Finance can explain a variance on a line with published actuals; Management and employees cannot. Explanations are permanent and audited. | `ccp.can_comment()`, `comments_insert` policy, append-only and audit triggers (`006_comments.sql`) | `comments.test.ts`: *ccp.can_comment: owner, backup and BU head of the CC, and Finance — not Mgmt or employees*, *a BU_Head grant in cc_access is enough (no owner mapping needed)*, *the owner can comment on her own CC for a published period, as herself*, *the owner cannot comment on another cost centre (RLS)*, *Management and employees cannot comment*, *cannot comment on a period with no actuals (budget only) or a GL group that does not exist*, *cannot comment as somebody else*, *validates the text: 1–2000 characters after trimming*, *comments cannot be updated or deleted — not by the app, not even by the table owner*, *each comment writes an audit_log COMMENT row with who and what*; `rls.test.ts`: *Owner can comment on own cost centre only, and only as themselves* |
| 35 | Flagged lines without an explanation are marked for the people who can explain them, and the explanations are in the cost centre export. | `my/[code]/page.tsx` (*Explanation needed*), `listComments()`, *Variance explanations* export sheet | `comments.test.ts`: *listComments: newest first, all GL groups of the CC and period, only for visible CCs*, *commentableGlGroups lists the lines with actuals for the period (none for a budget-only month)*; Manual |
| 36 | The comment API refuses cross-site requests. | `isCrossOrigin()` | `comments.test.ts`: *allows same-origin requests and requests without an Origin header*, *refuses a different Origin, an opaque Origin, and cross-site fetch metadata* |
| 37 | Finance can filter, page through and export the audit log, with field-by-field changes; nobody else can read it. | `auditLog()`, *Reports → Audit log*, 50 per page, export up to 50,000 rows | `reports.test.ts`: *Finance sees the seed changes, newest first, 50 per page*, *filters by action, user, entity id and date (UTC, inclusive)*, *whitelists action and entity against SELECT DISTINCT (unknown values are dropped)*, *paginates and exports up to the cap*, *returns nothing for non-Finance users (RLS)*, *turns audit JSON into a readable field-by-field diff* |
| 38 | Every upload has an evidence record: SHA-256, preparer, approver, segregation-of-duties check and reconciliation, with a detail page and an evidence workbook per batch. | `uploadRegister()`, `uploadBatchDetail()`, *Reports → Upload evidence register* | `reports.test.ts`: *segregation of duties: seed, ok, violation, pending*, *lists every batch with SoD status; the seed batch is "system seed", not a violation*, *filters by type, status and upload date*, *batch detail: stored warnings/errors, the audit events it caused, and line history when available*, *rejects malformed ids and hides everything from non-Finance users* |
| 39 | Finance can run a user access review: every access right with its source and the control exceptions, exported for certification. | `accessReview()`, *Reports → User access review*; export with *Certified (Y/N)* and *Reviewer comment* columns | `reports.test.ts`: *lists owner-mapping and explicit-grant rights with their source*, *flags Finance users who own or back up cost centres (segregation of duties)*, *flags owner = BU head, grants on inactive cost centres and emails outside the allowed domains*, *filters by user, role and BU (company-wide grants stay under a BU filter)*, *is only meaningful for Finance: others never see other users’ explicit grants*; Manual (export columns) |
| 40 | Finance can see, for a month, every line over ±10% YTD variance and whether it has been explained. | `commentaryCoverage()`, *Reports → Variance commentary coverage* | `reports.test.ts`: *defaults to the latest period and lists lines over ±10% YTD variance*, *a comment for the cc + period + GL line makes it explained*, *filters by BU and whitelists the period*, *non-Finance users only ever get their own cost centres (RLS on financials)* |
| 41 | Every report export is audited. | `api/admin/reports/[report]` logs `EXPORT` (entity `report`) in the same transaction as the read | Manual (export a report, then filter the audit log on `EXPORT`) |

## 13. Roadmap

| Phase | Scope |
|---|---|
| **1 — delivered** | Microsoft Entra ID SSO; Cost Centre Finder; Admin upload of the master and owner mapping with validation, preview, publish and discard; audit log; failed-searches report; RLS for every future data set |
| **2 — delivered** | **My Cost Centres** for owners, backups, BU heads and Management: month, YTD and full-year budget against actuals, outturn, GL-group breakdown and monthly trend, ±10% variances flagged, *As of* selector, Excel export. **Budget & Actuals upload** with **trial-balance reconciliation**: a month's actuals must equal the Tally trial balance before they can be published. **Maker-checker** on every upload, with an *Awaiting approval* queue and a *Published periods* register. |
| **3 — delivered** | Reconciliation **per legal entity**, with entities closing independently and amounts kept in each entity's currency; line-level **history of financial figures**; **Allocations upload** and *Allocations received* view; **variance explanations** by owners, backups and BU heads; Finance **Reports** (audit log, upload evidence register, user access review, variance commentary coverage, failed searches) with audited Excel exports |
| **Next** | **FX-converted consolidation**: open decision awaiting the business (reporting currency and rate source); until then totals stay per currency. **Production deployment** (Supabase, Vercel, custom domain; [§8](#8-supabase-setup), [§9](#9-deploy-to-vercel)). **Entra ID configuration** (app registration, secret, assignment; [§7](#7-microsoft-entra-id-sso)) |

## 14. Known limitations and next steps

- **No FX-converted consolidation.** Amounts stay in each entity's currency, and company-wide views show one total per
  currency. A group total in one reporting currency waits for the business to choose the reporting currency and the
  rate source.
- **Choosing a month only one entity has closed.** The *As of* selector, the export and the variance commentary
  coverage report default to the latest month that **every** entity the user can see has closed. A later month that
  only one entity has published can still be chosen explicitly; then the other entity's cost centres show that
  month's budget with no actual and look under budget.
- **Validated uploads never expire.** An older upload cannot overwrite a month, entity or allocation run published
  after it was prepared (publishing is blocked with a message), but it stays in *Awaiting approval* until someone
  discards it.
- **Months published before Phase 3 keep one combined register row** (entity `ALL`) until they are published
  again per entity. While a month has such a row, a budget-only file for any entity of that month is refused
  (`WOULD_REMOVE_ACTUALS`). Lines published before Phase 3 have no line history.
- **Re-publishing an allocation run logs every line as a delete and a create**, even when a line is unchanged,
  because the run is replaced as a whole.
- **`OVER_ALLOCATED` is not checked when the source cost centre has no actuals for the month.** Load allocations after
  the source's month is published.
- **A whole allocation run cannot be removed through the portal**, because every row needs an amount other than 0.
  A run loaded in error can be replaced by the correct one; removing it entirely needs a controlled database change.
- **Allocations are for information only.** They are not added to actuals and are not reconciled to a trial balance.
- **Finance can still update rows of the period register directly** (RLS allows it; only legacy `ALL` rows can be
  deleted), but every change is audited.
- **Explanations cannot be edited or deleted.** To correct one, add a new explanation. An explanation belongs to one
  month: a line that stays flagged needs a new one each month.
- **Reports show times in UTC.** Explanations on the cost centre page are shown in the viewer's local time.
- **No export of published financials or of the current master.** Finance keeps its own working copies, because
  a master row must be a complete record and a Budget & Actuals upload must contain the whole month for an entity.
- **A published month cannot be turned back into a budget-only month** through the portal (`WOULD_REMOVE_ACTUALS`).
- **No screen for role management.** Finance, Management and BU-head grants are SQL changes
  ([§10](#10-granting-roles)). The user access review lists them but cannot change them.
- **Master and owner uploads only add or update rows.** Rows that are not in a file are untouched. The only way
  to remove an owner mapping is to deactivate the cost centre. To swap aliases between two cost centres, use two uploads.
- **No notifications.** Owners are not told when a month is published or when a line needs an explanation, and
  approvers are not told that an upload is waiting.
- **Viewing a cost centre's financials is not logged.** `VIEW_FINANCIALS` is whitelisted in `log_event`, but only
  exports (`EXPORT`) and denied attempts (`ACCESS_DENIED`) are recorded.
- **Sessions are not revoked centrally.** Disabling an Entra account blocks new sign-ins, but an open
  portal session lasts until the 30-minute idle or 10-hour absolute limit. Signing out of the portal
  does not sign the user out of Microsoft.
- **SSO fails closed without a tenant ID.** If `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID` is missing, the
  Microsoft button is disabled and any Entra sign-in is rejected (no fallback to the multi-tenant endpoint).
- **Database TLS.** There is no variable for a custom CA, and an `sslmode` in `DATABASE_URL` overrides
  `DATABASE_SSL_STRICT` ([§8](#8-supabase-setup)).
- **The `npm run db:*` scripts do not load `.env.local`** ([§6](#6-environment-variables)).
- **Failed searches are kept indefinitely,** together with the user's email. Define a retention period.
- **The app connects with the database owner's credentials** (the same ones used for migrations) and
  switches to `cc_app` in each transaction. All SQL is parameterised. Still, a dedicated login role that
  is only a member of `cc_app` would limit the damage of any future SQL-injection bug, and the owner
  credentials, which could disable the audit triggers, would stay with IT for migrations only.
  For example: `create role cc_app_login login password '…' noinherit; grant cc_app to cc_app_login;`,
  then use that role in `DATABASE_URL`.
- **`/api/search` has no rate limit** beyond requiring sign-in. If needed, add a Vercel WAF rate-limit rule.

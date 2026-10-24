# Finance Admin Guide: SolidPro Cost Centre Portal

This guide is for users who hold the **Finance** role. Only the Finance role can see
**Admin** and **Reports** in the top menu, change cost centre master data, or load budget,
actuals and allocations. The database enforces this as well as the screens.

Every upload needs two people (**maker-checker**, on by default):

- the **preparer** uploads and validates the file and, for Budget & Actuals, enters the trial-balance total of each entity;
- the **approver**, a *different* Finance user, reviews it under **Awaiting approval** and publishes it.

The **Admin** page has these sections:

| Section | Who uses it | What it is for |
|---|---|---|
| **1. Download a template** | Preparer | The four Excel templates ([§2](#2-download-the-templates)) |
| **2. Upload & validate (preparer)** | Preparer | Upload, read the error report, enter the trial balances ([§7](#7-read-the-error-report), [§8](#8-reconcile-to-the-trial-balance)) |
| **3. Awaiting approval (checker)** | Approver | Review, then **Approve & publish** or **Discard** ([§9](#9-approve-and-publish-or-discard)). The preparer can also enter the trial balances here |
| **Published periods** | Both | The latest 24 register rows, one per month and entity: CC actuals and trial balance (in the entity's currency), status, who published and when |
| **Data quality exceptions** | Both | Active cost centres with no owner or no keywords |
| **Recent uploads** | Both | The last 10 uploads, with status and **Approved by** |

**Reports & audit** on the Admin page, or **Reports** in the top menu, opens the Finance reports
([§12](#12-reports-the-audit-log-and-upload-evidence)).

Contents

1. [Monthly SOP checklist](#1-monthly-sop-checklist)
2. [Download the templates](#2-download-the-templates)
3. [Prepare the Cost Centre Master file](#3-prepare-the-cost-centre-master-file)
4. [Prepare the Owner Mapping file](#4-prepare-the-owner-mapping-file)
5. [Prepare the Budget & Actuals file](#5-prepare-the-budget--actuals-file)
6. [Prepare the Allocations file](#6-prepare-the-allocations-file)
7. [Upload and read the error report](#7-read-the-error-report)
8. [Reconcile to the trial balance](#8-reconcile-to-the-trial-balance)
9. [Approve and publish, or discard](#9-approve-and-publish-or-discard)
10. [Deactivate (or reactivate) a cost centre](#10-deactivate-or-reactivate-a-cost-centre)
11. [Variance explanations](#11-variance-explanations)
12. [Reports, the audit log and upload evidence](#12-reports-the-audit-log-and-upload-evidence)
13. [Quarterly user access review](#13-quarterly-user-access-review)
14. [Use the failed-searches report to add keywords](#14-use-the-failed-searches-report-to-add-keywords)
15. [Internal-control notes](#15-internal-control-notes)

---

## 1. Monthly SOP checklist

Run checklist **A** after month-end close and whenever a cost centre or an owner changes. Run
checklist **B** once **for each entity**, as soon as that entity's books in Tally are closed. Run **C**
when the month's allocation workings are approved, and **D** before the month is signed off. When you need
both A and B, publish the master first, because a Budget & Actuals file can use only cost centres that are
already in the master.

### A. Cost centre master and owners

**Prepare (preparer)**

- [ ] Collect the approved change requests: new cost centres, closures, alias or keyword changes, and owner, backup or BU-head changes. Include movers and leavers from the HR report.
- [ ] Open **Reports → Failed searches**. Note any failed search terms that should become keywords (see [§14](#14-use-the-failed-searches-report-to-add-keywords)).
- [ ] Open **Admin** and clear the **Data quality exceptions** list. It shows active cost centres with no owner and active cost centres with no keywords.
- [ ] Download fresh templates from **Admin → 1. Download a template**.
- [ ] Fill in the **master** file. Include only the rows that are new or changed, and give every column for each row (see [§3](#3-prepare-the-cost-centre-master-file)).
- [ ] Fill in the **owner mapping** file for new cost centres and owner changes (see [§4](#4-prepare-the-owner-mapping-file)).
- [ ] Upload the **master** file under **Admin → 2. Upload & validate**. Fix and re-upload until it shows **Validated**. It then waits under **3. Awaiting approval**.

**Approve (approver: a different Finance user; the portal enforces this)**

- [ ] Under **3. Awaiting approval**, check that the *new / updated / unchanged* counts and the warnings match the change requests, then click **Approve & publish**.
- [ ] The preparer then uploads the **owner mapping** file, which must come *after* the master is published. The approver checks the counts and publishes it.
- [ ] Search for two or three of the changed cost centres in the **Cost Centre Finder** to confirm that the code, alias and owner are correct.

### B. Monthly close: Budget & Actuals, entity by entity

Each legal entity (`IN`, `US`, `UK`) keeps its own books in its own Tally company and currency, so each
one closes on its own: its own file, its own trial-balance total and its own approval. An upload replaces a
month **only for the entities it contains**. For example, if the US closes October on working day 3 and India
on working day 6, the US upload does not touch India's October, and India's later upload does not touch the US.

**Prepare (preparer), for one entity**

- [ ] Make sure nothing more will be posted to the month in that entity's Tally company (close or lock the period), so the figures cannot move after you export them.
- [ ] Export two reports from that company for the month: the **cost-centre-wise breakdown of the expense ledgers**, and the **trial balance** showing the month's movement (not the year-to-date closing balance).
- [ ] Map every Tally ledger or group in scope to its portal **GL group**, using Finance's GL mapping sheet. Add new or renamed ledgers to the mapping before you go on.
- [ ] Fill in the **Budget & Actuals** file for the month: one row per cost centre **of that entity** and GL group, with the month's **Budget** and **Actual**, in the **entity's own currency** (INR for `IN`, USD for `US`, GBP for `UK`; never convert). Include every cost centre of the entity that has a budget for the month, because the upload replaces the entity's whole month (see [§5](#5-prepare-the-budget--actuals-file)).
- [ ] Work out the entity's **trial-balance total** that the file must equal (see [§8](#8-reconcile-to-the-trial-balance)).
- [ ] Upload the file under **Admin → 2. Upload & validate** with Upload type **Budget & Actuals**. Fix and re-upload until it shows **Validated**. Read every warning: `NEW_GL_GROUP` often means a mapping typo.
- [ ] In the period table (one row per month and entity), enter the entity's trial-balance total and click **Reconcile to TB**. The difference must be 0.00. If it is not, see [Troubleshoot a reconciliation difference](#troubleshoot-a-reconciliation-difference). If you have left the page, enter it on the upload's card under **3. Awaiting approval**.
- [ ] Save the entity's Tally trial balance, the Tally cost centre report, the uploaded file and the mapping sheet in the Finance evidence folder, then tell the approver.

**Approve (approver: a different Finance user)**

- [ ] Under **3. Awaiting approval**, check the uploader, the file name and the **SHA-256** (against the file in the evidence folder). For each month and entity, check the currency, rows, cost centres, budget total, CC actuals total, trial-balance total and **✓ Reconciled**.
- [ ] Agree each trial-balance total to that entity's Tally trial balance in the evidence folder, then click **Approve & publish**.

**Verify (approver)**

- [ ] **Admin → Published periods** lists the month **for that entity**, with *CC actuals* equal to *Trial balance*, **✓ Reconciled**, and your name under *Published by*.
- [ ] **Recent uploads** shows the upload as *Published*, with your name under **Approved by**.
- [ ] Open **My Cost Centres**, choose the month under **As of**, and agree two or three of the entity's cost centres to the Tally cost centre report.
- [ ] Tell the entity's cost centre owners that the month is available and that flagged lines need an explanation (checklist **D**). The portal does not send notifications.

> **Until every entity has published the month**, the default **As of** month (and the coverage report's
> default month) stays at the latest month every entity the user can see has closed. Users can still choose the
> new month explicitly; the entity that has not closed it yet then shows that month's budget with no actual.

### C. Allocations

Load allocations after the source cost centres' actuals for the month are published, so that the
over-allocation check can run.

**Prepare (preparer)**

- [ ] Collect the month's approved allocation workings from each shared service, e.g. IT by headcount or rent by floor area.
- [ ] Fill in the **Allocations** file: one row per receiving cost centre, with the month, the source cost centre, the amount in the entity's currency and the basis (see [§6](#6-prepare-the-allocations-file)). Each source's **whole run** for the month goes in one file, because the upload replaces it.
- [ ] Recharges between entities are intercompany charges: book them in Tally, not as allocations (`CROSS_ENTITY`).
- [ ] Upload the file with Upload type **Allocations**. Fix and re-upload until it shows **Validated**. Check the run table (month, source, receiving cost centres, total) and the warnings `DIRECT_SOURCE` and `OVER_ALLOCATED`. No trial balance is needed.
- [ ] Save the workings in the Finance evidence folder, then tell the approver.

**Approve (approver)**

- [ ] Agree each run's total and number of receiving cost centres to the approved workings, then click **Approve & publish**.
- [ ] Open one receiving cost centre in **My Cost Centres** and check **Allocations received**.

### D. Variance commentary and sign-off

- [ ] After each entity's month is published, owners, backup owners or BU heads explain every line marked **Explanation needed** (see [§11](#11-variance-explanations)).
- [ ] In **Reports → Variance commentary coverage**, **choose the month** (do not rely on the default) and tick **Unexplained only**. Chase the owners of the lines that remain.
- [ ] Before the month is signed off, check that every flagged line is explained, or record on the sign-off why a line is not. Export the report and file it with the month's evidence.

### Evidence and review (every month)

- [ ] Save the uploaded files and the signed-off change requests in the Finance evidence folder, named with the upload date and file name (see [§15](#15-internal-control-notes)).
- [ ] In **Reports → Upload evidence register**, filter on the month's upload dates: every published upload shows **✓ Different approver** and every financials row is reconciled. Export the register and file it ([§12](#12-reports-the-audit-log-and-upload-evidence)).
- [ ] In **Reports → Audit log**, review the month: check every `UPLOAD_PUBLISHED` against a change request or the month's close, check every `RECON_FAILED`, and look at `LOGIN_DENIED` and `ACCESS_DENIED` events.
- [ ] Each quarter, run the user access review ([§13](#13-quarterly-user-access-review)).

---

## 2. Download the templates

Go to **Admin → 1. Download a template**:

| Button | File | Use |
|---|---|---|
| Cost Centre Master | `SolidPro_CC_Master_Template.xlsx` | Create or update cost centres, or deactivate them |
| Owner Mapping | `SolidPro_CC_Owner_Mapping_Template.xlsx` | Assign the owner, backup owner and BU head |
| Budget & Actuals | `SolidPro_CC_Financials_Template.xlsx` | Load the annual budget and each month's actuals, by cost centre and GL group |
| Allocations | `SolidPro_CC_Allocations_Template.xlsx` | Load shared-service recharges, by receiving cost centre, month and source cost centre |

Every download is recorded in the audit log (`TEMPLATE_DOWNLOAD`). Each workbook has:

- A **data sheet** (`CC_Master`, `Owner_Mapping`, `Financials` or `Allocations`) with a blue, frozen header row and **no data rows** — enter yours under the header. Example rows are on the Instructions sheet only, so an unchanged template is rejected as empty.
- A note on each header cell that gives the rule. Hover over the header to read it.
- An **Instructions** sheet that lists the same rules.
- Cells formatted as **Text**, so that Excel does not change `IN-ENG-101` or dates.

**General file rules**

- `.xlsx` or UTF-8 `.csv` only (no `.xls`), with a maximum of **5 MB**. The master, owner mapping and allocations allow up to **5,000** data rows, and Budget & Actuals up to **60,000**.
- Keep the header names exactly as they are. They are **case-sensitive** (`CC_Code`, not `cc code`). You can reorder columns, extra columns are ignored, and blank rows are skipped.
- For `.xlsx`, the portal reads the sheet named `CC_Master`, `Owner_Mapping`, `Financials` or `Allocations`. If there is no sheet with that name, it reads the first sheet.
- **A master or owner mapping upload adds or updates the rows it contains. Rows that are not in the file are left unchanged.** You can upload only the rows that changed. These uploads never delete anything.
- **A Budget & Actuals upload replaces whole months for each entity it contains** (see [§5](#5-prepare-the-budget--actuals-file)).
- **An Allocations upload replaces whole runs**: every allocation of each source cost centre for each month in the file (see [§6](#6-prepare-the-allocations-file)).

---

## 3. Prepare the Cost Centre Master file

Each row is a **complete record** of one cost centre. When it is published, all fields of
that cost centre are replaced with the values in the row, so fill in every column, even for
a small change such as adding a keyword. The portal has no export of the master, so keep your
Finance master workbook up to date as the working copy.

| Column | Required | Rule |
|---|---|---|
| `CC_Code` | Yes | Format `<Entity>-<BU code>-<number>`, e.g. `IN-ENG-101`: 2 letters, 2–6 letters or digits, 3–4 digits. The code is converted to upper case and spaces are removed. Each code may appear only once in a file. |
| `CC_Alias` | Yes | Friendly name of 2–80 characters, e.g. *Design Chennai*. It must be unique (case-insensitive) in the file **and** against every other cost centre already in the master. |
| `Entity` | Yes | `IN`, `US` or `UK`, and it must match the code prefix (`IN-…` must be `IN`). The entity also sets the currency of the cost centre's figures: INR, USD or GBP. |
| `BU` | Yes | Business unit, e.g. `Engineering`, `Shared Services`, `Sales`. Use the exact same spelling every time, because BU-head access is matched on this text. |
| `Department` | Yes | Free text. |
| `Type` | Yes | `Direct`, `Shared` or `Allocated` (any upper or lower case). Allocations normally come from `Shared` or `Allocated` cost centres. |
| `Keywords` | No | Words that employees might search for, separated by `;` or `,`. They are stored in lower case, e.g. `cad; solidworks; chennai`. |
| `Status` | Yes | `Active` or `Inactive`. |
| `Start_Date` | Yes | `YYYY-MM-DD`, `DD/MM/YYYY` or `DD-MM-YYYY`, with a 4-digit year. **Day first, so the US format MM/DD is not supported.** Dots (`01.10.2026`) and `YYYY/MM/DD` are rejected. |
| `Close_Date` | If Inactive | Required when Status is `Inactive`, and must be **empty** when Status is `Active`. It must be on or after `Start_Date`. |

Tips

- Search in the Finder matches the code (with or without hyphens), alias, BU, department,
  owner name and keywords. Good keywords include locations, software names, typical expense
  words and old names.
- A **new** active cost centre shows the `NEEDS_OWNER` warning until you upload its owner mapping.

---

## 4. Prepare the Owner Mapping file

Each cost centre has one owner row. When the file is published, each listed cost centre's
owner, backup owner and BU head are replaced. Cost centres that are not in the file keep
their current mapping.

| Column | Required | Rule |
|---|---|---|
| `CC_Code` | Yes | Must already exist **in the published master** and be **Active**. Publish the master file first. Each code may appear only once. |
| `Owner_Name` | Yes | Full name. This name appears in the Finder. |
| `Owner_Email` | Yes | Company email on an allowed domain (`@solidpro-es.com` unless IT has configured more domains). |
| `Backup_Owner_Email` | Yes | Company email that is different from the owner's. Every cost centre must have a backup. |
| `BU_Head_Email` | No | Company email of the BU head for this cost centre. |

**This file also controls access.** The owner, the backup and the BU head named here can see that cost
centre's budget and actuals in **My Cost Centres** and can explain its variances. Access changes as soon as
the file is published. Use the email address that the person signs in with (their Microsoft 365 address).
Upper or lower case does not matter. Avoid naming the same person as owner (or backup) and BU head: the
user access review flags it, because nobody independent then reviews the cost centre.

---

## 5. Prepare the Budget & Actuals file

Each row holds the budget and actual of one cost centre, for one month and one GL group.
One file may hold several months (for example, a month of actuals, or a full-year budget) and
several entities, but each entity normally closes with its own file.

| Column | Required | Rule |
|---|---|---|
| `CC_Code` | Yes | Must exist in the master. Inactive cost centres are accepted, but not with actuals after the month they closed. Publish a new cost centre in the master first. |
| `Period` | Yes | The month as `YYYY-MM`, e.g. `2026-10`. Also accepted: an Excel date such as `2026-10-01` (the day is ignored), or a month name with a 4-digit year: `Oct-2026`, `Oct 2026`, `October 2026`. `10/2026`, `2026/10` and `Oct-26` are rejected. |
| `GL_Group` | Yes | The GL group from Finance's Tally mapping, e.g. `Employee Costs`, up to 60 characters. Extra spaces are removed and upper or lower case does not matter, but use the same spelling every month: a new spelling is a new GL group. |
| `Budget` | Yes (every row) | The month's budget for the line. **Enter 0 when there is no budget** — a blank cell is rejected (`REQUIRED`), because the upload replaces the whole month and a blank would wipe the budget. |
| `Actual` | Yes (column) | The month's actual. **Blank means "no actual yet"** and is allowed only in budget-only (future) months. In a month that has any actuals for the entity, every row of that entity needs an actual: enter `0`, not blank. |

**Amounts.** Enter every amount in the currency of the cost centre's entity (INR for `IN-…`, USD for `US-…`,
GBP for `UK-…`). The portal never converts currencies. Commas and spaces are ignored, so Indian grouping
(`1,23,456.78`) and Western grouping (`123,456.78`) both work. Currency symbols (`₹ $ £ €`) and a leading
`INR`, `USD` or `GBP` are removed, without checking that they match the entity. Enter negatives (credits) as
`-1234` or `(1,234)`. Each amount is rounded to 2 decimal places. `Dr`/`Cr` suffixes, trailing minus signs
(`1234-`) and scientific notation (`1.2E+06`) are rejected.

**One upload replaces whole months, entity by entity.** When the file is published, every existing line of
every month in the file is deleted **for every cost centre of each entity that has rows in that month**, and
replaced by the lines in the file. Other entities' lines for the same month, and months that are not in the
file, are not touched. So:

- include every cost centre and GL group of the entity that has a budget or an actual in the month, with both its budget and its actual (`0` where there is none);
- a GL line that is missing for a cost centre in the file disappears from that month, together with its budget. A cost centre of the entity that is missing altogether is refused (`INCOMPLETE_PERIOD`);
- the budget of a month that you load actuals for is whatever the file says, so copy it from the budget. Do not leave it blank.

**Months with actuals** must reconcile, entity by entity, to that entity's trial balance before they can be
published ([§8](#8-reconcile-to-the-trial-balance)). **Budget-only months**, where every `Actual` of the entity
is blank, need no trial balance.

Other rules:

- One row per cost centre, month and GL group.
- No actuals (not even `0`) for a month after the current calendar month.
- No non-zero actual for an inactive cost centre after the month of its `Close_Date`. A budget is allowed.
- A month earlier than the cost centre's `Start_Date` gives a warning, not an error.

### Load the annual budget (budget-only months)

Load the budget before the fiscal year starts (April, unless IT has changed `FY_START_MONTH`):

1. Prepare one file with all 12 months of the year: one row per cost centre, GL group and month, with
   `Budget` filled in and `Actual` **blank**. For example, 100 cost centres × 6 GL groups × 12 months
   is 7,200 rows, well under the 60,000-row limit. Each entity's rows are in its own currency.
2. Upload and validate it. The period table shows each month and entity as **Budget only**, with *No TB needed*.
3. The approver publishes it. There is no reconciliation step.
4. Check **My Cost Centres**: *Full-year budget* shows the year's budget. Budget-only months do not
   appear in **Published periods**, which lists only months with actuals.

To **revise** the budget for later months, upload those months again, complete for each entity. A budget-only
month for an entity that already has published actuals for it is rejected (`WOULD_REMOVE_ACTUALS`), so leave
closed months out of a budget revision, or include their actuals and trial-balance totals.

You can combine months in one file. For example, a file with October actuals and a revised budget for
November to March needs a trial-balance total for October only, one for each entity with actuals.

### Correct a published month

You cannot edit single lines. To correct a month that is already published for an entity:

1. Correct the source (Tally or the GL mapping), and prepare the **complete** month again for that entity:
   every cost centre of the entity and every GL group, with budget and actual.
2. Upload it, enter the entity's trial-balance total, reconcile, and have a different Finance user approve it,
   as in the monthly close ([§1 B](#b-monthly-close-budget--actuals-entity-by-entity)).
3. When it is published, the corrected file replaces every line of that entity's month; other entities are not
   touched. **Published periods** shows the entity's new totals, the approver and the time. The `UPLOAD_PUBLISHED`
   audit event records the month's totals before and after, and the batch in **Reports → Upload evidence register**
   lists every line it changed, with the old and new values.

A month with published actuals cannot be turned back into a budget-only month through the portal.

---

## 6. Prepare the Allocations file

An allocation is a recharge from a shared-service cost centre (the **source**, normally of type `Shared` or
`Allocated`) to a cost centre that uses the service. Owners see allocations under **Allocations received** in
My Cost Centres, for the month and the fiscal year to date, and in their Excel export. Allocations are shown
**for information**: they are not added to the receiving cost centre's actuals and are not reconciled to a trial balance.

| Column | Required | Rule |
|---|---|---|
| `CC_Code` | Yes | The **receiving** cost centre. Must exist in the master and be in the same entity as `Source_CC`. An inactive cost centre can receive allocations up to the month of its `Close_Date`. |
| `Period` | Yes | Same formats as Budget & Actuals (`YYYY-MM`, an Excel date, `Oct-2026`). Not after the current calendar month, because allocations are actual recharges. |
| `Source_CC` | Yes | The shared-service cost centre the recharge comes from. Must exist, differ from `CC_Code`, be in the same entity, and not have closed before the month. |
| `Amount` | Yes | The amount recharged, in the entity's own currency, with the same number rules as Budget & Actuals. Negative for a reversal. `0` is refused: leave the line out instead. |
| `Basis` | Yes | How the amount was worked out, up to 120 characters, e.g. `Headcount (42 of 118)` or `Floor area (60%)`. Owners see it. |

**One upload replaces whole runs.** A run is every allocation from one source cost centre in one month. When
the file is published, every existing allocation of each month-and-source pair in the file is deleted and
replaced by the rows in the file. Other sources and other months are not touched. So:

- include every receiving cost centre of the run; one that is left out loses its allocation for that month;
- you can load each source on its own when its workings are ready (IT today, rent tomorrow), or several runs in one file;
- each run's total is compared with the source's own published actual cost for that month (all its GL lines). A run
  that recharges more gives the `OVER_ALLOCATED` warning. If the source has no actuals for the month yet, the check
  is skipped, so load allocations after the month is published;
- a whole run cannot be removed through the portal, because every row needs an amount other than 0. If a run was
  loaded in error, upload the correct run; if no run should exist, ask IT for a controlled change.

Maker-checker applies as for every upload. There is no trial balance for allocations.

---

## 7. Read the error report

To upload a file:

1. Go to **Admin → 2. Upload & validate (preparer)**.
2. Choose **Upload type** (*Cost Centre Master*, *Owner Mapping*, *Budget & Actuals* or *Allocations*) and select the file.
3. Click **Validate**. Validation saves nothing to the master, the financials or the allocations.

The portal then shows one of two results:

- **Rejected**: the file has at least one error, and nothing was saved. The table lists every
  problem, with **Row** (the Excel row number, where the header is row 1, or `File` for a problem
  with the whole file), **Column**, **Severity** and the message with its code in brackets.
  Fix **all** errors in your file and upload it again.
- **Validated**: the file has no errors. For the master and owner mapping, the portal shows how many
  rows are *new*, *updated* and *unchanged*. For Budget & Actuals, it shows a table with one line per
  month and entity: entity and currency, rows, cost centres, budget total and CC actuals total (*Budget only*
  for a budget-only month). For Allocations, it shows one line per run: month, source cost centre, number of
  receiving cost centres and total allocated. It also lists any **warnings**. Warnings do not block
  publishing, but read them.

A validated upload waits under **3. Awaiting approval** until a different Finance user publishes it
or someone discards it ([§9](#9-approve-and-publish-or-discard)). A Budget & Actuals upload with actuals
must first be reconciled by the preparer ([§8](#8-reconcile-to-the-trial-balance)).

### Errors (any error rejects the whole file)

**All file types**

| Code | Meaning | How to fix |
|---|---|---|
| `MISSING_COLUMN` | A required column header is missing or misspelt. Headers are case-sensitive. | Download the latest template and copy your data into it, or correct the header. |
| `EMPTY_FILE` | There are no data rows under the header. | Add rows. Check that you selected the right file and sheet. |
| `REQUIRED` | A required value is blank: `CC_Code` in every file; in the master file, also `CC_Alias`, `BU` or `Department`; in Budget & Actuals, also `GL_Group` and `Budget` (enter 0 for no budget); in Allocations, also `Source_CC`, `Amount` and `Basis`. | Fill in the cell. |
| `DUPLICATE_CODE` | Master and owner mapping: the same `CC_Code` appears on more than one row. The message gives the other row. | Keep one row per code. |

**Cost Centre Master**

| Code | Meaning | How to fix |
|---|---|---|
| `INVALID_CODE` | The code does not match the format `IN-ENG-101`. | Use `<2 letters>-<2–6 letters/digits>-<3–4 digits>`. |
| `INVALID_ALIAS` | The alias is shorter than 2 or longer than 80 characters. | Shorten it or lengthen it. |
| `DUPLICATE_ALIAS` | The alias is used on another row of the file, or by **another** cost centre in the master. The message names the cost centre that uses it. | Choose a unique alias. To swap aliases between two cost centres, give one of them a temporary alias, publish, then upload again. |
| `INVALID_ENTITY` | The entity is not `IN`, `US` or `UK`. | Correct the entity. |
| `ENTITY_MISMATCH` | The code prefix does not match the entity, e.g. `US-ENG-201` with entity `IN`. | Correct the entity or the code. |
| `INVALID_TYPE` | The type is not `Direct`, `Shared` or `Allocated`. | Correct the type. |
| `INVALID_STATUS` | The status is not `Active` or `Inactive`. | Correct the status. |
| `INVALID_DATE` | `Start_Date` is blank or not a real date, or `Close_Date` is not a real date (e.g. 31/02/2026). | Use `YYYY-MM-DD` or `DD/MM/YYYY`. |
| `CLOSE_BEFORE_START` | `Close_Date` is earlier than `Start_Date`. | Correct one of the dates. |
| `INACTIVE_NEEDS_CLOSE` | The status is `Inactive` but `Close_Date` is blank. | Add the close date. |
| `ACTIVE_WITH_CLOSE` | The status is `Active` but `Close_Date` is filled in. | Clear `Close_Date`, or set the status to `Inactive` if the cost centre has closed. |

**Owner Mapping**

| Code | Meaning | How to fix |
|---|---|---|
| `UNKNOWN_CC` | The code is not in the published master. | Check the code for typos. If it is new, upload **and publish** the master file first. |
| `INACTIVE_WITH_OWNER` | The cost centre is Inactive, and an inactive cost centre cannot have an owner. | Remove the row, or reactivate the cost centre first (see [§10](#10-deactivate-or-reactivate-a-cost-centre)). |
| `MISSING_OWNER` (error) | `Owner_Name` or `Owner_Email` is blank. | Fill in both. |
| `NO_BACKUP_OWNER` | `Backup_Owner_Email` is blank. | Every cost centre needs a backup owner. |
| `BACKUP_SAME_AS_OWNER` | The backup owner email is the same as the owner email. | Name a different person. |
| `INVALID_EMAIL` | The value in `Owner_Email`, `Backup_Owner_Email` or `BU_Head_Email` is not a valid email address. | Correct the address. Look for spaces, missing `@` or a trailing `.`. |
| `EXTERNAL_DOMAIN` | The email is valid but not on an allowed company domain, e.g. a Gmail or client address. | Use the person's SolidPro Microsoft 365 address. |

**Budget & Actuals**

Completeness and size are checked for each **month and entity**: messages name both, e.g. `2026-10 (IN)`.

| Code | Meaning | How to fix |
|---|---|---|
| `UNKNOWN_CC` | The code is not in the cost centre master. | Check the code for typos. If it is new, upload **and publish** the master file first. |
| `INVALID_PERIOD` | `Period` is blank or not a month the portal recognises, e.g. `10/2026`, `Oct-26` or `2026-13`. | Use `YYYY-MM`, e.g. `2026-10`, or `Oct-2026`. |
| `INVALID_GL` | `GL_Group` is longer than 60 characters. | Use the short GL group name from the mapping. |
| `INVALID_AMOUNT` | `Budget` or `Actual` is not a number, e.g. text, `1,234 Dr`, `1234-` or `1.2E+06`, or it is 10 lakh crore (10^13) or more. | Enter a plain number. Enter credits as `-1234` or `(1,234)`. Check for a pasted account number or a missing decimal point. |
| `CC_CLOSED` | The cost centre closed (`Close_Date`) before this month, and the row has a non-zero `Actual`. | Post the cost to the right cost centre or month. A budget, or an actual of 0 or blank, is allowed. |
| `FUTURE_ACTUAL` | `Actual` is filled in, even with 0, for a month after the current calendar month. | Leave `Actual` blank for future months, or correct the `Period`. |
| `DUPLICATE_LINE` | The same cost centre, month and GL group appear on more than one row (the GL group is compared ignoring case and extra spaces). The message gives the other row. | Add the amounts together on one row. |
| `MISSING_ACTUAL` | The month has actuals on other rows **of the same entity**, but `Actual` is blank on this row. At most 20 rows are listed for each month and entity. | Enter `0`. |
| `WOULD_REMOVE_ACTUALS` (row `File`) | An entity's month in the file has no actuals at all, but that entity already has actuals for the month in the portal (in **Published periods**, or as actual figures). It is also raised for every entity of a month that still has a combined pre-Phase 3 register row. Publishing would remove them. | Leave that month out of the file for the entity, or include its actuals and enter its trial-balance total. |
| `INCOMPLETE_PERIOD` (row `File`) | For a month and entity in the file, the portal already has figures for cost centres **of that entity** that are not in the file. An upload replaces the whole month for each entity it contains, so publishing would delete their budgets and actuals. Other entities are not affected. | Include every cost centre of the entity for that month (use 0 where there is nothing to report). To correct one cost centre, re-upload the entity's full month. |
| `PERIOD_TOTAL_TOO_LARGE` (row `File`) | A month's budget or actual total for one entity is 10 lakh crore (10^13) or more, so it could never be reconciled to a trial balance. | Check for a pasted account number or a missing decimal point. |

**Allocations**

| Code | Meaning | How to fix |
|---|---|---|
| `UNKNOWN_CC` | `CC_Code` (receiving) or `Source_CC` is not in the cost centre master. The column shows which. | Check the code. Publish a new cost centre in the master first. |
| `SELF_ALLOCATION` | `CC_Code` and `Source_CC` are the same cost centre. | A cost centre cannot recharge itself. Remove the row. |
| `CROSS_ENTITY` | The source and the receiving cost centre are in different entities, e.g. `US-SSV-401` to `IN-ENG-101`. | Book it in Tally as an intercompany recharge, not as an allocation. |
| `INVALID_PERIOD` | `Period` is blank or not a month the portal recognises. | Use `YYYY-MM`, e.g. `2026-10`, or `Oct-2026`. |
| `FUTURE_ACTUAL` | The month is after the current calendar month. | Allocations are actual recharges: load them once the month has happened. |
| `INVALID_AMOUNT` | `Amount` is not a number, or it is 10 lakh crore (10^13) or more. | Enter a plain number; `-1234` or `(1,234)` for a reversal. |
| `ZERO_AMOUNT` | `Amount` is 0. | Leave the line out. |
| `INVALID_BASIS` | `Basis` is longer than 120 characters. | Shorten it, e.g. `Headcount (42 of 118)`. |
| `CC_CLOSED` | The receiving cost centre (column `CC_Code`) or the source (column `Source_CC`) closed before this month. | Allocate to an open cost centre, or correct the month. |
| `DUPLICATE_LINE` | The same receiving cost centre, month and source appear on more than one row. The message gives the other row. | Add the amounts together on one row. |

### Warnings (shown after validation; they do not block publishing)

| Code | File | Meaning | What to do |
|---|---|---|---|
| `NEEDS_OWNER` | Master | A **new** active cost centre has no owner mapping yet. | Publish the master, then upload its owner mapping. |
| `INACTIVE_WITH_OWNER` | Master | This row deactivates a cost centre that has an owner. The owner mapping will be **removed** when the file is published. | Expected when you close a cost centre. Check that this is intended. |
| `MISSING_OWNER` (warning, row `File`) | Owner Mapping | An active cost centre in the master still has no owner after this file is published. | Add a row for it now or in a later upload. It also appears under *Data quality exceptions*. |
| `BEFORE_START` | Budget & Actuals | The month is earlier than the cost centre's `Start_Date`. | Check the month, the code, or the start date in the master. |
| `NEW_GL_GROUP` | Budget & Actuals | No published line uses this GL group yet. It is shown once for each new GL group. | Check the Tally mapping for a typo, e.g. `Travel & Conveyence`. A genuinely new GL group is fine. |
| `DIRECT_SOURCE` | Allocations | The source cost centre is of type `Direct`. It is shown once for each such source. | Allocations normally come from `Shared` or `Allocated` cost centres. Check the source code. |
| `OVER_ALLOCATED` (row `File`) | Allocations | A run recharges more in the month than the source's recorded actual cost for that month. Not checked when the source has no actuals for the month. | Check the workings and the amounts. Load the source's actuals first if they are missing. |

### Messages without a code (the file was not processed)

| Message | Fix |
|---|---|
| *Only .xlsx or .csv files are accepted* | Save as Excel Workbook (`.xlsx`) or CSV UTF-8. |
| *File larger than 5 MB* or *Too many rows (max 5000)* (*max 60000* for Budget & Actuals) | Split the file into smaller uploads. Keep each entity's month of Budget & Actuals, and each allocation run, in one file, because each upload replaces what it contains. |
| *No file received* or *Invalid upload type* | Select the file and the upload type again, then retry. |

---

## 8. Reconcile to the trial balance

A month's actuals can be published only when, **for each entity**, the total of that entity's cost
centre actuals in the file equals the trial-balance (TB) total that the preparer enters for that entity
and month.

**Which TB total.** Take it from the entity's own Tally trial balance for the month, for the same ledgers that the
file covers: the P&L expense ledgers that are mapped to GL groups and allocated to cost centres.

- Use the month's **net movement** (debits less credits in the month), not the closing balance, which is year to date.
- Use the same sign convention as the file: expenses positive, credits negative.
- Use the **entity's own currency** (INR for India, USD for the US). Never combine entities or convert currencies.
  If the file holds several entities, the period table has one row, and one TB input, for each entity.

**Steps** (preparer, once the file shows **Validated**):

1. In the period table, type the TB total for every month and entity that has actuals. Budget-only rows show
   *No TB needed*. Commas and spaces are allowed; do not type currency symbols or brackets (use `-` for a negative).
2. Click **Reconcile to TB**. It becomes available when every row with actuals has a value.
3. Each row shows the **Difference** (CC actuals − TB) and **✓ Reconciled** or **✗ Does not match**.
   - The difference must be **0.00**, unless IT has set an approved tolerance (`RECON_TOLERANCE`, which applies to
     each month and entity, in the entity's currency).
   - If you mistyped the TB total, correct it and click **Reconcile to TB** again. The latest value counts, and every
     attempt is logged (`TB_ENTERED`, then `RECON_PASSED` or `RECON_FAILED`).
   - If the file is wrong, click **Discard**, correct the file and upload it again.
4. When every row is reconciled, the upload is ready for the approver.

Only the preparer who uploaded the file can enter the TB totals. The approver sees them, read-only, on the
approval card. If the preparer leaves the page before reconciling, the upload waits under **Awaiting approval**
with *Waiting for the preparer to reconcile it*, and the preparer can enter the TB totals on that card.

When the approver publishes, the portal reconciles every month and entity again in the same database transaction.
If one no longer reconciles, nothing is published, `RECON_FAILED` is logged and the upload stays awaiting approval.

### Troubleshoot a reconciliation difference

Look at the size and the sign of the difference first.

| What you see | Typical cause | Fix |
|---|---|---|
| Actuals are **lower** than the TB by the balance of one or a few ledgers | **Unmapped GL groups**: new or renamed Tally ledgers that are not in the mapping sheet, so their amounts are missing from the file | Map the ledgers to GL groups, add the lines and upload again |
| Actuals are **higher** than the TB | **Balance-sheet lines included**: e.g. fixed-asset purchases, advances, prepaid expenses, GST input or TDS that were allocated to cost centres | Remove the balance-sheet ledgers. The file and the TB total cover P&L expense ledgers only |
| The difference equals one cost centre's total | **Cost centre missing from the file**, or Tally entries that are not allocated to any cost centre | Add the missing lines. Allocate the entries in Tally (or agree how unallocated amounts are treated), then export again |
| The difference is about **twice** one amount | **Sign convention**: a credit (reversal, recovery, credit note) entered as positive, or a Dr/Cr column read the wrong way round | Enter credits as negative (`-1234` or `(1,234)`) |
| A difference of a few paise, cents or rupees | **Rounding**: one report was exported in whole units and the other with decimals. The portal rounds each line to 2 decimals | Export both with 2 decimals. Use a tolerance only if Finance has approved one and IT has set `RECON_TOLERANCE` |
| A large difference that matches earlier months' activity | The TB **closing balance** (year to date) was used instead of the month's movement | Use the month's net movement |
| A new difference after exporting again | Entries were posted to the month after the first export | Close the period in Tally, then export both reports again |
| The difference is roughly another entity's total, or looks like an exchange-rate effect | The TB total entered is a **combined** or another entity's total, or was converted to another currency | Enter each entity's own TB total, from its own Tally company, in its own currency |
| A cost centre's lines are in the wrong entity's row | The code prefix is wrong (e.g. a US cost centre coded `IN-…`) | Correct the code. The entity of each cost centre comes from the master |

`DUPLICATE_LINE` stops the same line from being loaded twice, but it cannot detect one ledger mapped to
two GL groups. If actuals are higher than the TB, check the mapping for that too.

**Messages during reconciliation and publishing**

| Message | Meaning |
|---|---|
| *Only the preparer who uploaded the file can enter the trial balance.* | Maker-checker. Ask the preparer, or discard the upload and upload the file yourself. |
| *2026-10 US has no actuals in this upload.* | A TB total was sent for a month and entity that is budget-only in the file. |
| *2026-10 has actuals for several entities (IN, US) — enter a trial balance for each entity.* | A TB total was sent for the month without saying which entity. The screen always sends one per entity, so this comes only from a direct API call. |
| *Enter a valid trial-balance total for 2026-10 US* or *Trial balance for 2026-10 US is too large.* | The TB total is not a number, or is 10 lakh crore (10^13) or more. |
| *This file is no longer valid against the current data (2 error(s)). Discard it and upload again.* | The master or the published figures changed after the file was validated. |
| *Publishing blocked: 2026-10 US differs from the trial balance by 400.* or *… has no trial balance entered.* | The approver tried to publish an upload that is not reconciled. The preparer must reconcile it, or discard it. |
| *Publishing blocked: 2026-10 US was published after this file was prepared. Discard it and upload a current file.* | Someone published a newer upload for the same month and entity. An older file can never overwrite it. |
| *Publishing blocked: the allocation run IN-SSV-302 2026-09 was published after this file was prepared. …* | The same for an Allocations upload: a newer file for that source and month was published first. |

---

## 9. Approve and publish, or discard

**3. Awaiting approval** lists every upload that is *Validated* but not yet published or discarded (the
latest 20). Each card shows:

- the upload type and file name;
- who uploaded it, when, and the number of rows;
- the first 12 characters of the file's **SHA-256** hash and the first 8 characters of the **batch id** (both in full in **Reports → Upload evidence register**);
- for the master and owner mapping, the *new / updated / unchanged* counts;
- for Budget & Actuals, the period table, one row per month and entity, with the TB totals, differences and status;
- for Allocations, the run table: month, source cost centre, receiving cost centres and total.

**Approve & publish** (approver):

- The button is disabled on your own uploads (*another Finance user must publish it*) and, for Budget &
  Actuals, until the preparer has reconciled every month and entity with actuals (*Waiting for the preparer to
  reconcile it*). The server and the database enforce both rules as well as the screen.
- Publishing is **all or nothing**: every row is saved in one database transaction, or none is.
- Before it saves anything, the portal **validates the file again against the current data**, in the same
  transaction. If something changed after validation (for example, another admin deactivated a cost centre
  that is in your owner file, or closed one that has actuals or allocations in your file), the upload is marked
  **Rejected** and the new errors are shown. Budget & Actuals uploads are also **reconciled again** (see [§8](#8-reconcile-to-the-trial-balance)).
- Publishing is refused if a newer upload for the same month and entity, or the same allocation run, was published
  after this one was prepared. Discard the older upload.
- **Master and owner mapping:** the audit log records each changed field with the approver's name and the
  upload's **batch id**. The changes take effect straight away in the Finder and in what users can access.
  If every row is *unchanged*, there is nothing to publish, so discard it.
- **Budget & Actuals:** every line of every month is replaced for each entity in the file ([§5](#5-prepare-the-budget--actuals-file)).
  Each month and entity with actuals is added to (or updated in) **Published periods** with its CC actuals total,
  TB total, approver and time; a combined pre-Phase 3 row for that month is removed. Every line added, changed or
  removed is kept with its old and new values (**Financial line changes** in the upload evidence register). The
  audit log records one `UPLOAD_PUBLISHED` event for the batch, with each month's and entity's totals before and
  after, and every change to the period register. Owners see the new figures in My Cost Centres straight away.
- **Allocations:** each run in the file is replaced ([§6](#6-prepare-the-allocations-file)). Every allocation removed
  and added is written to the audit log with the batch id; a re-published run shows every line as `DELETE` and
  `CREATE`, even the unchanged ones. Owners see the new allocations straight away.
- The approver is recorded as **Approved by** on the upload.

**Discard** throws a validated upload away without changing anything. The preparer or the approver can
discard it, from the upload panel or from the approval card. The upload is marked *Discarded* and the
discard is logged.

**Recent uploads** at the bottom of the Admin page lists the last 10 uploads, with their status
(*Awaiting approval, Rejected, Published* or *Discarded*) and **Approved by**.

If IT has turned maker-checker off (`UPLOAD_MAKER_CHECKER=false`, for demos and tests only), the upload panel
shows a **Publish** button and the preparer can publish their own upload.

---

## 10. Deactivate (or reactivate) a cost centre

You can **never** delete a cost centre. The database blocks deletion, even for administrators,
so its history, financials and audit trail are kept.

**To deactivate**, upload a master row for the cost centre with all fields as they are now, except:

- `Status` = `Inactive`
- `Close_Date` = the closing date, on or after `Start_Date`

Validation shows the `INACTIVE_WITH_OWNER` warning if the cost centre has an owner. When it is published:

- the cost centre **disappears from the Finder** straight away,
- its **owner mapping and any per-cost-centre access grants are removed**, so the owner, backup and BU head named in the mapping lose access to it (Finance, Management and BU-wide BU heads still see it in My Cost Centres, marked *Inactive*, while it has figures in the fiscal year),
- its budget, actuals, allocations and explanations are kept. Later Budget & Actuals files cannot give it non-zero actuals after the close month, and later Allocations files cannot use it as receiving or source cost centre after the close month (`CC_CLOSED`), and
- the audit log records a `DEACTIVATE` entry for the cost centre and a `DELETE` entry for the removed owner mapping, both tagged with the batch id. The old owner details stay in the audit log.

**To reactivate**, upload the row with `Status` = `Active` and an **empty** `Close_Date`. The audit
log records `REACTIVATE`. The owner mapping is **not** restored, so upload a new owner mapping
for the cost centre afterwards.

---

## 11. Variance explanations

**Who can explain a variance.** The cost centre's owner, backup owner and BU head (named in the owner mapping, or
holding a BU-wide BU-head grant), and Finance. Management can read every explanation but cannot add one.
Employees see none.

**What can be explained.** An explanation belongs to one cost centre, one month and one GL group, and can be
added only once that month's actuals are published for the line. A line is flagged when its year-to-date variance
is more than ±10% of budget; a flagged line with no explanation for the selected month is marked
**Explanation needed** (only people who can add an explanation see the marker). Explanations are 1 to 2,000
characters, are visible to everyone who can see the cost centre, appear in the cost centre's Excel export
(*Variance explanations* sheet), and are recorded in the audit log (`COMMENT`). They **cannot be edited or
deleted**: to correct one, add a new explanation.

**How owners add one.** **My Cost Centres** → open the cost centre → choose the month under **As of** →
**Variance explanations** → choose the GL group → describe what caused the variance and whether it is one-off or
expected to continue → add it.

A line that stays flagged needs a **new explanation each month**: an explanation for September does not count for October.

**How Finance monitors coverage.** Open **Reports → Variance commentary coverage**:

- Choose the **month**. The default is the latest month every entity has closed. If you choose a later month that
  only some entities have published, the lines of an entity that has not closed it look under budget and are
  counted as flagged.
- The tiles show the flagged lines (|YTD variance| > 10%), how many are explained (at least one explanation for the
  month), how many are not, and the coverage %. A table shows coverage by BU.
- The lines table shows each flagged line with its owner, YTD budget, actual and variance in the entity's currency,
  and the latest explanation. Filter by **Business unit** or tick **Unexplained only** to chase owners.
- Finance can add an explanation itself, e.g. for a variance caused by a posting error that Finance will correct.
  It is recorded under the Finance user's own name.
- Before the month is signed off, export the report (*Flagged lines* and *Coverage by BU* sheets) and file it with
  the month's evidence ([§1 D](#d-variance-commentary-and-sign-off)).

---

## 12. Reports, the audit log and upload evidence

**Reports** is for Finance only. Open it from the top menu or with **Reports & audit** on the Admin page. Each
report has filters and **Export** (Excel). Every export is recorded in the audit log as `EXPORT` (entity
`report`, with the filters and the number of rows). Each workbook states the filters, who generated it and when,
and *Internal use only*. An export holds at most **50,000 rows per sheet**, and says so when it was cut off: narrow
the filters. **All times in the reports are UTC.**

| Report | Use it for | Filters | Export sheets |
|---|---|---|---|
| **Audit log** | Every master-data change, upload step, sign-in, explanation and export | From and To (UTC, inclusive), user email contains, action (one or more), entity, entity id contains | *Audit log* |
| **Upload evidence register** | One row per upload, as audit evidence | Uploaded from and to (UTC), type, status | *Register*, *Reconciliation*; for one batch, an evidence workbook |
| **User access review** | The quarterly access review ([§13](#13-quarterly-user-access-review)) | User email contains, role, business unit, exceptions only | *Summary*, *Exceptions*, *Access rights* |
| **Variance commentary coverage** | Month-end commentary ([§11](#11-variance-explanations)) | Month, business unit, unexplained only | *Flagged lines*, *Coverage by BU* |
| **Failed searches** | Keyword maintenance ([§14](#14-use-the-failed-searches-report-to-add-keywords)) | From and To (UTC); the default is the last 90 days, and an empty From means all time | *Terms*, *Searches* |

### Review the audit log

**Reports → Audit log** shows the matching events newest first, 50 per page, with each change listed field by
field (*field: old → new*). Events containing `DENIED`, `REJECTED` or `FAILED`, and `DEACTIVATE` and `DELETE`, are shown in red.

| Action | Recorded when | Detail |
|---|---|---|
| `CREATE` / `UPDATE` / `DELETE` | A cost centre, owner mapping, access grant, allocation or period register row is added, changed or removed | The *Entity* is the table (`cost_centres`, `cc_owners`, `cc_access`, `allocations`, `periods`). Old and new values; updates show **only the fields that changed**. |
| `DEACTIVATE` / `REACTIVATE` | A cost centre's status changes | Old and new status and close date |
| `LOGIN` / `LOGOUT` | Someone signs in or out | Sign-in provider; logout reason (signed out or idle timeout) |
| `LOGIN_DENIED` | Someone signs in with an account outside the allowed domain or tenant | Email and provider |
| `ACCESS_DENIED` | A non-Finance user calls an admin or report API; someone opens or exports a cost centre that they may not see or that does not exist; or someone tries to explain a variance on a cost centre they do not answer for | User; for a cost centre, the code that was requested |
| `TEMPLATE_DOWNLOAD` | A template is downloaded | Template type |
| `UPLOAD_VALIDATED` / `UPLOAD_REJECTED` | A file is validated, or is rejected when it is validated again at publish | File name, row count, error count |
| `TB_ENTERED` | The preparer enters or changes trial-balance totals | TB total for each month and entity |
| `RECON_PASSED` / `RECON_FAILED` | After each TB entry. `RECON_FAILED` is also logged when a publish is blocked (`"stage": "publish"`) | For each month and entity: currency, CC actuals, TB total, difference, matched |
| `UPLOAD_PUBLISHED` / `UPLOAD_DISCARDED` | A validated file is published or discarded | Master and owner mapping: counts of new, updated and unchanged rows. Budget & Actuals: for each month and entity, rows, cost centres, budget and actual totals, the reconciliation, the totals before the publish (`before`) and the number of lines changed (`changedLines`). Allocations: the runs and the number of lines created and removed |
| `COMMENT` | Someone adds a variance explanation | Cost centre, month, GL group and the text |
| `EXPORT` | Someone exports a cost centre from My Cost Centres, or a report | Cost centre and *As of* month; or the report, its filters and the number of rows |

Upload events carry the full **batch id** (entity `upload_batch`). Every master-data, allocation and period-register
change made by a publish carries the same batch id, so you can trace it back to the exact file: the batch page in the
upload evidence register lists them all. The audit log is **append-only**: no one can edit or delete entries through
the application. The database rejects edits and deletions even from administrators.

### Upload evidence register

**Reports → Upload evidence register** lists every upload, newest first, 50 per page: when and by whom it was
uploaded, type and file, status, rows, errors and warnings, who approved and published it and when, the
**segregation-of-duties** check, and the reconciliation for each month and entity. A tile counts the
segregation-of-duties violations in the selection.

| Segregation of duties | Meaning |
|---|---|
| ✓ Different approver | Published by someone other than the uploader |
| ✗ Uploader approved own file | Published by the uploader: investigate (possible only with maker-checker turned off) |
| System seed | Demo data loaded by the system, not a person |
| Awaiting approval / Not published | Validated and waiting, or rejected or discarded |

Open a batch to see its **evidence**: the full batch id and SHA-256, uploader, approver and times; the trial-balance
reconciliation for each month and entity, with who entered each TB total and when; the stored errors and warnings;
the **audit trail** (every upload step and every change the batch made); and, for Budget & Actuals, the **financial
line changes** (every line added, changed or removed, old → new; the first 500 on screen, all of them in the export).
**Export** on the batch page gives the evidence workbook (*Batch*, *Reconciliation*, *Errors*, *Warnings*, *Audit
trail*, *Line changes*). Uploads published before Phase 3 show their reconciliation from the period register.

**Using it as audit evidence.** Each month, export the register for the month's uploads and file it. For uploads an
auditor samples, provide the batch evidence workbook and the original file from the evidence folder. The auditor can
then agree the SHA-256 to the file (see [§15](#15-internal-control-notes)), the uploader and approver, each TB total
to the entity's Tally trial balance, and the line changes to the source.

---

## 13. Quarterly user access review

Run this review every quarter, and whenever an auditor asks. It certifies that every person who can see cost centre
figures, explain variances or administer the portal still needs that access.

1. **Export.** Open **Reports → User access review** and click **Export**. The workbook has a *Summary* (users per role),
   the *Exceptions* (checked across all access, whatever the filters) and *Access rights*: one row per access right,
   from the owner mapping (owner, backup owner, BU head of a cost centre) and from explicit grants (Finance, Management,
   BU-wide BU head, per-cost-centre grants), with its source, who granted it and when, any exceptions, and empty
   **Certified (Y/N)** and **Reviewer comment** columns. For owner-mapping rows, *granted* is the last change to that
   cost centre's mapping.
2. **Send for certification.** Send each BU head the rows of their BU (filter by business unit before exporting;
   company-wide Finance and Management grants are included under every BU filter), and send the Finance, Management
   and BU-wide grants to the CFO or the Financial Controller. Reviewers mark each row **Y** (keep) or **N** (remove),
   add a comment where needed, and return the file to Finance.
3. **Resolve the exceptions.**

   | Exception | What to do |
   |---|---|
   | Finance + owner (SoD) | A Finance user owns or backs up cost centres, so could prepare figures for cost centres they are accountable for. Name another owner or backup, or record why it is accepted (another Finance user still approves every upload). |
   | Owner = BU head / Backup = BU head | Nobody independent reviews the cost centre. Name a different owner, backup or BU head. |
   | Inactive cost centre | A grant remains on a closed cost centre. Remove it. |
   | External email | Access is held by an address outside the allowed company domains. Remove it. |

4. **Remove access.** For owner, backup and BU-head rights from the owner mapping, upload a corrected **Owner Mapping**
   file (maker-checker applies). For explicit grants in `ccp.cc_access` (Finance, Management, BU-wide BU head,
   per-cost-centre grants), raise a change request; IT revokes the grant with the SQL in the README (*Granting roles*).
   Both are recorded in the audit log.
5. **Evidence the result.** When the changes are published, export the review again as the *after* copy. Keep the
   exported review, the reviewers' certifications (returned workbooks or emails), the change requests and the *after*
   export in the Finance evidence folder for the retention period ([§15](#15-internal-control-notes)). The exports
   themselves are logged as `EXPORT`.

---

## 14. Use the failed-searches report to add keywords

When an employee's search finds nothing, the portal records the search term. Go to
**Reports → Failed searches**. It shows the last 90 days by default; clear **From** for all time. It shows:

| Column | Meaning |
|---|---|
| Search term | What was typed, in lower case. Each keystroke is not stored separately: searches by the same person within 2 minutes that are longer or shorter versions of the same text (*chen*, *chen d*, *chen des*) count as one search, stored as the longest term. Terms of 1 character are ignored. |
| Searches | How many times the term was searched. |
| Users | How many different people searched for it. |
| First seen / Last seen | The first and most recent search (UTC). |

The **Failed searches (30 days)** tile on the Admin page turns red when there are any.

To act on the report:

1. Work out which cost centre the person was looking for. If the term is unclear, ask the BU or
   the cost centre owner.
2. Add the term, or a better word, to that cost centre's `Keywords` in a master file. Remember that
   the row must be complete, with all columns.
3. Validate it and have it approved and published, then search for the term in the Finder to confirm
   that the cost centre is found.
4. If no cost centre fits, the person may need a new cost centre, or guidance on which one to use.

---

## 15. Internal-control notes

**Segregation of duties**

- Only the **Finance** role can change master data or load financials and allocations. Database row-level
  security enforces this, so it does not depend on the screens. Management, BU heads, owners and employees have
  read-only access to figures; owners, backup owners and BU heads can add variance explanations.
- **Maker-checker is enforced by the portal and by the database** for all four upload types, and is on by default:
  - the preparer uploads and validates the file. For Budget & Actuals, only the preparer can enter the
    TB totals, and the database records the signed-in user as the person who entered them;
  - a **different** Finance user must approve and publish it. The server refuses a publish by the uploader,
    comparing signed-in identities (upper or lower case does not matter), and a database trigger refuses it too;
  - either of them can discard it.
- The approver is accountable for the review, not only the click: check the SHA-256 against the evidence
  file, the counts, run totals or period totals, and each TB total against the entity's Tally trial balance.
  After publishing, check the batch in the upload evidence register.
- **Keep at least two active Finance users.** With maker-checker on, one Finance user alone cannot publish
  anything. Arrange cover for leave rather than turning maker-checker off. `UPLOAD_MAKER_CHECKER=false`
  exists for single-user demos and tests. Turning it off in Production is an IT change that Finance must approve.
- These rules do not cover changes that IT makes directly in the database with the owner credentials. Keep those
  to approved change requests.
- **Roles are granted by IT**, through a controlled database change, not by Finance through the
  portal. IT records the change and Finance approves it. The audit log records role grants as
  changes to `cc_access`. The quarterly user access review ([§13](#13-quarterly-user-access-review)) certifies them.
- Owner, backup and BU-head access comes from the owner mapping. Keep it current, especially for
  **leavers**. A leaver whose Microsoft 365 account is disabled cannot sign in again. Their open
  session ends within 30 minutes of inactivity, and in any case after 10 hours. Still replace
  them as owner in the next owner mapping upload.

**Evidence retention**

- Every upload is stored as a **batch** with a unique **batch id**. The batch records:
  - the file name,
  - the **SHA-256 hash of the exact file uploaded**,
  - who uploaded it and when,
  - its status, row count and error count,
  - the parsed rows, the error report, the warnings and the summary (new/updated/unchanged; for Budget & Actuals the totals and reconciliation for each month and entity; for Allocations the runs),
  - for a published file, who **approved** and published it (`approved_by`, `published_by`) and when.
- For Budget & Actuals, the portal also keeps:
  - the **TB total for each month and entity**, with who entered it and when (`ccp.trial_balances` holds the latest value; every value entered is also in the audit log as `TB_ENTERED`),
  - the **Published periods** register (`ccp.periods`): for each month and entity with actuals, the CC actuals total, TB total, batch id, who published it and when. Every change to the register is audited,
  - every **financial line** each publish added, changed or removed, with the old and new values (`ccp.financials_history`, append-only),
  - the `UPLOAD_PUBLISHED` event, with each month's and entity's totals before and after.
- Every allocation added or removed, and every variance explanation, is in the audit log. Explanations themselves can never be changed.
- Keep the original files with the approved change requests, the Tally trial balances and cost centre reports for each
  entity, the allocation workings and the GL mapping sheet in the Finance evidence folder. An auditor can prove that a
  stored file is the one that was loaded by comparing its hash with the SHA-256 in the upload evidence register:
  - Windows: `certutil -hashfile <file> SHA256`
  - macOS/Linux: `shasum -a 256 <file>`
- The portal never purges the audit log, the upload history, the trial-balance entries, the period register, the
  line history or the explanations. Keep them, the exported reports and access reviews, and the evidence folder, for at
  least the statutory retention period for books of account under the company's record-retention policy (8 years
  under s.128(5) of the Companies Act, 2013).

**Other controls built into the portal**

- **No deletion:** a cost centre can only be deactivated, so its history is kept.
- **All-or-nothing uploads**, so a master, an entity's month or an allocation run can never be partly loaded.
- Every file is **validated again at publish** against the current data, and Budget & Actuals are **reconciled again**.
  An older file can never overwrite a month, entity or allocation run published after it was prepared.
- **Actuals cannot be published unless each entity reconciles to its own trial balance**, and cannot be posted to a future
  month or to a closed cost centre. Amounts stay in each entity's currency and are never added across currencies.
- **Variance explanations** are permanent, signed with the author's identity and audited.
- **Sign-in** uses company Microsoft 365 accounts only. There is no self-registration and there are no passwords.
- **Sessions** end after 30 minutes of inactivity and always after 10 hours.

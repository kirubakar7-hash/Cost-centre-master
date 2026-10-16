# Finance Admin Guide: SolidPro Cost Centre Portal

This guide is for users who hold the **Finance** role. Only the Finance role can see
**Admin** in the top menu, change cost centre master data or load budget and actuals.
The database enforces this as well as the screens.

Every upload needs two people (**maker-checker**, on by default):

- the **preparer** uploads and validates the file and, for Budget & Actuals, enters the trial-balance total;
- the **approver**, a *different* Finance user, reviews it under **Awaiting approval** and publishes it.

The **Admin** page has these sections:

| Section | Who uses it | What it is for |
|---|---|---|
| **1. Download a template** | Preparer | The three Excel templates ([§2](#2-download-the-templates)) |
| **2. Upload & validate (preparer)** | Preparer | Upload, read the error report, enter the trial balance ([§6](#6-read-the-error-report), [§7](#7-reconcile-to-the-trial-balance)) |
| **3. Awaiting approval (checker)** | Approver | Review, then **Approve & publish** or **Discard** ([§8](#8-approve-and-publish-or-discard)) |
| **Published periods** | Both | The latest 12 months with published actuals: CC actuals, trial balance, status, who published and when |
| **Data quality exceptions** | Both | Active cost centres with no owner or no keywords |
| **Recent uploads** | Both | The last 10 uploads, with status and **Approved by** |

Contents

1. [Monthly SOP checklist](#1-monthly-sop-checklist)
2. [Download the templates](#2-download-the-templates)
3. [Prepare the Cost Centre Master file](#3-prepare-the-cost-centre-master-file)
4. [Prepare the Owner Mapping file](#4-prepare-the-owner-mapping-file)
5. [Prepare the Budget & Actuals file](#5-prepare-the-budget--actuals-file)
6. [Upload and read the error report](#6-read-the-error-report)
7. [Reconcile to the trial balance](#7-reconcile-to-the-trial-balance)
8. [Approve and publish, or discard](#8-approve-and-publish-or-discard)
9. [Deactivate (or reactivate) a cost centre](#9-deactivate-or-reactivate-a-cost-centre)
10. [Use the failed-searches report to add keywords](#10-use-the-failed-searches-report-to-add-keywords)
11. [Review the audit log](#11-review-the-audit-log)
12. [Internal-control notes](#12-internal-control-notes)

---

## 1. Monthly SOP checklist

Run checklist **A** after month-end close and whenever a cost centre or an owner changes. Run
checklist **B** every month once the books in Tally are closed. When you need both, publish the
master first, because a Budget & Actuals file can use only cost centres that are already in the master.

### A. Cost centre master and owners

**Prepare (preparer)**

- [ ] Collect the approved change requests: new cost centres, closures, alias or keyword changes, and owner, backup or BU-head changes. Include movers and leavers from the HR report.
- [ ] Open **Admin → Audit log & failed searches**. Note any failed search terms that should become keywords (see [§10](#10-use-the-failed-searches-report-to-add-keywords)).
- [ ] Open **Admin** and clear the **Data quality exceptions** list. It shows active cost centres with no owner and active cost centres with no keywords.
- [ ] Download fresh templates from **Admin → 1. Download a template**.
- [ ] Fill in the **master** file. Include only the rows that are new or changed, and give every column for each row (see [§3](#3-prepare-the-cost-centre-master-file)).
- [ ] Fill in the **owner mapping** file for new cost centres and owner changes (see [§4](#4-prepare-the-owner-mapping-file)).
- [ ] Upload the **master** file under **Admin → 2. Upload & validate**. Fix and re-upload until it shows **Validated**. It then waits under **3. Awaiting approval**.

**Approve (approver: a different Finance user; the portal enforces this)**

- [ ] Under **3. Awaiting approval**, check that the *new / updated / unchanged* counts and the warnings match the change requests, then click **Approve & publish**.
- [ ] The preparer then uploads the **owner mapping** file, which must come *after* the master is published. The approver checks the counts and publishes it.
- [ ] Search for two or three of the changed cost centres in the **Cost Centre Finder** to confirm that the code, alias and owner are correct.

### B. Monthly close: Budget & Actuals

**Prepare (preparer)**

- [ ] Make sure nothing more will be posted to the month in Tally (close or lock the period), so the figures cannot move after you export them.
- [ ] Export two reports from Tally for the month: the **cost-centre-wise breakdown of the expense ledgers**, and the **trial balance** showing the month's movement (not the year-to-date closing balance).
- [ ] Map every Tally ledger or group in scope to its portal **GL group**, using Finance's GL mapping sheet. Add new or renamed ledgers to the mapping before you go on.
- [ ] Fill in the **Budget & Actuals** file for the month: one row per cost centre and GL group, with the month's **Budget** and **Actual** (see [§5](#5-prepare-the-budget--actuals-file)). Start from the month's budget lines so that none is lost, because an upload replaces the whole month.
- [ ] Work out the **trial-balance total** that the file must equal (see [§7](#7-reconcile-to-the-trial-balance)).
- [ ] Upload the file under **Admin → 2. Upload & validate** with Upload type **Budget & Actuals**. Fix and re-upload until it shows **Validated**. Read every warning: `NEW_GL_GROUP` often means a mapping typo.
- [ ] **Without leaving the page**, enter the trial-balance total for the month and click **Reconcile to TB**. The difference must be 0.00. If it is not, see [Troubleshoot a reconciliation difference](#troubleshoot-a-reconciliation-difference).
- [ ] Save the Tally trial balance, the Tally cost centre report, the uploaded file and the mapping sheet in the Finance evidence folder, then tell the approver.

**Approve (approver: a different Finance user)**

- [ ] Under **3. Awaiting approval**, check the uploader, the file name and the **SHA-256** (against the file in the evidence folder). For each month, check the rows, cost centres, budget total, CC actuals total, trial-balance total and **✓ Reconciled**.
- [ ] Agree the trial-balance total to the Tally trial balance in the evidence folder, then click **Approve & publish**.

**Verify (approver)**

- [ ] **Admin → Published periods** lists the month with *CC actuals* equal to *Trial balance*, **✓ Reconciled**, and your name under *Published by*.
- [ ] **Recent uploads** shows the upload as *Published*, with your name under **Approved by**.
- [ ] Open **My Cost Centres**, choose the month under **As of**, and agree two or three cost centres to the Tally cost centre report.
- [ ] Tell the cost centre owners that the month is available. The portal does not send notifications.

### Evidence and review (every month)

- [ ] Save the uploaded files and the signed-off change requests in the Finance evidence folder, named with the upload date and file name (see [§12](#12-internal-control-notes)).
- [ ] Review this month's audit log: check every `UPLOAD_PUBLISHED` against a change request or the month's close, check every `RECON_FAILED`, and look at `LOGIN_DENIED` and `ACCESS_DENIED` events.
- [ ] Each quarter, ask IT for the list of Finance, Management and BU-head grants, and confirm that each one is still needed.

---

## 2. Download the templates

Go to **Admin → 1. Download a template**:

| Button | File | Use |
|---|---|---|
| Cost Centre Master | `SolidPro_CC_Master_Template.xlsx` | Create or update cost centres, or deactivate them |
| Owner Mapping | `SolidPro_CC_Owner_Mapping_Template.xlsx` | Assign the owner, backup owner and BU head |
| Budget & Actuals | `SolidPro_CC_Financials_Template.xlsx` | Load the annual budget and each month's actuals, by cost centre and GL group |

Every download is recorded in the audit log (`TEMPLATE_DOWNLOAD`). Each workbook has:

- A **data sheet** (`CC_Master`, `Owner_Mapping` or `Financials`) with a blue, frozen header row and **no data rows** — enter yours under the header. Example rows are on the Instructions sheet only, so an unchanged template is rejected as empty.
- A note on each header cell that gives the rule. Hover over the header to read it.
- An **Instructions** sheet that lists the same rules.
- Cells formatted as **Text**, so that Excel does not change `IN-ENG-101` or dates.

**General file rules**

- `.xlsx` or UTF-8 `.csv` only (no `.xls`), with a maximum of **5 MB**. The master and owner mapping allow up to **5,000** data rows, and Budget & Actuals up to **60,000**.
- Keep the header names exactly as they are. They are **case-sensitive** (`CC_Code`, not `cc code`). You can reorder columns, extra columns are ignored, and blank rows are skipped.
- For `.xlsx`, the portal reads the sheet named `CC_Master`, `Owner_Mapping` or `Financials`. If there is no sheet with that name, it reads the first sheet.
- **A master or owner mapping upload adds or updates the rows it contains. Rows that are not in the file are left unchanged.** You can upload only the rows that changed. These uploads never delete anything.
- **A Budget & Actuals upload replaces whole months** (see [§5](#5-prepare-the-budget--actuals-file)).

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
| `Entity` | Yes | `IN`, `US` or `UK`, and it must match the code prefix (`IN-…` must be `IN`). |
| `BU` | Yes | Business unit, e.g. `Engineering`, `Shared Services`, `Sales`. Use the exact same spelling every time, because BU-head access is matched on this text. |
| `Department` | Yes | Free text. |
| `Type` | Yes | `Direct`, `Shared` or `Allocated` (any upper or lower case). |
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

**This file also controls access.** The owner and the backup can see that cost centre's
budget and actuals in **My Cost Centres**, and the BU head named here can see it too.
Access changes as soon as the file is published. Use the email address that the person signs
in with (their Microsoft 365 address). Upper or lower case does not matter.

---

## 5. Prepare the Budget & Actuals file

Each row holds the budget and actual of one cost centre, for one month and one GL group.
One file may hold several months: for example, a month of actuals, or a full-year budget.

| Column | Required | Rule |
|---|---|---|
| `CC_Code` | Yes | Must exist in the master. Inactive cost centres are accepted, but not with actuals after the month they closed. Publish a new cost centre in the master first. |
| `Period` | Yes | The month as `YYYY-MM`, e.g. `2026-10`. Also accepted: an Excel date such as `2026-10-01` (the day is ignored), or a month name with a 4-digit year: `Oct-2026`, `Oct 2026`, `October 2026`. `10/2026`, `2026/10` and `Oct-26` are rejected. |
| `GL_Group` | Yes | The GL group from Finance's Tally mapping, e.g. `Employee Costs`, up to 60 characters. Extra spaces are removed and upper or lower case does not matter, but use the same spelling every month: a new spelling is a new GL group. |
| `Budget` | Yes (every row) | The month's budget for the line. **Enter 0 when there is no budget** — a blank cell is rejected (`REQUIRED`), because the upload replaces the whole month and a blank would wipe the budget. |
| `Actual` | Yes (column) | The month's actual. **Blank means "no actual yet"** and is allowed only in budget-only (future) months. In a month that has any actuals, every row needs an actual: enter `0`, not blank. |

**Amounts.** Commas and spaces are ignored, so Indian grouping (`1,23,456.78`) and Western grouping
(`123,456.78`) both work. Currency symbols (`₹ $ £ €`) and a leading `INR`, `USD` or `GBP` are
removed. Enter negatives (credits) as `-1234` or `(1,234)`. Each amount is rounded to 2 decimal
places. `Dr`/`Cr` suffixes, trailing minus signs (`1234-`) and scientific notation (`1.2E+06`) are rejected.

**One upload replaces whole months.** When the file is published, every existing line of
**every month in the file** is deleted, **for all cost centres**, and replaced by the lines in the file.
Months that are not in the file are not touched. So:

- include every cost centre and GL group that has a budget or an actual in the month, with both its budget and its actual (`0` where there is none);
- a cost centre or GL line that is missing from the file disappears from that month, together with its budget;
- the budget of a month that you load actuals for is whatever the file says, so copy it from the budget. Do not leave it blank.

**Months with actuals** must reconcile to the trial balance before they can be published
([§7](#7-reconcile-to-the-trial-balance)). **Budget-only months**, where every `Actual` is blank,
need no trial balance.

Other rules:

- One row per cost centre, month and GL group.
- No actuals (not even `0`) for a month after the current calendar month.
- No non-zero actual for an inactive cost centre after the month of its `Close_Date`. A budget is allowed.
- A month earlier than the cost centre's `Start_Date` gives a warning, not an error.

### Load the annual budget (budget-only months)

Load the budget before the fiscal year starts (April, unless IT has changed `FY_START_MONTH`):

1. Prepare one file with all 12 months of the year: one row per cost centre, GL group and month, with
   `Budget` filled in and `Actual` **blank**. For example, 100 cost centres × 6 GL groups × 12 months
   is 7,200 rows, well under the 60,000-row limit.
2. Upload and validate it. The period table shows each month as **Budget only**, with *No TB needed*.
3. The approver publishes it. There is no reconciliation step.
4. Check **My Cost Centres**: *Full-year budget* shows the year's budget. Budget-only months do not
   appear in **Published periods**, which lists only months with actuals.

To **revise** the budget for later months, upload those months again, complete. A budget-only row for a
month that already has published actuals is rejected (`WOULD_REMOVE_ACTUALS`), so leave closed months out
of a budget revision, or include their actuals and trial-balance totals.

You can combine months in one file. For example, a file with October actuals and a revised budget for
November to March needs a trial-balance total for October only.

### Correct a published month

You cannot edit single lines. To correct a month that is already published:

1. Correct the source (Tally or the GL mapping), and prepare the **complete** month again: every cost
   centre and GL group, with budget and actual.
2. Upload it, enter the trial-balance total, reconcile, and have a different Finance user approve it,
   as in the monthly close ([§1 B](#b-monthly-close-budget--actuals)).
3. When it is published, the corrected file replaces every line of that month. **Published periods**
   shows the new totals, the approver and the time, and the `UPLOAD_PUBLISHED` audit event records the
   month's totals before and after.

A month with published actuals cannot be turned back into a budget-only month through the portal.

---

## 6. Read the error report

To upload a file:

1. Go to **Admin → 2. Upload & validate (preparer)**.
2. Choose **Upload type** (*Cost Centre Master*, *Owner Mapping* or *Budget & Actuals*) and select the file.
3. Click **Validate**. Validation saves nothing to the master or to the financials.

The portal then shows one of two results:

- **Rejected**: the file has at least one error, and nothing was saved. The table lists every
  problem, with **Row** (the Excel row number, where the header is row 1, or `File` for a problem
  with the whole file), **Column**, **Severity** and the message with its code in brackets.
  Fix **all** errors in your file and upload it again.
- **Validated**: the file has no errors. For the master and owner mapping, the portal shows how many
  rows are *new*, *updated* and *unchanged*. For Budget & Actuals, it shows a table with one line per
  month: rows, cost centres, budget total and CC actuals total (*Budget only* for a budget-only month).
  It also lists any **warnings**. Warnings do not block publishing, but read them.

A validated upload waits under **3. Awaiting approval** until a different Finance user publishes it
or someone discards it ([§8](#8-approve-and-publish-or-discard)). A Budget & Actuals upload with actuals
must first be reconciled by the preparer ([§7](#7-reconcile-to-the-trial-balance)).

### Errors (any error rejects the whole file)

**All file types**

| Code | Meaning | How to fix |
|---|---|---|
| `MISSING_COLUMN` | A required column header is missing or misspelt. Headers are case-sensitive. | Download the latest template and copy your data into it, or correct the header. |
| `EMPTY_FILE` | There are no data rows under the header. | Add rows. Check that you selected the right file and sheet. |
| `REQUIRED` | A required value is blank: `CC_Code` in every file; in the master file, also `CC_Alias`, `BU` or `Department`; in Budget & Actuals, also `GL_Group` and `Budget` (enter 0 for no budget). | Fill in the cell. |
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
| `INACTIVE_WITH_OWNER` | The cost centre is Inactive, and an inactive cost centre cannot have an owner. | Remove the row, or reactivate the cost centre first (see [§9](#9-deactivate-or-reactivate-a-cost-centre)). |
| `MISSING_OWNER` (error) | `Owner_Name` or `Owner_Email` is blank. | Fill in both. |
| `NO_BACKUP_OWNER` | `Backup_Owner_Email` is blank. | Every cost centre needs a backup owner. |
| `BACKUP_SAME_AS_OWNER` | The backup owner email is the same as the owner email. | Name a different person. |
| `INVALID_EMAIL` | The value in `Owner_Email`, `Backup_Owner_Email` or `BU_Head_Email` is not a valid email address. | Correct the address. Look for spaces, missing `@` or a trailing `.`. |
| `EXTERNAL_DOMAIN` | The email is valid but not on an allowed company domain, e.g. a Gmail or client address. | Use the person's SolidPro Microsoft 365 address. |

**Budget & Actuals**

| Code | Meaning | How to fix |
|---|---|---|
| `UNKNOWN_CC` | The code is not in the cost centre master. | Check the code for typos. If it is new, upload **and publish** the master file first. |
| `INVALID_PERIOD` | `Period` is blank or not a month the portal recognises, e.g. `10/2026`, `Oct-26` or `2026-13`. | Use `YYYY-MM`, e.g. `2026-10`, or `Oct-2026`. |
| `INVALID_GL` | `GL_Group` is longer than 60 characters. | Use the short GL group name from the mapping. |
| `INVALID_AMOUNT` | `Budget` or `Actual` is not a number, e.g. text, `1,234 Dr`, `1234-` or `1.2E+06`, or it is 10 lakh crore (10^13) or more. | Enter a plain number. Enter credits as `-1234` or `(1,234)`. Check for a pasted account number or a missing decimal point. |
| `CC_CLOSED` | The cost centre closed (`Close_Date`) before this month, and the row has a non-zero `Actual`. | Post the cost to the right cost centre or month. A budget, or an actual of 0 or blank, is allowed. |
| `FUTURE_ACTUAL` | `Actual` is filled in, even with 0, for a month after the current calendar month. | Leave `Actual` blank for future months, or correct the `Period`. |
| `DUPLICATE_LINE` | The same cost centre, month and GL group appear on more than one row (the GL group is compared ignoring case and extra spaces). The message gives the other row. | Add the amounts together on one row. |
| `MISSING_ACTUAL` | The month has actuals on other rows, but `Actual` is blank on this row. At most 20 rows are listed for each month. | Enter `0`. |
| `WOULD_REMOVE_ACTUALS` (row `File`) | A month in the file has no actuals at all, but that month already has actuals in the portal (it is in **Published periods**, or holds actual figures). Publishing would remove them. | Leave the month out of the file, or include its actuals and enter its trial-balance total. |
| `INCOMPLETE_PERIOD` (row `File`) | The file covers a month that already has figures for cost centres that are not in the file. An upload replaces the whole month, so publishing would delete their budgets and actuals. | Include every cost centre for that month (use 0 where there is nothing to report). To correct one cost centre, re-upload the full month. |
| `PERIOD_TOTAL_TOO_LARGE` (row `File`) | A month's budget or actual total is 10 lakh crore (10^13) or more, so it could never be reconciled to a trial balance. | Check for a pasted account number or a missing decimal point. |

### Warnings (shown after validation; they do not block publishing)

| Code | File | Meaning | What to do |
|---|---|---|---|
| `NEEDS_OWNER` | Master | A **new** active cost centre has no owner mapping yet. | Publish the master, then upload its owner mapping. |
| `INACTIVE_WITH_OWNER` | Master | This row deactivates a cost centre that has an owner. The owner mapping will be **removed** when the file is published. | Expected when you close a cost centre. Check that this is intended. |
| `MISSING_OWNER` (warning, row `File`) | Owner Mapping | An active cost centre in the master still has no owner after this file is published. | Add a row for it now or in a later upload. It also appears under *Data quality exceptions*. |
| `BEFORE_START` | Budget & Actuals | The month is earlier than the cost centre's `Start_Date`. | Check the month, the code, or the start date in the master. |
| `NEW_GL_GROUP` | Budget & Actuals | No published line uses this GL group yet. It is shown once for each new GL group. | Check the Tally mapping for a typo, e.g. `Travel & Conveyence`. A genuinely new GL group is fine. |

### Messages without a code (the file was not processed)

| Message | Fix |
|---|---|
| *Only .xlsx or .csv files are accepted* | Save as Excel Workbook (`.xlsx`) or CSV UTF-8. |
| *File larger than 5 MB* or *Too many rows (max 5000)* (*max 60000* for Budget & Actuals) | Split the file into smaller uploads. A Budget & Actuals month must stay in one file, because each upload replaces the months it contains. |
| *No file received* or *Invalid upload type* | Select the file and the upload type again, then retry. |

---

## 7. Reconcile to the trial balance

A month's actuals can be published only when the **total of the cost centre actuals in the file
equals the trial-balance (TB) total** that the preparer enters for that month.

**Which TB total.** Take it from the Tally trial balance for the month, for the same ledgers that the
file covers: the P&L expense ledgers that are mapped to GL groups and allocated to cost centres.

- Use the month's **net movement** (debits less credits in the month), not the closing balance, which is year to date.
- Use the same sign convention as the file: expenses positive, credits negative.
- If the file holds more than one entity, enter the **combined** total of their trial balances, in the
  same amount units as the file. The portal reconciles one total per month, not one per entity.

**Steps** (preparer, straight after the file shows **Validated**):

1. In the period table, type the TB total for every month that has actuals. Budget-only months show
   *No TB needed*. Commas and spaces are allowed; do not type currency symbols or brackets (use `-` for a negative).
2. Click **Reconcile to TB**. It becomes available when every month with actuals has a value.
3. Each month shows the **Difference** (CC actuals − TB) and **✓ Reconciled** or **✗ Does not match**.
   - The difference must be **0.00**, unless IT has set an approved tolerance (`RECON_TOLERANCE`).
   - If you mistyped the TB total, correct it and click **Reconcile to TB** again. The latest value counts, and every attempt is logged (`TB_ENTERED`, then `RECON_PASSED` or `RECON_FAILED`).
   - If the file is wrong, click **Discard**, correct the file and upload it again.
4. When every month is reconciled, the upload is ready for the approver.

Only the preparer who uploaded the file can enter the TB total. The approver sees it, read-only, on the
approval card.

> **Enter the TB total before you leave the page.** The TB total can be entered only in the upload panel,
> straight after validation. If you leave, the upload waits under **Awaiting approval** with
> *Waiting for the preparer to reconcile it*, and it cannot be reconciled from there. Discard it and
> upload the file again.

When the approver publishes, the portal reconciles again in the same database transaction. If a month no
longer reconciles, nothing is published, `RECON_FAILED` is logged and the upload stays awaiting approval.

### Troubleshoot a reconciliation difference

Look at the size and the sign of the difference first.

| What you see | Typical cause | Fix |
|---|---|---|
| Actuals are **lower** than the TB by the balance of one or a few ledgers | **Unmapped GL groups**: new or renamed Tally ledgers that are not in the mapping sheet, so their amounts are missing from the file | Map the ledgers to GL groups, add the lines and upload again |
| Actuals are **higher** than the TB | **Balance-sheet lines included**: e.g. fixed-asset purchases, advances, prepaid expenses, GST input or TDS that were allocated to cost centres | Remove the balance-sheet ledgers. The file and the TB total cover P&L expense ledgers only |
| The difference equals one cost centre's total | **Cost centre missing from the file**, or Tally entries that are not allocated to any cost centre | Add the missing lines. Allocate the entries in Tally (or agree how unallocated amounts are treated), then export again |
| The difference is about **twice** one amount | **Sign convention**: a credit (reversal, recovery, credit note) entered as positive, or a Dr/Cr column read the wrong way round | Enter credits as negative (`-1234` or `(1,234)`) |
| A difference of a few paise or rupees | **Rounding**: one report was exported in whole rupees and the other with paise. The portal rounds each line to 2 decimals | Export both with 2 decimals. Use a tolerance only if Finance has approved one and IT has set `RECON_TOLERANCE` |
| A large difference that matches earlier months' activity | The TB **closing balance** (year to date) was used instead of the month's movement | Use the month's net movement |
| A new difference after exporting again | Entries were posted to the month after the first export | Close the period in Tally, then export both reports again |
| The difference equals one entity's total | The TB total covers only one of the entities in the file | Enter the combined TB total of every entity in the file |

`DUPLICATE_LINE` stops the same line from being loaded twice, but it cannot detect one ledger mapped to
two GL groups. If actuals are higher than the TB, check the mapping for that too.

**Messages during reconciliation and publishing**

| Message | Meaning |
|---|---|
| *Only the preparer who uploaded the file can enter the trial balance.* | Maker-checker. Ask the preparer, or discard the upload and upload the file yourself. |
| *Period 2026-10 has no actuals in this upload.* | A TB total was sent for a budget-only month. |
| *Enter a valid trial-balance total for 2026-10* or *Trial balance for 2026-10 is too large.* | The TB total is not a number, or is 10 lakh crore (10^13) or more. |
| *Publishing blocked: 2026-10 differs from the trial balance by 400.* or *… has no trial balance entered.* | The approver tried to publish an upload that is not reconciled. The preparer must reconcile it, or discard it. |

---

## 8. Approve and publish, or discard

**3. Awaiting approval** lists every upload that is *Validated* but not yet published or discarded (the
latest 20). An upload is no longer lost when the preparer leaves the page. Each card shows:

- the upload type and file name;
- who uploaded it, when, and the number of rows;
- the first 12 characters of the file's **SHA-256** hash and the first 8 characters of the **batch id**;
- for the master and owner mapping, the *new / updated / unchanged* counts;
- for Budget & Actuals, the period table with the TB totals, differences and status.

**Approve & publish** (approver):

- The button is disabled on your own uploads (*another Finance user must publish it*) and, for Budget &
  Actuals, until the preparer has reconciled every month with actuals (*Waiting for the preparer to
  reconcile it*). The server enforces both rules as well as the screen.
- Publishing is **all or nothing**: every row is saved in one database transaction, or none is.
- Before it saves anything, the portal **validates the file again against the current data**, in the same
  transaction. If something changed after validation (for example, another admin deactivated a cost centre
  that is in your owner file, or closed one that has actuals in your financials file), the upload is marked
  **Rejected** and the new errors are shown. Budget & Actuals uploads are also **reconciled again** (see [§7](#7-reconcile-to-the-trial-balance)).
- **Master and owner mapping:** the audit log records each changed field with the approver's name and the
  upload's **batch id**. The changes take effect straight away in the Finder and in what users can access.
  If every row is *unchanged*, there is nothing to publish, so discard it.
- **Budget & Actuals:** every line of every month in the file is replaced ([§5](#5-prepare-the-budget--actuals-file)).
  Each month with actuals is added to (or updated in) **Published periods** with its CC actuals total, TB
  total, approver and time. Owners see the new figures in My Cost Centres straight away. The audit log
  records one `UPLOAD_PUBLISHED` event for the batch, with each month's totals before and after, rather than
  one entry per line.
- The approver is recorded as **Approved by** on the upload.

**Discard** throws a validated upload away without changing anything. The preparer or the approver can
discard it, from the upload panel or from the approval card. The upload is marked *Discarded* and the
discard is logged.

**Recent uploads** at the bottom of the Admin page lists the last 10 uploads, with their status
(*Awaiting approval, Rejected, Published* or *Discarded*) and **Approved by**.

If IT has turned maker-checker off (`UPLOAD_MAKER_CHECKER=false`, for demos and tests only), the upload panel
shows a **Publish** button and the preparer can publish their own upload.

---

## 9. Deactivate (or reactivate) a cost centre

You can **never** delete a cost centre. The database blocks deletion, even for administrators,
so its history, financials and audit trail are kept.

**To deactivate**, upload a master row for the cost centre with all fields as they are now, except:

- `Status` = `Inactive`
- `Close_Date` = the closing date, on or after `Start_Date`

Validation shows the `INACTIVE_WITH_OWNER` warning if the cost centre has an owner. When it is published:

- the cost centre **disappears from the Finder** straight away,
- its **owner mapping and any per-cost-centre access grants are removed**, so the owner, backup and BU head named in the mapping lose access to it (Finance, Management and BU-wide BU heads still see it in My Cost Centres, marked *Inactive*),
- its budget and actuals are kept, and later Budget & Actuals files cannot give it non-zero actuals after the close month (`CC_CLOSED`), and
- the audit log records a `DEACTIVATE` entry for the cost centre and a `DELETE` entry for the removed owner mapping, both tagged with the batch id. The old owner details stay in the audit log.

**To reactivate**, upload the row with `Status` = `Active` and an **empty** `Close_Date`. The audit
log records `REACTIVATE`. The owner mapping is **not** restored, so upload a new owner mapping
for the cost centre afterwards.

---

## 10. Use the failed-searches report to add keywords

When an employee's search finds nothing, the portal records the search term. Go to
**Admin → Audit log & failed searches → Failed searches (last 90 days)**, which shows:

| Column | Meaning |
|---|---|
| Search term | What was typed, in lower case. Each keystroke is not stored separately: searches by the same person within 2 minutes that are longer or shorter versions of the same text (*chen*, *chen d*, *chen des*) count as one search, stored as the longest term. Terms of 1 character are ignored. |
| Searches | How many times the term was searched. |
| Users | How many different people searched for it. |
| Last seen | The date of the most recent search. |

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

## 11. Review the audit log

**Admin → Audit log & failed searches → Audit log** shows the latest 200 events, newest first.
`*_DENIED`, `*_REJECTED`, `DEACTIVATE` and `DELETE` are shown in red. `RECON_FAILED` is not, so look for it.

| Action | Recorded when | Detail |
|---|---|---|
| `CREATE` / `UPDATE` / `DELETE` | A cost centre, owner mapping or access grant is added, changed or removed | Old and new values. Updates show **only the fields that changed**. |
| `DEACTIVATE` / `REACTIVATE` | A cost centre's status changes | Old and new status and close date |
| `LOGIN` / `LOGOUT` | Someone signs in or out | Sign-in provider; logout reason (signed out or idle timeout) |
| `LOGIN_DENIED` | Someone signs in with an account outside the allowed domain or tenant | Email and provider |
| `ACCESS_DENIED` | A non-Finance user calls an admin API, or someone opens or exports a cost centre that they may not see or that does not exist | User; for a cost centre, the code that was requested |
| `TEMPLATE_DOWNLOAD` | A template is downloaded | Template type |
| `UPLOAD_VALIDATED` / `UPLOAD_REJECTED` | A file is validated, or is rejected when it is validated again at publish | File name, row count, error count |
| `TB_ENTERED` | The preparer enters or changes trial-balance totals | TB total for each month |
| `RECON_PASSED` / `RECON_FAILED` | After each TB entry. `RECON_FAILED` is also logged when a publish is blocked (`"stage": "publish"`) | For each month: CC actuals, TB total, difference, matched |
| `UPLOAD_PUBLISHED` / `UPLOAD_DISCARDED` | A validated file is published or discarded | For the master and owner mapping: file type and counts of new, updated and unchanged rows. For Budget & Actuals: for each month, rows, cost centres, budget and actual totals, the reconciliation, and the month's totals before the publish (`before`) |
| `EXPORT` | Someone exports a cost centre to Excel from My Cost Centres | Cost centre and *As of* month |

Upload events show the full **batch id** in the *Entity* column (`upload_batch · <id>`). Every master-data
change made by a publish carries the same batch id, so you can trace it back to the exact file. Individual
budget and actual lines are not audited one by one: the `UPLOAD_PUBLISHED` event and **Published periods**
are the record. The audit log is **append-only**: no one can edit or delete entries through the
application. The database rejects edits and deletions even from administrators.

For older entries, filtering or a full export (planned as Phase 3 audit reports), ask IT to run a
query such as:

```sql
-- every change made by one upload
select ts, user_email, action, entity, entity_id, old_value, new_value
  from ccp.audit_log where batch_id = '<batch id>' order by id;

-- upload evidence register
select id as batch_id, kind, file_name, file_sha256, uploaded_by, uploaded_at,
       status, row_count, error_count, approved_by, published_by, published_at
  from ccp.upload_batches order by uploaded_at desc;

-- trial-balance totals entered for each upload, and the period register
select batch_id, period, tb_total, entered_by, entered_at from ccp.trial_balances order by entered_at desc;
select period, actual_total, tb_total, batch_id, published_by, published_at from ccp.periods order by period;
```

---

## 12. Internal-control notes

**Segregation of duties**

- Only the **Finance** role can change master data or load financials. Database row-level security
  enforces this, so it does not depend on the screens. Management, BU heads, owners and employees have
  read-only access.
- **Maker-checker is enforced by the portal** for all three upload types, and is on by default:
  - the preparer uploads and validates the file. For Budget & Actuals, only the preparer can enter the
    TB total, and the database records the signed-in user as the person who entered it;
  - a **different** Finance user must approve and publish it. The server refuses a publish by the uploader,
    comparing signed-in identities (upper or lower case does not matter);
  - either of them can discard it.
- The approver is accountable for the review, not only the click: check the SHA-256 against the evidence
  file, the counts or period totals, and the TB total against the Tally trial balance. After publishing,
  check the audit log entries for the batch.
- **Keep at least two active Finance users.** With maker-checker on, one Finance user alone cannot publish
  anything. Arrange cover for leave rather than turning maker-checker off. `UPLOAD_MAKER_CHECKER=false`
  exists for single-user demos and tests. Turning it off in Production is an IT change that Finance must approve.
- The rule is enforced in the application server, not by a database constraint. It does not cover changes
  that IT makes directly in the database.
- **Roles are granted by IT**, through a controlled database change, not by Finance through the
  portal. IT records the change and Finance approves it. The audit log records role grants as
  changes to `cc_access`.
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
  - the parsed rows, the error report and the summary (new/updated/unchanged, or for Budget & Actuals the period totals and the reconciliation),
  - for a published file, who **approved** and published it (`approved_by`, `published_by`) and when.
- For Budget & Actuals, the portal also keeps:
  - the **TB total for each month**, with who entered it and when (`ccp.trial_balances` holds the latest value; every value entered is also in the audit log as `TB_ENTERED`),
  - the **Published periods** register (`ccp.periods`): for each month with actuals, the CC actuals total, TB total, batch id, who published it and when,
  - the `UPLOAD_PUBLISHED` event, with each month's totals before and after.
- Keep the original files with the approved change requests, the Tally trial balance and cost centre report,
  and the GL mapping sheet in the Finance evidence folder. An auditor can prove that a stored file is the one
  that was loaded by comparing its hash with `file_sha256`:
  - Windows: `certutil -hashfile <file> SHA256`
  - macOS/Linux: `shasum -a 256 <file>`
- On screen, the approval card shows the first 12 characters of the SHA-256 and the first 8 of the batch id,
  and the audit log shows the full batch id for upload events. For the full hash, IT can run the
  *upload evidence register* query in [§11](#11-review-the-audit-log).
- The portal never purges the audit log, the upload history, the trial-balance entries or the period register.
  Keep them, and the evidence folder, for at least the statutory retention period for books of account under
  the company's record-retention policy (8 years under s.128(5) of the Companies Act, 2013).

**Other controls built into the portal**

- **No deletion:** a cost centre can only be deactivated, so its history is kept.
- **All-or-nothing uploads**, so a master or a month can never be partly loaded.
- Every file is **validated again at publish** against the current data, and Budget & Actuals are **reconciled again**.
- **Actuals cannot be published unless they reconcile to the trial balance**, and cannot be posted to a future month or to a closed cost centre.
- **Sign-in** uses company Microsoft 365 accounts only. There is no self-registration and there are no passwords.
- **Sessions** end after 30 minutes of inactivity and always after 10 hours.

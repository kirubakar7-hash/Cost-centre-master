# Finance Admin Guide: SolidPro Cost Centre Portal

This guide is for users who hold the **Finance** role. Only the Finance role can see
**Admin** in the top menu or change cost centre master data. The database enforces
this as well as the screens.

Contents

1. [Monthly SOP checklist](#1-monthly-sop-checklist)
2. [Download the templates](#2-download-the-templates)
3. [Prepare the Cost Centre Master file](#3-prepare-the-cost-centre-master-file)
4. [Prepare the Owner Mapping file](#4-prepare-the-owner-mapping-file)
5. [Upload and read the error report](#5-read-the-error-report)
6. [Publish or discard](#6-publish-or-discard)
7. [Deactivate (or reactivate) a cost centre](#7-deactivate-or-reactivate-a-cost-centre)
8. [Use the failed-searches report to add keywords](#8-use-the-failed-searches-report-to-add-keywords)
9. [Review the audit log](#9-review-the-audit-log)
10. [Internal-control notes](#10-internal-control-notes)

---

## 1. Monthly SOP checklist

Run this checklist after month-end close and whenever a cost centre or an owner changes.

**Prepare (maker)**

- [ ] Collect the approved change requests: new cost centres, closures, alias or keyword changes, and owner, backup or BU-head changes. Include movers and leavers from the HR report.
- [ ] Open **Admin → Audit log & failed searches**. Note any failed search terms that should become keywords (see [§8](#8-use-the-failed-searches-report-to-add-keywords)).
- [ ] Open **Admin** and clear the **Data quality exceptions** list. It shows active cost centres with no owner and active cost centres with no keywords.
- [ ] Download fresh templates from **Admin → 1. Download a template**.
- [ ] Fill in the **master** file. Include only the rows that are new or changed, and give every column for each row (see [§3](#3-prepare-the-cost-centre-master-file)).
- [ ] Fill in the **owner mapping** file for new cost centres and owner changes (see [§4](#4-prepare-the-owner-mapping-file)).

**Load (checker: a second Finance user where possible)**

- [ ] Upload the **master** file, then fix and re-upload until it shows **Validated**.
- [ ] Check that the *new / updated / unchanged* counts and the warnings match the change requests, then **Publish**.
- [ ] Upload the **owner mapping** file, which must come *after* the master is published. Check the counts and **Publish**.
- [ ] Search for two or three of the changed cost centres in the **Cost Centre Finder** to confirm that the code, alias and owner are correct.

**Evidence and review**

- [ ] Save the uploaded files and the signed-off change requests in the Finance evidence folder, named with the upload date and file name (see [§10](#10-internal-control-notes)).
- [ ] Review this month's audit log: check every `UPLOAD_PUBLISHED` against a change request, and look at `LOGIN_DENIED` and `ACCESS_DENIED` events.
- [ ] Each quarter, ask IT for the list of Finance, Management and BU-head grants, and confirm that each one is still needed.

---

## 2. Download the templates

Go to **Admin → 1. Download a template**:

| Button | File | Use |
|---|---|---|
| Cost Centre Master | `SolidPro_CC_Master_Template.xlsx` | Create or update cost centres, or deactivate them |
| Owner Mapping | `SolidPro_CC_Owner_Mapping_Template.xlsx` | Assign the owner, backup owner and BU head |
| Budget & Actuals (Phase 2) | `SolidPro_CC_Financials_Template.xlsx` | Reference only. The upload is not available until Phase 2 |

Every download is recorded in the audit log (`TEMPLATE_DOWNLOAD`). Each workbook has:

- A **data sheet** (`CC_Master`, `Owner_Mapping` or `Financials`) with a blue, frozen header row and two **example rows**. **Delete or overwrite the example rows**, because every row you upload is loaded.
- A note on each header cell that gives the rule. Hover over the header to read it.
- An **Instructions** sheet that lists the same rules.
- Cells formatted as **Text**, so that Excel does not change `IN-ENG-101` or dates.

**General file rules**

- `.xlsx` or UTF-8 `.csv` only (no `.xls`), with a maximum of **5 MB** and **5,000 data rows**.
- Keep the header names exactly as they are. They are **case-sensitive** (`CC_Code`, not `cc code`). You can reorder columns, extra columns are ignored, and blank rows are skipped.
- For `.xlsx`, the portal reads the sheet named `CC_Master` or `Owner_Mapping`. If there is no sheet with that name, it reads the first sheet.
- **An upload adds or updates the rows it contains. Rows that are not in the file are left unchanged.** You can upload only the rows that changed. Uploads never delete anything.

---

## 3. Prepare the Cost Centre Master file

Each row is a **complete record** of one cost centre. When you publish it, all fields of
that cost centre are replaced with the values in the row, so fill in every column, even for
a small change such as adding a keyword. Phase 1 has no export, so keep your Finance master
workbook up to date as the working copy.

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

Each cost centre has one owner row. When you publish the file, each listed cost centre's
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
budget and actuals (My Cost Centres, Phase 2), and the BU head named here can see it too.
Access changes as soon as you click **Publish**. Use the email address that the person signs
in with (their Microsoft 365 address). Upper or lower case does not matter.

---

## 5. Read the error report

To upload a file:

1. Go to **Admin → 2. Upload, validate & publish**.
2. Choose **Upload type** (*Cost Centre Master* or *Owner Mapping*) and select the file.
3. Click **Validate**. Validation saves nothing to the master.

The portal then shows one of two results:

- **Rejected**: the file has at least one error, and nothing was saved. The table lists every
  problem, with **Row** (the Excel row number, where the header is row 1, or `File` for a problem
  with the whole file), **Column**, **Severity** and the message with its code in brackets.
  Fix **all** errors in your file and upload it again.
- **Validated**: the file has no errors. The portal shows how many rows are *new*, *updated* and
  *unchanged*, and lists any **warnings**. Warnings do not block publishing, but read them.

### Errors (any error rejects the whole file)

**Both file types**

| Code | Meaning | How to fix |
|---|---|---|
| `MISSING_COLUMN` | A required column header is missing or misspelt. Headers are case-sensitive. | Download the latest template and copy your data into it, or correct the header. |
| `EMPTY_FILE` | There are no data rows under the header. | Add rows. Check that you selected the right file and sheet. |
| `REQUIRED` | A required value is blank: `CC_Code` in both files; in the master file, also `CC_Alias`, `BU` or `Department`. | Fill in the cell. |
| `DUPLICATE_CODE` | The same `CC_Code` appears on more than one row. The message gives the other row. | Keep one row per code. |

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
| `INACTIVE_WITH_OWNER` | The cost centre is Inactive, and an inactive cost centre cannot have an owner. | Remove the row, or reactivate the cost centre first (see [§7](#7-deactivate-or-reactivate-a-cost-centre)). |
| `MISSING_OWNER` (error) | `Owner_Name` or `Owner_Email` is blank. | Fill in both. |
| `NO_BACKUP_OWNER` | `Backup_Owner_Email` is blank. | Every cost centre needs a backup owner. |
| `BACKUP_SAME_AS_OWNER` | The backup owner email is the same as the owner email. | Name a different person. |
| `INVALID_EMAIL` | The value in `Owner_Email`, `Backup_Owner_Email` or `BU_Head_Email` is not a valid email address. | Correct the address. Look for spaces, missing `@` or a trailing `.`. |
| `EXTERNAL_DOMAIN` | The email is valid but not on an allowed company domain, e.g. a Gmail or client address. | Use the person's SolidPro Microsoft 365 address. |

### Warnings (shown after validation; they do not block publishing)

| Code | File | Meaning | What to do |
|---|---|---|---|
| `NEEDS_OWNER` | Master | A **new** active cost centre has no owner mapping yet. | Publish the master, then upload its owner mapping. |
| `INACTIVE_WITH_OWNER` | Master | This row deactivates a cost centre that has an owner. The owner mapping will be **removed** when you publish. | Expected when you close a cost centre. Check that this is intended. |
| `MISSING_OWNER` (warning, row `File`) | Owner Mapping | An active cost centre in the master still has no owner after this file is published. | Add a row for it now or in a later upload. It also appears under *Data quality exceptions*. |

### Messages without a code (the file was not processed)

| Message | Fix |
|---|---|
| *Only .xlsx or .csv files are accepted* | Save as Excel Workbook (`.xlsx`) or CSV UTF-8. |
| *File larger than 5 MB* or *Too many rows (max 5000)* | Split the file into smaller uploads. |
| *No file received* or *Invalid upload type* | Select the file and the upload type again, then retry. |

---

## 6. Publish or discard

When a file shows **Validated**:

- **Publish** writes the changes to the master. It is available only when at least one row is new
  or updated. If every row is *unchanged*, there is nothing to publish, so click **Discard**.
  - Publishing is **all or nothing**: every row is saved in one database transaction, or none is.
  - Before it saves anything, the portal **validates the file again against the current master**. If
    something changed after you validated (for example, another admin deactivated a cost centre
    that is in your owner file), the upload is marked **Rejected** and the new errors are shown.
    Fix the file and upload it again.
  - The audit log records each changed field with your name and the upload's **batch id**.
  - The changes take effect straight away in the Finder and in what users can access.
- **Discard** throws the validated file away without changing anything. The upload is marked
  *Discarded* and the discard is logged.

**Recent uploads** at the bottom of the Admin page lists the last 10 uploads with their status
(*Validated, Rejected, Published* or *Discarded*). If you leave the page before you publish, the
upload stays *Validated* but cannot be published from the screen later. Upload the file again.

---

## 7. Deactivate (or reactivate) a cost centre

You can **never** delete a cost centre. The database blocks deletion, even for administrators,
so its history, financials and audit trail are kept.

**To deactivate**, upload a master row for the cost centre with all fields as they are now, except:

- `Status` = `Inactive`
- `Close_Date` = the closing date, on or after `Start_Date`

Validation shows the `INACTIVE_WITH_OWNER` warning if the cost centre has an owner. When you publish:

- the cost centre **disappears from the Finder** straight away,
- its **owner mapping and any per-cost-centre access grants are removed**, so the owner, backup and BU head lose access to it, and
- the audit log records a `DEACTIVATE` entry for the cost centre and a `DELETE` entry for the removed owner mapping, both tagged with the batch id. The old owner details stay in the audit log.

**To reactivate**, upload the row with `Status` = `Active` and an **empty** `Close_Date`. The audit
log records `REACTIVATE`. The owner mapping is **not** restored, so upload a new owner mapping
for the cost centre afterwards.

---

## 8. Use the failed-searches report to add keywords

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
3. Validate and publish, then search for the term in the Finder to confirm that the cost centre is found.
4. If no cost centre fits, the person may need a new cost centre, or guidance on which one to use.

---

## 9. Review the audit log

**Admin → Audit log & failed searches → Audit log** shows the latest 200 events, newest first.
Actions that need attention are shown in red: `*_DENIED`, `*_REJECTED`, `DEACTIVATE` and `DELETE`.

| Action | Recorded when | Detail |
|---|---|---|
| `CREATE` / `UPDATE` / `DELETE` | A cost centre, owner mapping or access grant is added, changed or removed | Old and new values. Updates show **only the fields that changed**. |
| `DEACTIVATE` / `REACTIVATE` | A cost centre's status changes | Old and new status and close date |
| `LOGIN` / `LOGOUT` | Someone signs in or out | Sign-in provider; logout reason (signed out or idle timeout) |
| `LOGIN_DENIED` | Someone signs in with an account outside the allowed domain or tenant | Email and provider |
| `ACCESS_DENIED` | A non-Finance user calls an admin API (template download, upload, publish or discard) | User |
| `TEMPLATE_DOWNLOAD` | A template is downloaded | Template type |
| `UPLOAD_VALIDATED` / `UPLOAD_REJECTED` | A file is validated | File name, row count, error count |
| `UPLOAD_PUBLISHED` / `UPLOAD_DISCARDED` | A validated file is published or discarded | For a publish: file type and counts of new, updated and unchanged rows |

Every master-data change made by a publish carries that upload's **batch id**, so you can trace
it back to the exact file. The audit log is **append-only**: no one can edit or delete entries
through the application. The database rejects edits and deletions even from administrators.

For older entries, filtering or a full export (planned as Phase 3 audit reports), ask IT to run a
query such as:

```sql
-- every change made by one upload
select ts, user_email, action, entity, entity_id, old_value, new_value
  from ccp.audit_log where batch_id = '<batch id>' order by id;

-- upload evidence register
select id as batch_id, kind, file_name, file_sha256, uploaded_by, uploaded_at,
       status, row_count, error_count, published_by, published_at
  from ccp.upload_batches order by uploaded_at desc;
```

---

## 10. Internal-control notes

**Segregation of duties**

- Only the **Finance** role can change master data. Database row-level security enforces this,
  so it does not depend on the screens. Management, BU heads, owners and employees have read-only access.
- **Phase 1 does not enforce maker-checker.** The same Finance user can upload and publish. Until
  a system-enforced approval step is added (see the README roadmap), use the manual control in the
  [SOP](#1-monthly-sop-checklist). One person prepares the file, a second Finance user validates and
  publishes it, and the publisher checks the audit log entries for the batch against the change request.
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
  - the parsed rows, the error report and the new/updated/unchanged summary,
  - for a published file, who published it and when.
- Keep the original files with the approved change requests in the Finance evidence folder.
  An auditor can prove that a stored file is the one that was loaded by comparing its hash with
  `file_sha256`:
  - Windows: `certutil -hashfile <file> SHA256`
  - macOS/Linux: `shasum -a 256 <file>`
- The batch id and hash do not appear on screen in Phase 1. IT can list them with the
  *upload evidence register* query in [§9](#9-review-the-audit-log).
- The portal never purges the audit log or the upload history. Keep them, and the evidence folder,
  for at least the statutory retention period for books of account under the company's
  record-retention policy (8 years under s.128(5) of the Companies Act, 2013).

**Other controls built into the portal**

- **No deletion:** a cost centre can only be deactivated, so its history is kept.
- **All-or-nothing uploads**, so a master can never be partly loaded.
- Every file is **validated again at publish** against the current data.
- **Sign-in** uses company Microsoft 365 accounts only. There is no self-registration and there are no passwords.
- **Sessions** end after 30 minutes of inactivity and always after 10 hours.

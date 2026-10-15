# Upload templates

These Excel files are generated from `src/lib/upload/templates.ts` by
`npm run templates`, so they always match the validator. **Run `npm run templates`
again whenever `templates.ts` changes** and commit the regenerated files. The portal
builds the same files on the fly at **Admin → 1. Download a template**. Downloading
from the portal is recommended, because the download is recorded in the audit log.

| File | Upload type | Phase | Sheet |
|---|---|---|---|
| `SolidPro_CC_Master_Template.xlsx` | Cost Centre Master: one row per cost centre | 1 | `CC_Master` |
| `SolidPro_CC_Owner_Mapping_Template.xlsx` | Owner Mapping: owner, backup and BU head for each cost centre | 1 | `Owner_Mapping` |
| `SolidPro_CC_Financials_Template.xlsx` | Budget & Actuals: one row per cost centre, period and GL group | 2 | `Financials` |

Each workbook has a data sheet and an **Instructions** sheet. The data sheet has a
frozen header row and two example rows, and each header cell has a note that
explains the rule.

## Rules for all files

- Keep the header row exactly as it is. Column names are case-sensitive, extra columns are ignored and blank rows are skipped.
- Replace the example rows. Every row you upload is loaded, so example rows that you leave in are loaded too.
- Only `.xlsx` or UTF-8 `.csv` files are accepted, up to **5 MB**. Older `.xls` files are rejected. The row limit is **5,000** for the master and owner mapping and **60,000** for Budget & Actuals.
- For `.xlsx`, the portal reads the sheet named in the table above, or the first sheet if there is no sheet with that name.
- All cells are formatted as Text so that Excel does not reformat codes or dates.
- **All or nothing:** if any row has an error, the whole file is rejected and a row-by-row report is shown.
- **Maker-checker:** a validated file is published by a *different* Finance user (Admin → 3. Awaiting approval).
- Master and owner mapping uploads add or update the rows they contain. Rows that are not in the file are left unchanged, and nothing is deleted. **Budget & Actuals uploads are different: they replace whole periods** (see below).

## Cost Centre Master columns

| Column | Required | Rule |
|---|---|---|
| CC_Code | Yes | `<Entity>-<BU code>-<number>`, e.g. `IN-ENG-101`. Pattern `^[A-Z]{2}-[A-Z0-9]{2,6}-[0-9]{3,4}$`. The code is converted to upper case and spaces are removed. It must be unique in the file. |
| CC_Alias | Yes | Friendly name of 2–80 characters. It must be unique (case-insensitive) in the file **and** across the existing master. |
| Entity | Yes | `IN`, `US` or `UK`, and it must equal the code prefix. |
| BU | Yes | Business unit, e.g. `Engineering`, `Shared Services`, `Sales`. |
| Department | Yes | Free text. |
| Type | Yes | `Direct`, `Shared` or `Allocated`. |
| Keywords | No | Search words separated by `;` or `,`. They are stored in lower case. |
| Status | Yes | `Active` or `Inactive`. To retire a cost centre, deactivate it. Never delete the row. |
| Start_Date | Yes | `YYYY-MM-DD`, `DD/MM/YYYY` or `DD-MM-YYYY`. |
| Close_Date | When Inactive | Required for Inactive, not allowed for Active, and on or after Start_Date. |

## Owner Mapping columns

| Column | Required | Rule |
|---|---|---|
| CC_Code | Yes | Must already be **published** in the master and be Active. One row per cost centre. |
| Owner_Name | Yes | Full name of the accountable owner. |
| Owner_Email | Yes | Company email on an allowed domain (default `@solidpro-es.com`). |
| Backup_Owner_Email | Yes | Company email that is different from the owner's. |
| BU_Head_Email | No | Company email of the BU head. |

## Budget & Actuals columns

| Column | Required | Rule |
|---|---|---|
| CC_Code | Yes | Must exist in the master (Active or Inactive). |
| Period | Yes | `YYYY-MM` (e.g. `2026-10`). Also accepted: an Excel date (`2026-10-01`, the day is ignored) and a month name with a 4-digit year (`Oct-2026`, `Oct 2026`, `October 2026`). `10/2026` and `Oct-26` are rejected. One file may hold several periods. |
| GL_Group | Yes | GL group as mapped from the Tally export, up to 60 characters. Use the same spelling every month; a new spelling is a new GL group (warning `NEW_GL_GROUP`). |
| Budget | Yes (column) | The month's budget for the line. A blank cell is loaded as **0**. |
| Actual | Yes (column) | The month's actual. **Leave blank only for budget-only (future) months.** In a month that has actuals, every row needs a value: enter `0`, not blank. Actuals are not allowed after the current month, or after the month in which an inactive cost centre closed. |

Amounts: commas and spaces are ignored, so Indian (`1,23,456.78`) and Western (`123,456.78`)
grouping both work. `₹ $ £ €` and a leading `INR`, `USD` or `GBP` are stripped. Negatives
are `-1234` or `(1,234)`. Values are rounded to 2 decimal places. `Dr`/`Cr` suffixes,
trailing minus signs and scientific notation are rejected.

**Rules specific to Budget & Actuals**

- **Each upload replaces every line of every period it contains, for all cost centres.** Include
  every cost centre and GL group for that period, with its budget, or the missing lines are removed.
  To correct a published month, upload the complete month again.
- One row per cost centre, period and GL group (duplicates are rejected).
- A period with actuals must reconcile to the **trial-balance total** entered by the preparer
  before it can be published. Budget-only periods need no trial balance.
- A budget-only row for a month that already has published actuals is rejected, because it would
  remove those actuals.
- The two example rows are October 2026 actuals for `IN-ENG-101`. Delete them: left in, they
  would replace the whole of October 2026.

The full list of error codes and how to fix each one is in
[`docs/ADMIN_GUIDE.md`](../docs/ADMIN_GUIDE.md#6-read-the-error-report). The monthly close
procedure is in [§1](../docs/ADMIN_GUIDE.md#1-monthly-sop-checklist) of the same guide.

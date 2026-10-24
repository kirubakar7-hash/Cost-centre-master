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
| `SolidPro_CC_Allocations_Template.xlsx` | Allocations: one row per receiving cost centre, period and source cost centre | 3 | `Allocations` |

Each workbook has a data sheet and an **Instructions** sheet. The data sheet has a
frozen header row only (no data), and each header cell has a note that explains the
rule. Example rows are shown on the Instructions sheet, so an unchanged template is
rejected as empty instead of loading sample data.

## Rules for all files

- Keep the header row exactly as it is. Column names are case-sensitive, extra columns are ignored and blank rows are skipped.
- Enter your rows under the header row. Every row you upload is loaded.
- Only `.xlsx` or UTF-8 `.csv` files are accepted, up to **5 MB**. Older `.xls` files are rejected. The row limit is **5,000** for the master, owner mapping and allocations, and **60,000** for Budget & Actuals.
- For `.xlsx`, the portal reads the sheet named in the table above, or the first sheet if there is no sheet with that name.
- All cells are formatted as Text so that Excel does not reformat codes or dates.
- **All or nothing:** if any row has an error, the whole file is rejected and a row-by-row report is shown.
- **Maker-checker:** a validated file is published by a *different* Finance user (Admin → 3. Awaiting approval).
- Master and owner mapping uploads add or update the rows they contain. Rows that are not in the file are left unchanged, and nothing is deleted. **Budget & Actuals uploads replace whole periods for each entity they contain, and Allocations uploads replace whole allocation runs** (see below).

## Cost Centre Master columns

| Column | Required | Rule |
|---|---|---|
| CC_Code | Yes | `<Entity>-<BU code>-<number>`, e.g. `IN-ENG-101`. Pattern `^[A-Z]{2}-[A-Z0-9]{2,6}-[0-9]{3,4}$`. The code is converted to upper case and spaces are removed. It must be unique in the file. |
| CC_Alias | Yes | Friendly name of 2–80 characters. It must be unique (case-insensitive) in the file **and** across the existing master. |
| Entity | Yes | `IN`, `US` or `UK`, and it must equal the code prefix. It also sets the currency of the cost centre's figures (INR, USD, GBP). |
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
| Budget | Yes (every row) | The month's budget for the line. **Enter 0 when there is no budget**: a blank cell is rejected. |
| Actual | Yes (column) | The month's actual. **Leave blank only for budget-only (future) months.** In a month that has actuals for the entity, every row of that entity needs a value: enter `0`, not blank. Actuals are not allowed after the current month, or after the month in which an inactive cost centre closed. |

Amounts: enter each amount in the currency of the cost centre's entity (INR for `IN-…`, USD for `US-…`,
GBP for `UK-…`); the portal never converts. Commas and spaces are ignored, so Indian (`1,23,456.78`) and
Western (`123,456.78`) grouping both work. `₹ $ £ €` and a leading `INR`, `USD` or `GBP` are stripped.
Negatives are `-1234` or `(1,234)`. Values are rounded to 2 decimal places and must be below 10^13.
`Dr`/`Cr` suffixes, trailing minus signs and scientific notation are rejected.

**Rules specific to Budget & Actuals**

- **Each upload replaces every line of every period it contains, for each entity it contains.** Include
  every cost centre and GL group of that entity for the period, with its budget, or the missing lines are
  removed (a missing cost centre is refused: `INCOMPLETE_PERIOD`). Other entities' lines for the same
  period are not touched, so each entity can close its month on its own. To correct a published month,
  upload the entity's complete month again.
- One row per cost centre, period and GL group (duplicates are rejected).
- A period with actuals must reconcile, **entity by entity**, to the **trial-balance total** of that entity
  entered by the preparer, before it can be published. Budget-only periods need no trial balance.
- A budget-only period for an entity that already has published actuals for it is rejected, because it
  would remove those actuals.

## Allocations columns

| Column | Required | Rule |
|---|---|---|
| CC_Code | Yes | The **receiving** cost centre. Must exist in the master, be in the same entity as `Source_CC`, and not have closed before the period. |
| Period | Yes | Same formats as Budget & Actuals. Not after the current month. |
| Source_CC | Yes | The shared-service cost centre the recharge comes from (normally type Shared or Allocated). Must exist, differ from `CC_Code`, and not have closed before the period. |
| Amount | Yes | The amount recharged, in the entity's own currency, with the same number rules as Budget & Actuals. Negative for a reversal. `0` is rejected: leave the line out. |
| Basis | Yes | How the amount was worked out, up to 120 characters, e.g. `Headcount (42 of 118)`. |

**Rules specific to Allocations**

- **Each upload replaces every allocation run it contains**: all allocations from one source cost centre
  in one period. Include every receiving cost centre of the run, or the missing ones lose their allocation.
  Other sources and periods are not touched, so each run (IT, rent, ...) can be loaded on its own.
- One row per receiving cost centre, period and source (duplicates are rejected). A cost centre cannot
  allocate to itself.
- Source and receiving cost centres must be in the same entity. A recharge between entities is an
  intercompany charge, booked in Tally, not an allocation (`CROSS_ENTITY`).
- There is no trial balance. Warnings: `DIRECT_SOURCE` (the source is a Direct cost centre) and
  `OVER_ALLOCATED` (a run recharges more than the source's published actual cost for the period).
- Allocations are shown to owners for information. They are not added to the receiving cost centre's actuals.

The full list of error codes and how to fix each one is in
[`docs/ADMIN_GUIDE.md`](../docs/ADMIN_GUIDE.md#7-read-the-error-report). The monthly close
procedure, entity by entity, and the allocations procedure are in
[§1](../docs/ADMIN_GUIDE.md#1-monthly-sop-checklist) of the same guide.

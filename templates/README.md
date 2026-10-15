# Upload templates

These Excel files are generated from `src/lib/upload/templates.ts` by
`npm run templates`, so they always match the validator. The portal serves the
same files at **Admin → 1. Download a template**. Downloading from the portal
is recommended, because the download is recorded in the audit log.

| File | Upload type | Phase | Sheet |
|---|---|---|---|
| `SolidPro_CC_Master_Template.xlsx` | Cost Centre Master: one row per cost centre | 1 | `CC_Master` |
| `SolidPro_CC_Owner_Mapping_Template.xlsx` | Owner Mapping: owner, backup and BU head for each cost centre | 1 | `Owner_Mapping` |
| `SolidPro_CC_Financials_Template.xlsx` | Budget & Actuals (reference only, because the upload arrives in Phase 2) | 2 | `Financials` |

Each workbook has a data sheet and an **Instructions** sheet. The data sheet has a
frozen header row and two example rows, and each header cell has a note that
explains the rule.

## Rules for all files

- Keep the header row exactly as it is. Column names are case-sensitive, extra columns are ignored and blank rows are skipped.
- Replace the example rows. Every row you upload is loaded, so example rows that you leave in are loaded too.
- Only `.xlsx` or UTF-8 `.csv` files are accepted, up to **5 MB** and **5,000 rows**. Older `.xls` files are rejected.
- All cells are formatted as Text so that Excel does not reformat codes or dates.
- **All or nothing:** if any row has an error, the whole file is rejected and a row-by-row report is shown.
- An upload adds or updates the rows it contains. Rows that are not in the file are left unchanged. Uploads never delete anything.

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

The full list of error codes and how to fix each one is in
[`docs/ADMIN_GUIDE.md`](../docs/ADMIN_GUIDE.md#5-read-the-error-report).

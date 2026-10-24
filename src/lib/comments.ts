/**
 * Variance explanations ("comments") on a cost centre's GL lines.
 *
 * Every function takes a transaction from withUser(), so Postgres decides
 * who may read and write: comments_read limits reads to visible cost
 * centres, and comments_insert (006_comments.sql) only accepts a comment
 * written as the caller, on a CC they answer for (ccp.can_comment), on a
 * line with published actuals. The checks here exist to give clear error
 * messages; the database is the control.
 */
import type { Tx } from './db/core';
import { isPeriod, periodLabel } from './fiscal';

export const COMMENT_MAX_LENGTH = 2000;
const CODE_RE = /^[A-Z]{2}-[A-Z0-9]{2,6}-[0-9]{3,4}$/;

export interface VarianceComment {
  id: number;
  cc_code: string;
  period: string;
  gl_group: string;
  user_email: string;
  comment: string;
  /** ISO 8601, UTC (e.g. 2026-10-24T09:15:02Z) */
  created_at: string;
}

export interface NewComment {
  code: string;
  period: string;
  glGroup: string;
  comment: string;
}

/** `invalid` → 400, `forbidden` → 403. */
export class CommentError extends Error {
  constructor(
    public kind: 'invalid' | 'forbidden',
    message: string,
  ) {
    super(message);
    this.name = 'CommentError';
  }
}

export const FORBIDDEN_MESSAGE =
  'You cannot add explanations to this cost centre. Only its owner, backup owner, BU head or Finance can.';

const SELECT = `select id, cc_code, period, gl_group, user_email, comment,
                       to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
                  from ccp.comments`;

/** Comments for one cost centre and period (all GL groups), newest first. [] if the CC is not visible. */
export async function listComments(tx: Tx, code: string, period: string): Promise<VarianceComment[]> {
  return tx.query<VarianceComment>(`${SELECT} where cc_code = $1 and period = $2 order by created_at desc, id desc`, [
    code,
    period,
  ]);
}

/** True if the caller may add explanations on this cost centre (owner, backup, BU head, Finance). */
export async function canComment(tx: Tx, code: string): Promise<boolean> {
  const [r] = await tx.query<{ ok: boolean }>('select ccp.can_comment($1) as ok', [code]);
  return Boolean(r?.ok);
}

/** GL groups of this CC with published actuals for the period, i.e. the lines that can be explained. */
export async function commentableGlGroups(tx: Tx, code: string, period: string): Promise<string[]> {
  const rows = await tx.query<{ gl_group: string }>(
    `select gl_group from ccp.financials
      where cc_code = $1 and period = $2 and actual is not null
      order by gl_group`,
    [code, period],
  );
  return rows.map((r) => r.gl_group);
}

/** Trim and check a comment's text; returns the text to store. */
export function normalizeComment(text: unknown): string {
  if (typeof text !== 'string') throw new CommentError('invalid', 'Enter an explanation.');
  const t = text.replace(/\r\n?/g, '\n').trim();
  if (t.length === 0) throw new CommentError('invalid', 'Enter an explanation.');
  if (t.length > COMMENT_MAX_LENGTH) {
    throw new CommentError('invalid', `Explanations are limited to ${COMMENT_MAX_LENGTH.toLocaleString('en-US')} characters (this one has ${t.length.toLocaleString('en-US')}).`);
  }
  return t;
}

const isRlsViolation = (err: unknown) => {
  const e = err as { code?: string; message?: string } | null;
  return e?.code === '42501' || /row-level security/i.test(e?.message ?? '');
};

/** Add an explanation as the caller. Throws CommentError for bad input or no permission. */
export async function addComment(tx: Tx, input: NewComment): Promise<VarianceComment> {
  const { code, period, glGroup } = input;
  if (typeof code !== 'string' || !CODE_RE.test(code)) throw new CommentError('invalid', 'Invalid cost centre code.');
  if (typeof period !== 'string' || !isPeriod(period)) throw new CommentError('invalid', 'Invalid period (expected YYYY-MM).');
  if (typeof glGroup !== 'string' || glGroup.trim() === '' || glGroup.length > 200) {
    throw new CommentError('invalid', 'Choose a GL group.');
  }
  const text = normalizeComment(input.comment);

  if (!(await canComment(tx, code))) throw new CommentError('forbidden', FORBIDDEN_MESSAGE);

  const [line] = await tx.query<{ has_actual: boolean }>(
    `select actual is not null as has_actual from ccp.financials where cc_code = $1 and period = $2 and gl_group = $3`,
    [code, period, glGroup],
  );
  if (!line) throw new CommentError('invalid', `${code} has no "${glGroup}" line in ${periodLabel(period)}.`);
  if (!line.has_actual) {
    throw new CommentError('invalid', `Actuals for ${periodLabel(period)} are not published yet, so there is no variance to explain.`);
  }

  try {
    const [row] = await tx.query<VarianceComment>(
      `with ins as (
         insert into ccp.comments (cc_code, period, gl_group, user_email, comment)
         values ($1, $2, $3, ccp.app_email(), $4)
         returning *
       )
       select id, cc_code, period, gl_group, user_email, comment,
              to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
         from ins`,
      [code, period, glGroup, text],
    );
    return row;
  } catch (err) {
    if (isRlsViolation(err)) throw new CommentError('forbidden', FORBIDDEN_MESSAGE);
    throw err;
  }
}

import type { Tx } from './db/core';

export interface SearchResult {
  cc_code: string;
  cc_alias: string;
  bu: string;
  department: string;
  entity: string;
  owner_name: string | null;
}

/** Split a query into lower-case words (max 8, each max 40 chars). */
export function parseTerms(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}&\-_.\/ ]+/gu, ' ')
    .split(/\s+/)
    .map((t) => t.slice(0, 40))
    .filter(Boolean)
    .slice(0, 8);
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/**
 * Multi-word search: every word must appear (any order, case-insensitive,
 * partial match) in code, alias, BU, department, owner name or keywords.
 * Active cost centres only. Directory fields only — no financial data.
 */
export async function searchCostCentres(tx: Tx, q: string, limit = 25): Promise<SearchResult[]> {
  const terms = parseTerms(q);
  if (terms.length === 0) return [];
  const params: unknown[] = [];
  const where = terms.map((t) => {
    params.push(`%${escapeLike(t)}%`);
    return `s.haystack like $${params.length} escape '\\'`;
  });
  params.push(q.trim().toLowerCase(), `${escapeLike(terms[0])}%`, limit);
  const full = params.length - 2;
  const prefix = params.length - 1;
  const lim = params.length;
  return tx.query<SearchResult>(
    `with s as (
       select c.cc_code, c.cc_alias, c.bu, c.department, c.entity, o.owner_name,
              lower(concat_ws(' ', c.cc_code, replace(c.cc_code, '-', ''), c.cc_alias, c.bu,
                              c.department, o.owner_name, c.keywords)) as haystack
         from ccp.cost_centres c
         left join ccp.cc_owners o on o.cc_code = c.cc_code
        where c.status = 'Active')
     select s.cc_code, s.cc_alias, s.bu, s.department, s.entity, s.owner_name
       from s
      where ${where.join(' and ')}
      order by case when lower(s.cc_code) = $${full} then 0
                    when lower(s.cc_code) like $${prefix} escape '\\' then 1
                    when lower(s.cc_alias) like $${prefix} escape '\\' then 2
                    else 3 end,
               s.cc_alias
      limit $${lim}`,
    params,
  );
}

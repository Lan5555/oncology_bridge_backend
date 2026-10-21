import { DataSource, QueryRunner } from 'typeorm';

// Exercise the real TypeORM SQL generator against each test's PostgreSQL
// transaction, without replacing QueryBuilder with an implementation-shaped mock.
export function transactionQueryBuilder(
  query: (sql: string, parameters: unknown[]) => Promise<unknown[]>,
) {
  const dataSource = new DataSource({ type: 'postgres' });
  const runner = {
    isTransactionActive: true,
    query: async (
      sql: string,
      parameters: unknown[] = [],
      structured = false,
    ) => {
      const records = await query(sql, parameters);
      return structured
        ? { records, raw: records, affected: records.length }
        : records;
    },
  } as QueryRunner;
  return dataSource.createQueryBuilder(runner);
}

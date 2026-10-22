import { PGlite } from '@electric-sql/pglite';
import {
  DataSource,
  EntityManager,
  EntitySchema,
  QueryRunner,
  QueryResult,
} from 'typeorm';

// Exercise real TypeORM repositories and PostgreSQL SQL without a network DB.
// PGlite serializes transactions; separate-connection lock contention still needs
// deployment testing against PostgreSQL.
export async function pgliteDataSource(pg: PGlite, entities: EntitySchema[]) {
  const db = new DataSource({ type: 'postgres', entities });
  await (db as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas();
  const managerFor = (
    query: (sql: string, args: unknown[]) => Promise<unknown[]>,
  ) => {
    const runner: QueryRunner = db.driver.createQueryRunner('master');
    async function execute(
      sql: string,
      args: unknown[] | Record<string, unknown> | undefined,
      structured: true,
    ): Promise<QueryResult>;
    async function execute(
      sql: string,
      args?: unknown[] | Record<string, unknown>,
    ): Promise<unknown>;
    async function execute(
      sql: string,
      args: unknown[] | Record<string, unknown> = [],
      structured = false,
    ) {
      if (!Array.isArray(args))
        throw new Error('PGlite test queries require positional parameters');
      const records = await query(sql, args);
      const result = new QueryResult();
      result.records = records;
      result.raw = records;
      result.affected = records.length;
      return structured ? result : records;
    }
    runner.query = execute;
    const manager = new EntityManager(db, runner);
    Object.assign(runner, { manager, isTransactionActive: true });
    return manager;
  };
  const transaction = async (
    isolationOrCallback:
      string | ((manager: EntityManager) => Promise<unknown>),
    callback?: (manager: EntityManager) => Promise<unknown>,
  ) =>
    pg.transaction(async (tx) => {
      const execute =
        typeof isolationOrCallback === 'function'
          ? isolationOrCallback
          : callback!;
      return execute(
        managerFor(async (sql, args) => (await tx.query(sql, args)).rows),
      );
    });
  const reader = managerFor(
    async (sql, args) => (await pg.query(sql, args)).rows,
  );
  reader.transaction = transaction;
  Object.assign(db, { manager: reader, transaction });
  return db;
}

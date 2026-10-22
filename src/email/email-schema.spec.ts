import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('email migration and transaction boundaries', () => {
  let pg: PGlite;
  const userId = '00000000-0000-4000-8000-000000000001';
  const migration = readFileSync(
    resolve(__dirname, '../../database/email-service.sql'),
    'utf8',
  );

  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec('CREATE TABLE users (id uuid PRIMARY KEY)');
    await pg.exec(migration);
  });
  afterAll(async () => {
    await pg.close();
  });

  it('can be safely reapplied and creates worker and reset storage', async () => {
    await pg.exec(migration);
    const result = await pg.query<{ name: string }>(
      "SELECT tablename AS name FROM pg_tables WHERE schemaname='public'",
    );
    expect(result.rows.map((row) => row.name)).toEqual(
      expect.arrayContaining(['email_outbox', 'password_resets']),
    );
  });

  it('rolls back queued email and reset tokens with the account action', async () => {
    await expect(
      pg.transaction(async (tx) => {
        await tx.query('INSERT INTO users(id) VALUES ($1)', [userId]);
        await tx.query(
          "INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '15 minutes')",
          ['a'.repeat(64), userId],
        );
        await tx.query('INSERT INTO email_outbox(payload) VALUES ($1)', [
          'encrypted',
        ]);
        throw new Error('Business action failed');
      }),
    ).rejects.toThrow('Business action failed');
    expect((await pg.query('SELECT * FROM email_outbox')).rows).toHaveLength(0);
    expect((await pg.query('SELECT * FROM password_resets')).rows).toHaveLength(
      0,
    );
    expect((await pg.query('SELECT * FROM users')).rows).toHaveLength(0);
  });

  it('persists pending work with usable defaults and cascades reset cleanup on account removal', async () => {
    await pg.transaction(async (tx) => {
      await tx.query('INSERT INTO users(id) VALUES ($1)', [userId]);
      await tx.query(
        "INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '15 minutes')",
        ['b'.repeat(64), userId],
      );
      await tx.query('INSERT INTO email_outbox(payload) VALUES ($1)', [
        'encrypted',
      ]);
    });
    const { rows } = await pg.query<{
      id: string;
      status: string;
      attempts: number;
    }>('SELECT id,status,attempts FROM email_outbox');
    expect(rows[0]).toMatchObject({ status: 'PENDING', attempts: 0 });
    expect(rows[0].id).toMatch(/^[a-f0-9-]{36}$/);
    await pg.query('DELETE FROM users WHERE id=$1', [userId]);
    expect((await pg.query('SELECT * FROM password_resets')).rows).toHaveLength(
      0,
    );
  });
});

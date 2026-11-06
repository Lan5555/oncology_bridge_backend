import { PGlite } from '@electric-sql/pglite';
import { EntitySchema } from 'typeorm';
import { pgliteDataSource } from '../../test/pglite-data-source';
import { StockAccessService } from '../guards/stock-access.service';
import { Medicine } from './entities/medicine.entity';
import { MedicineService } from './medicine.service';

jest.setTimeout(60000);

describe('bulk medicine transaction persistence', () => {
  let pg: PGlite;
  let service: MedicineService;
  const medicine = {
    gtin: '12345678901231',
    generic_name: 'Drug',
    brand_name: 'Brand',
    manufacturer: 'Maker',
    strength: '10 mg',
    dosage_form: 'vial',
    storage_temperature: '2-8 C',
  };
  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(`CREATE TABLE medicines (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), gtin text UNIQUE NOT NULL,
      generic_name text NOT NULL CHECK (generic_name <> 'force-db-failure'),
      brand_name text, manufacturer text, strength text, dosage_form text,
      storage_temperature text, catalog_facility_id uuid, deleted_at timestamptz
    )`);
    const schema = new EntitySchema<Medicine>({
      name: 'Medicine',
      target: Medicine,
      tableName: 'medicines',
      columns: {
        id: { type: 'uuid', primary: true, generated: 'uuid' },
        gtin: { type: String, unique: true },
        generic_name: { type: String },
        brand_name: { type: String },
        manufacturer: { type: String },
        strength: { type: String },
        dosage_form: { type: String },
        storage_temperature: { type: String },
        catalog_facility_id: { type: 'uuid', nullable: true },
        deleted_at: { type: 'timestamptz', nullable: true, deleteDate: true },
      },
    });
    const db = await pgliteDataSource(pg, [schema]);
    service = new MedicineService(db.getRepository(Medicine), db, {
      catalogueActor: jest.fn().mockResolvedValue({
        facilityId: '00000000-0000-4000-8000-000000000001',
      }),
    } as unknown as StockAccessService);
  });
  afterEach(async () => {
    await pg.exec('DELETE FROM medicines');
  });
  afterAll(async () => {
    await pg.close();
  });

  it('persists all rows with generated IDs', async () => {
    const response = await service.createBulk(
      { medicines: [medicine, { ...medicine, gtin: '00012345600012' }] },
      'staff',
    );
    expect(response.data?.count).toBe(2);
    expect((await pg.query('SELECT id FROM medicines')).rows).toHaveLength(2);
    expect(response.data?.medicines.every((row) => !!row.id)).toBe(true);
  });

  it('leaves no rows after a database failure in the batch', async () => {
    await expect(
      service.createBulk(
        {
          medicines: [
            medicine,
            {
              ...medicine,
              gtin: '00012345600012',
              generic_name: 'force-db-failure',
            },
          ],
        },
        'staff',
      ),
    ).rejects.toThrow();
    expect((await pg.query('SELECT id FROM medicines')).rows).toHaveLength(0);
  });

  it('does not reuse a soft-deleted GTIN or insert other rows in a conflicting batch', async () => {
    await pg.query(
      'INSERT INTO medicines(gtin,generic_name,deleted_at) VALUES ($1,$2,now())',
      [medicine.gtin, 'Deleted'],
    );
    await expect(
      service.createBulk(
        { medicines: [{ ...medicine, gtin: '00012345600012' }, medicine] },
        'staff',
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect((await pg.query('SELECT generic_name FROM medicines')).rows).toEqual(
      [{ generic_name: 'Deleted' }],
    );
  });
});

import { DataSource } from 'typeorm';
import { RegistryMetadataService } from './registry-metadata.service';
import { AdminIntegrationsService } from '../admin/admin-integrations.service';

describe('configured registry display metadata', () => {
  let service: RegistryMetadataService;
  let read: jest.Mock;
  beforeEach(() => {
    read = jest.fn().mockResolvedValue({
      values: {
        mdcn_registry_name: '  Configured medical registry  ',
        pcn_registry_name: 'Configured pharmacy registry',
        pcn_premises_registry_name: 'Configured premises registry',
        api_key: 'SECRET-MUST-NOT-APPEAR',
        registry_url: 'https://private-configuration.example',
      },
    });
    service = new RegistryMetadataService({
      manager: { getRepository: () => ({ findOneBy: read }) },
    } as unknown as DataSource);
  });
  it.each([
    ['MDCN', 'Configured medical registry'],
    ['PCN', 'Configured pharmacy registry'],
    ['PCN_PREMISES', 'Configured premises registry'],
  ])(
    'resolves %s solely from its configured metadata',
    async (code, expected) => {
      expect(await service.name(code)).toBe(expected);
      expect(read).toHaveBeenCalledWith({
        integration_key: 'license_registry',
      });
    },
  );
  it('does not invent names for unknown or missing codes', async () => {
    expect(await service.name('UNKNOWN')).toBeNull();
    expect(await service.name(null)).toBeNull();
    expect(await service.name(undefined)).toBeNull();
    expect(await service.name('')).toBeNull();
  });
  it('returns null for absent/invalid names and unavailable metadata, preserving the client code fallback', async () => {
    for (const values of [
      {},
      { pcn_registry_name: '' },
      { pcn_registry_name: '  ' },
      { pcn_registry_name: 123 },
      { pcn_registry_name: 'x'.repeat(201) },
      { pcn_registry_name: 'unsafe\nname' },
    ]) {
      read.mockResolvedValueOnce({ values });
      expect(await service.name('PCN')).toBeNull();
    }
    read.mockResolvedValueOnce(null);
    expect(await service.name('PCN')).toBeNull();
    read.mockRejectedValueOnce(new Error('metadata database unavailable'));
    expect(await service.name('PCN')).toBeNull();
  });
  it('exposes only code/name metadata and never integration secrets or URLs', async () => {
    expect(Object.fromEntries(await service.names())).toEqual({
      MDCN: 'Configured medical registry',
      PCN: 'Configured pharmacy registry',
      PCN_PREMISES: 'Configured premises registry',
    });
  });
  it('picks up configured name changes without changing registry codes or requiring a provider call', async () => {
    expect(await service.name('pcn')).toBe('Configured pharmacy registry');
    read.mockResolvedValue({
      values: { pcn_registry_name: 'Renamed registry' },
    });
    expect(await service.name('PCN')).toBe('Renamed registry');
  });
  it.each(['x'.repeat(201), 'name\nwith control characters', 123])(
    'rejects invalid configured display names',
    async (value) => {
      const integrations = new AdminIntegrationsService({} as DataSource);
      await expect(
        integrations.updateConfiguration(
          'license_registry',
          { values: { pcn_registry_name: value } },
          'actor',
          'ip',
        ),
      ).rejects.toMatchObject({ status: 400 });
    },
  );
});

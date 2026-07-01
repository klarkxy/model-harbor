import { ProviderPresetRepository } from '../infrastructure/db/repositories/provider-preset.repository.js';

export type PresetRow = ReturnType<ProviderPresetRepository['listPresets']>[number];

export class ProviderPresetService {
  private readonly repo = new ProviderPresetRepository();

  async listPresets(): Promise<PresetRow[]> {
    return this.repo.listPresets();
  }
}

import {
  listProviderDescriptors,
  getProviderDescriptor,
  type ProviderDescriptor,
} from '@manageyourllm/shared';

export interface PresetRow {
  id: string;
  source: 'builtin';
  name: string;
  providerType: string;
  descriptorJson: ProviderDescriptor;
  createdAt: Date;
  updatedAt: Date;
}

function mapBuiltin(descriptor: ProviderDescriptor): PresetRow {
  return {
    id: descriptor.id,
    source: 'builtin',
    name: descriptor.metadata.displayName,
    // 内置 preset 的 providerType 使用 descriptor id（如 moonshot），而不是某个 endpoint 的 providerType。
    // 真正的路由协议由 endpointsJson 中的每个 endpoint 决定。
    providerType: descriptor.id,
    descriptorJson: descriptor,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

export class ProviderPresetRepository {
  // 内置 preset 来自共享包，永不落库。
  listPresets(): PresetRow[] {
    return listProviderDescriptors().map(mapBuiltin);
  }

  findById(id: string): PresetRow | undefined {
    const descriptor = getProviderDescriptor(id);
    return descriptor ? mapBuiltin(descriptor) : undefined;
  }
}

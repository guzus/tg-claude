import { AIProvider } from '../types';

export function getProviderLabel(provider?: AIProvider): string {
  switch (provider) {
    case 'glm':
      return 'GLM';
    case 'openrouter':
      return 'OpenRouter';
    default:
      return 'Claude';
  }
}

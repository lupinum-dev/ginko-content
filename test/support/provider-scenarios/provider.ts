import type { ContentProvider } from '../../../packages/content/src/public/provider'
import {
  createFixtureContentProvider,
  type ProviderFixture
} from '../../../packages/content/src/testing/provider-fixture'
import type { ContentScenario } from './content-scenario'

/**
 * Adapt scenario data to the shipped provider fixture. Tests and downstream
 * provider authors now exercise one implementation of the provider contract.
 */
export const createInMemoryProvider = (scenario: ContentScenario, name = 'in-memory'): ContentProvider => {
  const fixture: ProviderFixture = {
    ...scenario,
    providerName: name
  }
  return createFixtureContentProvider(fixture, name)
}

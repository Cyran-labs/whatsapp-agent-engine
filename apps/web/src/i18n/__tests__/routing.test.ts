import { routing } from '../routing';

test('locales fr + en, défaut fr', () => {
  expect(routing.locales).toEqual(['fr', 'en']);
  expect(routing.defaultLocale).toBe('fr');
});

import '@testing-library/jest-dom/vitest';

// jsdom n'implémente pas le défilement : `scrollIntoView` est une fonction vide, qu'un test peut remplacer pour l'observer.
if (typeof HTMLElement !== 'undefined' && !('scrollIntoView' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: () => undefined });
}

import { LocaleSwitch } from './locale-switch';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

export function Header() {
  return (
    <header className="flex items-center justify-end gap-3 border-b border-border bg-surface px-6 py-3">
      <LocaleSwitch />
      <ThemeToggle />
      <UserMenu />
    </header>
  );
}

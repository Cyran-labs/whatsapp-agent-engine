'use client';
import { LocaleSwitch } from './locale-switch';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

export function TopBarActions() {
  return (
    <div className="flex items-center gap-3">
      <div className="text-brand-mint/80"><LocaleSwitch /></div>
      <div className="text-brand-mint/80"><ThemeToggle /></div>
      <UserMenu />
    </div>
  );
}

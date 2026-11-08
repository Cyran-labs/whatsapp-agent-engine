'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { Segmented } from '@/components/account/segmented';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const t = useTranslations('theme');
  // Le thème vient du navigateur : avant le montage on affiche la valeur par défaut, pour éviter un écart d'hydratation.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <Segmented
      ariaLabel={t('label')}
      options={[
        { value: 'light', label: t('light') },
        { value: 'dark', label: t('dark') },
      ]}
      value={mounted && theme === 'dark' ? 'dark' : 'light'}
      onChange={setTheme}
    />
  );
}

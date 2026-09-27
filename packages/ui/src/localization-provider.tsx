'use client';
import type { ReactNode } from 'react';
import { installCatalog, type PublicCatalog } from './localization-runtime';
export function LocalizationProvider({
  catalog,
  children,
}: {
  catalog: PublicCatalog | null;
  children: ReactNode;
}) {
  if (catalog) installCatalog(catalog);
  return children;
}

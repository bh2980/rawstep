import { Renderer } from '@json-render/react';
import type { Spec } from '@json-render/core';
import { dashboardRegistry } from './registry';

export function DashboardRenderer({ spec }: { spec: Spec }) {
  return <Renderer spec={spec} registry={dashboardRegistry} />;
}

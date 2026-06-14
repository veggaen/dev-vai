import type { LucideIcon } from 'lucide-react';
import {
  MessageSquare,
  BookOpen,
  Container,
  ScrollText,
  Dumbbell,
  Orbit,
  Shield,
  Users,
} from 'lucide-react';
import type { AppRole } from '../stores/authStore.js';
import { ROLE_NAV_ITEMS, type SidebarPanel } from '../stores/layoutStore.js';

/** How a destination occupies the shell when selected from the rail. */
export type SidebarPresentation = 'sidebar' | 'fullscreen' | 'drawer' | 'split';

export type SidebarNavGroup = 'core' | 'tools' | 'platform';

export interface SidebarNavItem {
  id: SidebarPanel;
  /** Short label for the activity rail tooltip */
  label: string;
  /** Title shown in the expanded sidebar header */
  title: string;
  /** One-line helper for quick switch / docs */
  description: string;
  icon: LucideIcon;
  shortcut?: string;
  group: SidebarNavGroup;
  presentation: SidebarPresentation;
  /** Shown only when the signed-in role includes this panel */
  ownerOnly?: boolean;
}

/**
 * Single source of truth for sidebar / rail destinations.
 * Keep routing behavior in layoutStore; this file owns labels, icons, and grouping.
 */
export const SIDEBAR_NAV_ITEMS: SidebarNavItem[] = [
  {
    id: 'chats',
    label: 'Chats',
    title: 'Workspace',
    description: 'Conversation history and search',
    icon: MessageSquare,
    shortcut: 'Ctrl+Shift+C',
    group: 'core',
    presentation: 'sidebar',
  },
  {
    id: 'council',
    label: 'Council',
    title: 'Vai Council',
    description: 'Live SCIS consensus and review',
    icon: Users,
    shortcut: 'Ctrl+Shift+V',
    group: 'core',
    presentation: 'split',
  },
  {
    id: 'knowledge',
    label: 'Knowledge',
    title: 'Knowledge Base',
    description: 'Saved pages and search across what Vai has read',
    icon: BookOpen,
    shortcut: 'Ctrl+Shift+K',
    group: 'tools',
    presentation: 'split',
  },
  {
    id: 'docker',
    label: 'Docker',
    title: 'Docker Sandboxes',
    description: 'Containers and sandbox runtime',
    icon: Container,
    shortcut: 'Ctrl+Shift+D',
    group: 'tools',
    presentation: 'sidebar',
  },
  {
    id: 'devlogs',
    label: 'Dev Logs',
    title: 'Dev Logs',
    description: 'Captured agent sessions and activity',
    icon: ScrollText,
    shortcut: 'Ctrl+Shift+L',
    group: 'tools',
    presentation: 'split',
  },
  {
    id: 'vaigym',
    label: 'Vai Gym',
    title: 'Vai Gymnasium',
    description: 'Training scenarios and evaluation',
    icon: Dumbbell,
    shortcut: 'Ctrl+Shift+G',
    group: 'platform',
    presentation: 'fullscreen',
    ownerOnly: true,
  },
  {
    id: 'thorsen',
    label: 'Thorsen',
    title: 'Thorsen Wormhole',
    description: 'Intent to artifact pipeline',
    icon: Orbit,
    shortcut: 'Ctrl+Shift+T',
    group: 'platform',
    presentation: 'fullscreen',
    ownerOnly: true,
  },
  {
    id: 'control',
    label: 'Control',
    title: 'Control',
    description: 'Owner runtime and training tools',
    icon: Shield,
    shortcut: 'Ctrl+Shift+O',
    group: 'platform',
    presentation: 'sidebar',
    ownerOnly: true,
  },
];

const NAV_BY_ID = new Map(SIDEBAR_NAV_ITEMS.map((item) => [item.id, item]));

export function getSidebarNavItem(id: SidebarPanel): SidebarNavItem | undefined {
  return NAV_BY_ID.get(id);
}

export function getSidebarPanelTitle(id: SidebarPanel): string {
  return NAV_BY_ID.get(id)?.title ?? id;
}

export function isPanelAllowed(role: AppRole, panel: SidebarPanel): boolean {
  return ROLE_NAV_ITEMS[role].includes(panel);
}

export interface RailNavSections {
  core: SidebarNavItem[];
  tools: SidebarNavItem[];
  platform: SidebarNavItem[];
}

/** Effective role for rail/quick-switch when owner toggles user-view mode. */
export function resolveNavRole(role: AppRole, ownerFeaturesHidden: boolean): AppRole {
  if (role === 'owner' && ownerFeaturesHidden) return 'builder';
  return role;
}

/** Rail-visible items for the current role, grouped for visual separation. */
export function getRailNavSections(role: AppRole, ownerFeaturesHidden = false): RailNavSections {
  const effectiveRole = resolveNavRole(role, ownerFeaturesHidden);
  const allowed = new Set(ROLE_NAV_ITEMS[effectiveRole]);
  const visible = SIDEBAR_NAV_ITEMS.filter((item) => allowed.has(item.id));

  return {
    core: visible.filter((item) => item.group === 'core'),
    tools: visible.filter((item) => item.group === 'tools'),
    platform: visible.filter((item) => item.group === 'platform'),
  };
}

/** Quick-switch and palette entries (excludes legacy aliases). */
export function getQuickSwitchNavItems(role: AppRole, ownerFeaturesHidden = false): SidebarNavItem[] {
  const effectiveRole = resolveNavRole(role, ownerFeaturesHidden);
  const allowed = new Set(ROLE_NAV_ITEMS[effectiveRole]);
  return SIDEBAR_NAV_ITEMS.filter((item) => allowed.has(item.id));
}

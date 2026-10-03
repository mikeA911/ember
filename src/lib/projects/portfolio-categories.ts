import type { PortfolioCategory } from '@/types/database'

// Display names and order for Project.portfolio_category -- shared by the
// category picker (ProjectCategorySelector.tsx) and the agency dashboard's
// completion-by-category view. Order matches My Projects' own sections.
export const CATEGORY_LABELS: Record<PortfolioCategory, string> = {
  sandz: 'Sandz',
  foundation: 'Foundation',
  showcases: 'Showcases',
  builder_lab: 'Builder Lab',
  templates: 'Templates',
  legacy_test: 'Legacy/Test',
  archived: 'Archived',
  other: 'Uncategorized',
}

export const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as PortfolioCategory[]

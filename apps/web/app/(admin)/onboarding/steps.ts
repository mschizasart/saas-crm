// Single source of truth for wizard steps. Order matters — the layout
// uses it to render the step indicator (1/7, 2/7, ...) and to decide
// which steps are "behind" the user (clickable) vs "ahead" (disabled).
//
// Keep slug values in sync with the server's allowed list in
// `apps/api/src/modules/organizations/organizations.service.ts`
// (OrganizationsService.ONBOARDING_STEPS).

export interface WizardStep {
  slug: string;        // matches `onboardingStep` value persisted server-side
  path: string;        // route under /onboarding (or /onboarding itself)
  label: string;       // shown in step indicator on hover / mobile
}

export const WIZARD_STEPS: WizardStep[] = [
  { slug: 'welcome',       path: '/onboarding',                label: 'Welcome' },
  { slug: 'org_details',   path: '/onboarding/org-details',    label: 'Company' },
  { slug: 'team',          path: '/onboarding/team',           label: 'Team' },
  { slug: 'first_client',  path: '/onboarding/first-client',   label: 'First client' },
  { slug: 'first_lead',    path: '/onboarding/first-lead',     label: 'First lead' },
  { slug: 'email',         path: '/onboarding/email',          label: 'Email' },
  { slug: 'ai',            path: '/onboarding/ai',             label: 'AI' },
  { slug: 'done',          path: '/onboarding/done',           label: 'Done' },
];

export function stepIndex(slug: string | null | undefined): number {
  if (!slug) return 0;
  const i = WIZARD_STEPS.findIndex((s) => s.slug === slug);
  return i < 0 ? 0 : i;
}

export function nextStepPath(currentSlug: string): string {
  const i = WIZARD_STEPS.findIndex((s) => s.slug === currentSlug);
  if (i < 0 || i >= WIZARD_STEPS.length - 1) return '/dashboard';
  return WIZARD_STEPS[i + 1].path;
}

export function prevStepPath(currentSlug: string): string | null {
  const i = WIZARD_STEPS.findIndex((s) => s.slug === currentSlug);
  if (i <= 0) return null;
  return WIZARD_STEPS[i - 1].path;
}

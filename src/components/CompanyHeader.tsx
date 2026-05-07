import { CompanyLogo } from "./CompanyLogo";

/**
 * Full-width header bar with the company logo centered.
 *
 * Used at the top of customer-facing pages (public forms, guest views,
 * customer portal) to give them a consistent, website-like appearance
 * instead of having the logo float on its own above the content. Renders
 * nothing while the logo is still loading or when no logo is configured -
 * the underlying CompanyLogo component handles that gracefully, so the
 * header bar simply collapses (no empty white strip).
 *
 * The bar spans the viewport edge-to-edge and sits above any container,
 * so callers should NOT wrap it in their max-w-* container - place it
 * before the container instead.
 */
export const CompanyHeader = () => {
  return (
    <header className="w-full bg-background border-b border-border">
      <div className="container max-w-5xl mx-auto px-4 py-3 flex items-center justify-center">
        <CompanyLogo className="max-h-10 w-auto" />
      </div>
    </header>
  );
};

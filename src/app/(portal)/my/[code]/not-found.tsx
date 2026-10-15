import Link from 'next/link';

/**
 * Deliberately identical for "no such cost centre" and "not one of yours",
 * so the response never confirms that another cost centre exists.
 */
export default function CostCentreNotFound() {
  return (
    <section className="mx-auto max-w-2xl">
      <p className="text-sm font-semibold text-muted">404</p>
      <h1 className="heading text-2xl sm:text-3xl">Cost centre not available</h1>
      <div className="surface mt-6 rounded-lg p-6 text-sm">
        <p>
          This cost centre does not exist, or it is not one of your cost centres. You can open the details of cost
          centres you own, back up or head as BU head.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/my" className="btn-primary">
            My Cost Centres
          </Link>
          <Link href="/" className="btn-secondary">
            Cost Centre Finder
          </Link>
        </div>
      </div>
    </section>
  );
}

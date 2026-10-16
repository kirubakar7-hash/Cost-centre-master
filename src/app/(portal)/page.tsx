import { Finder } from '@/components/Finder';
import { financeContactEmail } from '@/lib/config';

export default function FinderPage() {
  return (
    <section className="mx-auto max-w-3xl">
      <h1 className="heading text-2xl sm:text-3xl">Cost Centre Finder</h1>
      <p className="mt-1 text-sm text-muted">
        Find the correct cost centre code before raising an expense claim, purchase request or invoice.
      </p>
      <Finder financeEmail={financeContactEmail()} />
    </section>
  );
}

import { redirect } from 'next/navigation';

/** The Phase 1 audit screen is replaced by the Reports area (audit log and failed searches, with filters and export). */
export default function AuditPage() {
  redirect('/admin/reports');
}

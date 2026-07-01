'use client';

import type { Lead } from '@/lib/types';
import { leadOrg, formatDate } from '@/lib/leads';
import { productLabel } from '@/lib/category';
import styles from './CargoView.module.css';

// The cargo experiment bucket, kept visually separate from the regular
// municipal/fleet fuel tenders. Shows only is_cargo leads: buyer, product type,
// stated volume, and deadline, in soonest-deadline order (already sorted by
// applyCategoryFilter). Rows open the same detail panel.
export default function CargoView({
  leads,
  onSelect,
}: {
  leads: Lead[];
  onSelect: (lead: Lead) => void;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <span className={styles.badge}>⬢ Cargo</span>
        <span className={styles.sub}>
          cargo-scale demand (experiment) — {leads.length}
        </span>
      </div>

      {leads.length === 0 ? (
        <p className={styles.empty}>No cargo-scale fuel tenders match the current filter.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Buyer</th>
              <th>Product</th>
              <th>Volume</th>
              <th>Deadline</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} onClick={() => onSelect(l)}>
                <td>{l.company ?? leadOrg(l)}</td>
                <td>{productLabel(l.product_type)}</td>
                <td className={styles.vol}>{l.volume_estimate ?? '—'}</td>
                <td>{l.deadline ? formatDate(l.deadline) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

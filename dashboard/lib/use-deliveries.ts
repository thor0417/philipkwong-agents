'use client';

// THE DELIVERY LOG, read side.
//
// Migration 026 has not necessarily been applied, and this file is deliberately
// written so that the client detail DEGRADES rather than breaks when it has not:
// the query errors, the section says the log is unavailable and shows the
// message, and every other section on the page keeps working.
//
// That is the honest behaviour for a screen whose other four sections have
// nothing to do with deliveries. Hiding the section entirely would be worse - a
// missing delivery history and an empty one look identical, and one of them
// means "nothing was ever sent" while the other means "we cannot tell you".

import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

export interface Delivery {
  id: string;
  client_id: string | null;
  document_type: string;
  scope: Record<string, unknown> | null;
  brand_name: string | null;
  addressee: string | null;
  generated_at: string | null;
  period_start: string | null;
  period_end: string | null;
  project_count: number | null;
  record_count: number | null;
  file_path: string | null;
  delivery_status: string | null;
  notes: string | null;
}

export const DELIVERY_COLUMNS =
  'id,client_id,document_type,scope,brand_name,addressee,generated_at,period_start,' +
  'period_end,project_count,record_count,file_path,delivery_status,notes';

export async function fetchDeliveries(clientId: string): Promise<Delivery[]> {
  const { data, error } = await supabase
    .from('deliveries')
    .select(DELIVERY_COLUMNS)
    .eq('client_id', clientId)
    .order('generated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Delivery[];
}

export function useDeliveries(clientId: string) {
  return useQuery({
    queryKey: ['deliveries', clientId],
    queryFn: () => fetchDeliveries(clientId),
    enabled: !!clientId,
    // A missing table will not start existing because we asked four more times.
    retry: false,
  });
}

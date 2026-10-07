import { requireApiKey } from '@/server/http/auth';
import { handle, json, notFound } from '@/server/http/errors';
import { retryDelivery } from '@/server/services/deliveries';

export const dynamic = 'force-dynamic';

export const POST = handle<{ id: string }>((req, { id }) => {
  const owner = requireApiKey(req);
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n < 1) throw notFound('DELIVERY_NOT_FOUND', 'Delivery not found');
  return json(retryDelivery(owner, n));
});

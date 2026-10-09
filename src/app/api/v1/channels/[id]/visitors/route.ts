import { requireManagement } from '@/server/http/auth';
import { handle, json } from '@/server/http/errors';
import { pageQuery } from '@/server/http/pagination';
import { readQuery } from '@/server/http/validate';
import { listVisitors } from '@/server/services/visitors';

export const dynamic = 'force-dynamic';

export const GET = handle<{ id: string }>((req, { id }) => {
  const owner = requireManagement(req);
  return json(listVisitors(owner, id, readQuery(req, pageQuery)));
});

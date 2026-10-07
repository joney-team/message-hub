import { z } from 'zod';
import pkg from '../../../../../package.json';
import { LOCALES } from '@/i18n/catalog';
import { ALL_CATALOGS } from '@/i18n/catalog.server';
import { requireApiKey } from '@/server/http/auth';
import { handle, json } from '@/server/http/errors';
import { DEFAULT_SETTINGS, channelSettingsSchema } from '@/settings';

export const dynamic = 'force-dynamic';

/** Self-description for the main project: build the settings form and the "edit wording" screen from this. */
export const GET = handle((req) => {
  requireApiKey(req);
  return json({
    version: pkg.version,
    apiVersion: 'v1',
    settings: {
      jsonSchema: z.toJSONSchema(channelSettingsSchema, { io: 'input' }),
      defaults: DEFAULT_SETTINGS,
    },
    locales: LOCALES,
    messages: ALL_CATALOGS,
  });
});

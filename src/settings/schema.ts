import { z } from 'zod';

const LOCALE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

const httpUrl = z.url({ protocol: /^https?$/ }).max(2048);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex color like #1f2937');
const px = (max: number) => z.number().int().min(0).max(max);

export const localizedText = z.record(z.string().regex(LOCALE_RE), z.string().max(500));
export type LocalizedText = z.infer<typeof localizedText>;

const preChatField = z
  .object({
    key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/, 'Letters, digits and _ only'),
    type: z.enum(['text', 'number', 'name', 'phone', 'email']),
    required: z.boolean().optional(),
    label: localizedText.optional(),
    placeholder: localizedText.optional(),
  })
  .strict();

export const channelSettingsSchema = z
  .object({
    theme: z
      .object({
        color: hexColor.default('#1f2937'),
        colorScheme: z.enum(['light', 'dark', 'auto']).default('auto'),
        radius: z.enum(['none', 'sm', 'md', 'lg']).default('md'),
        fontFamily: z
          .string()
          .regex(/^[\w\s,'"-]{1,100}$/, 'Letters, digits, spaces, commas, quotes and hyphens only')
          .optional(),
        logo: httpUrl.optional(),
      })
      .strict()
      .prefault({}),
    launcher: z
      .object({
        position: z.enum(['left', 'right']).default('right'),
        offset: z.object({ x: px(400), y: px(400) }).strict().default({ x: 20, y: 20 }),
        icon: httpUrl.optional(),
        label: localizedText.optional(),
        hidden: z.boolean().default(false),
        zIndex: z.number().int().min(0).max(2147483647).default(2147483000),
      })
      .strict()
      .prefault({}),
    window: z
      .object({
        width: z.number().int().min(280).max(800).default(380),
        height: z.number().int().min(360).max(1000).default(640),
      })
      .strict()
      .prefault({}),
    locales: z
      .array(z.string().regex(LOCALE_RE))
      .min(1)
      .max(20)
      .default(['en', 'vi']),
    defaultLocale: z.string().regex(LOCALE_RE).default('en'),
    content: z
      .object({
        brandName: localizedText.optional(),
        welcomeTitle: localizedText.optional(),
        welcomeSubtitle: localizedText.optional(),
        greeting: localizedText.optional(),
        starters: z.array(localizedText).max(6).optional(),
        overrides: z.record(z.string().regex(LOCALE_RE), z.record(z.string(), z.string().max(500))).optional(),
      })
      .strict()
      .prefault({}),
    preChat: z
      .object({
        mode: z.enum(['off', 'optional', 'required']).default('off'),
        fields: z.array(preChatField).max(10).default([]),
      })
      .strict()
      .prefault({}),
    features: z
      .object({
        attachments: z.boolean().default(true),
        sound: z.boolean().default(true),
      })
      .strict()
      .prefault({}),
  })
  .strict();

export type ChannelSettings = z.output<typeof channelSettingsSchema>;

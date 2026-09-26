import { z } from 'zod';
export const localized = z
  .object({ fa: z.string().trim().min(1).max(200), en: z.string().trim().min(1).max(200) })
  .strict();
const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
export const fieldSchema = z
  .object({
    id: identifier,
    type: z.enum([
      'text',
      'textarea',
      'number',
      'email',
      'phone',
      'url',
      'date',
      'select',
      'radio',
      'checkbox',
      'multiselect',
      'image',
      'heading',
    ]),
    label: localized,
    required: z.boolean().default(false),
    visibility: z.enum(['private', 'members']).default('private'),
    options: z
      .array(z.object({ value: identifier, label: localized }).strict())
      .max(30)
      .default([]),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    showWhen: z
      .object({ field: identifier, equals: z.union([z.string().max(200), z.boolean()]) })
      .strict()
      .optional(),
  })
  .strict();
export const formSchema = z
  .object({
    title: localized,
    layout: z.enum(['tabs', 'steps']),
    sections: z
      .array(
        z
          .object({ id: identifier, title: localized, fields: z.array(fieldSchema).max(30) })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict()
  .superRefine((form, ctx) => {
    const seen = new Set<string>();
    const sections = new Set<string>();
    for (const section of form.sections) {
      if (sections.has(section.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate section' });
      sections.add(section.id);
      for (const field of section.fields) {
        if (seen.has(field.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate field' });
        if (field.showWhen && !seen.has(field.showWhen.field))
          ctx.addIssue({ code: 'custom', message: 'Conditions must reference an earlier field' });
        seen.add(field.id);
        if (['select', 'radio', 'multiselect'].includes(field.type) && !field.options.length)
          ctx.addIssue({ code: 'custom', message: 'Options required' });
        if (new Set(field.options.map((o) => o.value)).size !== field.options.length)
          ctx.addIssue({ code: 'custom', message: 'Duplicate option' });
        if (field.min !== undefined && field.max !== undefined && field.min > field.max)
          ctx.addIssue({ code: 'custom', message: 'Invalid range' });
      }
    }
    if (seen.size > 100) ctx.addIssue({ code: 'custom', message: 'Too many fields' });
  });
export type ProfileForm = z.infer<typeof formSchema>;
export function validateAnswers(
  form: ProfileForm,
  input: Record<string, unknown>,
  requireAll: boolean,
) {
  const answers: Record<string, unknown> = {};
  const fields = form.sections.flatMap((s) => s.fields);
  if (Object.keys(input).some((k) => !fields.some((f) => f.id === k)))
    throw new Error('INVALID_ANSWERS');
  const missing: string[] = [];
  for (const field of fields) {
    if (
      field.type === 'heading' ||
      (field.showWhen && answers[field.showWhen.field] !== field.showWhen.equals)
    )
      continue;
    const value = input[field.id];
    if (
      value === undefined ||
      value === '' ||
      value === null ||
      (Array.isArray(value) && !value.length) ||
      (field.type === 'checkbox' && value === false)
    ) {
      if (field.required) missing.push(field.id);
      if (field.type === 'checkbox' && value === false) answers[field.id] = false;
      continue;
    }
    let schema: z.ZodTypeAny = z.string().max(field.type === 'textarea' ? 4000 : 300);
    switch (field.type) {
      case 'number':
        schema = z
          .number()
          .finite()
          .min(field.min ?? -1e12)
          .max(field.max ?? 1e12);
        break;
      case 'email':
        schema = z.string().email().max(254);
        break;
      case 'phone':
        schema = z.string().regex(/^\+?[0-9 ()-]{5,25}$/);
        break;
      case 'url':
        schema = z
          .string()
          .url()
          .max(500)
          .refine((v) => /^https?:\/\//.test(v));
        break;
      case 'date':
        schema = z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .refine(
            (v) => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
          );
        break;
      case 'select':
      case 'radio':
        schema = z.string().refine((v) => field.options.some((o) => o.value === v));
        break;
      case 'multiselect':
        schema = z
          .array(z.string().refine((v) => field.options.some((o) => o.value === v)))
          .max(30)
          .refine((v) => new Set(v).size === v.length);
        break;
      case 'checkbox':
        schema = z.boolean();
        break;
      case 'image':
        schema = z.string().uuid();
        break;
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new Error('INVALID_ANSWERS');
    answers[field.id] = parsed.data;
  }
  if (requireAll && missing.length) throw new Error('PROFILE_INCOMPLETE');
  return { answers, missing };
}
export const defaultForm = formSchema.parse({
  title: { fa: 'تکمیل اطلاعات کاربری', en: 'Complete your profile' },
  layout: 'steps',
  sections: [
    {
      id: 'about',
      title: { fa: 'دربارهٔ شما', en: 'About you' },
      fields: [
        {
          id: 'bio',
          type: 'textarea',
          label: { fa: 'دربارهٔ من', en: 'About me' },
          visibility: 'members',
        },
        {
          id: 'language',
          type: 'select',
          label: { fa: 'زبان گفت‌وگو', en: 'Conversation language' },
          required: true,
          options: [
            { value: 'fa', label: { fa: 'فارسی', en: 'Persian' } },
            { value: 'en', label: { fa: 'انگلیسی', en: 'English' } },
          ],
        },
      ],
    },
    {
      id: 'preferences',
      title: { fa: 'ترجیحات', en: 'Preferences' },
      fields: [
        {
          id: 'timezone',
          type: 'text',
          label: { fa: 'منطقهٔ زمانی', en: 'Time zone' },
          required: true,
        },
      ],
    },
  ],
});

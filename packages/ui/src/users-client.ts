export type Localized = { fa: string; en: string };
export type Field = {
  id: string;
  type:
    | 'text'
    | 'textarea'
    | 'number'
    | 'email'
    | 'phone'
    | 'url'
    | 'date'
    | 'select'
    | 'radio'
    | 'checkbox'
    | 'multiselect'
    | 'image'
    | 'heading';
  label: Localized;
  required: boolean;
  visibility: 'private' | 'members';
  options: { value: string; label: Localized }[];
  min?: number;
  max?: number;
  showWhen?: { field: string; equals: string | boolean };
};
export type FormDefinition = {
  title: Localized;
  layout: 'tabs' | 'steps';
  sections: { id: string; title: Localized; fields: Field[] }[];
};
export type AvatarValue = { kind: 'preset' | 'upload'; value: string };
export type Profile = {
  public_id: string;
  display_name: string;
  avatar: AvatarValue;
  answers: Record<string, unknown>;
  revision: number;
  saved_version: number;
  form: { id: string; version: number; definition: FormDefinition };
  complete: boolean;
  missing: string[];
};
export type Workspace = { role: string; scope: string; organization_name: string | null };
export type FormDraft = {
  id: string;
  draft: FormDefinition;
  revision: number;
  published: number;
  is_default: boolean;
};
export const usersBase = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
let refreshing: Promise<boolean> | undefined;
export async function userApi<T = Record<string, unknown>>(
  path: string,
  method = 'GET',
  data?: unknown,
): Promise<T> {
  const perform = () =>
    fetch(`${usersBase}/api/users/${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  let response = await perform();
  if (response.status === 401) {
    refreshing ??= fetch(`${usersBase}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then((r) => r.ok)
      .finally(() => {
        refreshing = undefined;
      });
    if (await refreshing) response = await perform();
  }
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.code ?? 'UNAVAILABLE');
  return body.data as T;
}
export async function uploadImage(file: File, kind: 'avatar' | 'attachment') {
  if (file.size > 2 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('INVALID_IMAGE');
  const encoded = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]!);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  return userApi<{ id: string }>('files/images', 'POST', { kind, base64: encoded });
}

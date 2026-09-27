// Provider port only. No adapter is configured and no network translation occurs in stage 10.
export type TranslationTask = {
  id: string;
  sourceLanguage: 'en';
  targetLanguage: string;
  sourceRevision: number;
  text: string;
};
export type TranslationResult = {
  text: string;
  provider: string;
  model: string;
  sourceRevision: number;
};
export interface TranslationProvider {
  readonly name: string;
  translate(task: TranslationTask, signal: AbortSignal): Promise<TranslationResult>;
}
export const translationProviders: ReadonlyMap<string, TranslationProvider> = new Map();

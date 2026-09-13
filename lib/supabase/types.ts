/**
 * Database types.
 *
 * GENERATED FILE - do not edit by hand. Regenerate after every migration:
 *
 *   npm run db:types
 *
 * This is a placeholder standing in until the first migration lands: the
 * schema is intentionally empty, so `npm run db:types` will replace this file
 * wholesale. It exists now so the Supabase clients are typed from day one and
 * gain real table types the moment the semantic model is designed.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: Record<never, never>;
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};

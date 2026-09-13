export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      companies: {
        Row: {
          created_at: string
          id: string
          name: string
          onboarding_completed_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          onboarding_completed_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          onboarding_completed_at?: string | null
        }
        Relationships: []
      }
      company_assumptions: {
        Row: {
          company_id: string
          created_at: string
          id: string
          key: string
          source: string
          updated_at: string
          value: Json
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          key: string
          source?: string
          updated_at?: string
          value: Json
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          key?: string
          source?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      source_accounts: {
        Row: {
          company_id: string
          connection_id: string
          currency: string
          first_seen_at: string
          id: string
          kind: Database["public"]["Enums"]["source_account_kind"]
          last_observed_at: string
          last_seen_sync_id: string | null
          latest_raw_record_id: string | null
          mask: string | null
          name: string | null
          provider: Database["public"]["Enums"]["source_provider"]
          provider_account_id: string
          provider_attributes: Json
        }
        Insert: {
          company_id: string
          connection_id: string
          currency: string
          first_seen_at?: string
          id?: string
          kind: Database["public"]["Enums"]["source_account_kind"]
          last_observed_at?: string
          last_seen_sync_id?: string | null
          latest_raw_record_id?: string | null
          mask?: string | null
          name?: string | null
          provider: Database["public"]["Enums"]["source_provider"]
          provider_account_id: string
          provider_attributes?: Json
        }
        Update: {
          company_id?: string
          connection_id?: string
          currency?: string
          first_seen_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["source_account_kind"]
          last_observed_at?: string
          last_seen_sync_id?: string | null
          latest_raw_record_id?: string | null
          mask?: string | null
          name?: string | null
          provider?: Database["public"]["Enums"]["source_provider"]
          provider_account_id?: string
          provider_attributes?: Json
        }
        Relationships: [
          {
            foreignKeyName: "source_accounts_connection_id_company_id_fkey"
            columns: ["connection_id", "company_id"]
            isOneToOne: false
            referencedRelation: "source_connections"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "source_accounts_latest_raw_record_id_fkey"
            columns: ["latest_raw_record_id"]
            isOneToOne: false
            referencedRelation: "source_raw_records"
            referencedColumns: ["id"]
          },
        ]
      }
      source_balance_observations: {
        Row: {
          account_id: string
          available_minor: number | null
          company_id: string
          currency: string
          current_minor: number
          id: string
          observed_at: string
          raw_record_id: string | null
          sync_id: string
        }
        Insert: {
          account_id: string
          available_minor?: number | null
          company_id: string
          currency: string
          current_minor: number
          id?: string
          observed_at?: string
          raw_record_id?: string | null
          sync_id: string
        }
        Update: {
          account_id?: string
          available_minor?: number | null
          company_id?: string
          currency?: string
          current_minor?: number
          id?: string
          observed_at?: string
          raw_record_id?: string | null
          sync_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_balance_observations_account_id_company_id_fkey"
            columns: ["account_id", "company_id"]
            isOneToOne: false
            referencedRelation: "source_accounts"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "source_balance_observations_raw_record_id_fkey"
            columns: ["raw_record_id"]
            isOneToOne: false
            referencedRelation: "source_raw_records"
            referencedColumns: ["id"]
          },
        ]
      }
      source_connections: {
        Row: {
          company_id: string
          created_at: string
          credentials: Json
          display_name: string | null
          id: string
          last_sync_error: string | null
          last_synced_at: string | null
          provider: Database["public"]["Enums"]["source_provider"]
          provider_connection_id: string
          status: Database["public"]["Enums"]["source_connection_status"]
          sync_state: Json
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          credentials: Json
          display_name?: string | null
          id?: string
          last_sync_error?: string | null
          last_synced_at?: string | null
          provider: Database["public"]["Enums"]["source_provider"]
          provider_connection_id: string
          status?: Database["public"]["Enums"]["source_connection_status"]
          sync_state?: Json
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          credentials?: Json
          display_name?: string | null
          id?: string
          last_sync_error?: string | null
          last_synced_at?: string | null
          provider?: Database["public"]["Enums"]["source_provider"]
          provider_connection_id?: string
          status?: Database["public"]["Enums"]["source_connection_status"]
          sync_state?: Json
          updated_at?: string
        }
        Relationships: []
      }
      source_entries: {
        Row: {
          account_id: string
          amount_minor: number
          company_id: string
          connection_id: string
          counterparty_name: string | null
          currency: string
          description: string
          first_seen_at: string
          id: string
          initiated_at: string | null
          last_observed_at: string
          last_seen_sync_id: string | null
          latest_raw_record_id: string | null
          movement_key: string | null
          occurred_on: string
          posted_at: string | null
          provider: Database["public"]["Enums"]["source_provider"]
          provider_attributes: Json
          provider_category: Json | null
          provider_entry_id: string
          status: Database["public"]["Enums"]["source_entry_status"]
          supersedes_provider_entry_id: string | null
          withdrawn_at: string | null
        }
        Insert: {
          account_id: string
          amount_minor: number
          company_id: string
          connection_id: string
          counterparty_name?: string | null
          currency: string
          description: string
          first_seen_at?: string
          id?: string
          initiated_at?: string | null
          last_observed_at?: string
          last_seen_sync_id?: string | null
          latest_raw_record_id?: string | null
          movement_key?: string | null
          occurred_on: string
          posted_at?: string | null
          provider: Database["public"]["Enums"]["source_provider"]
          provider_attributes?: Json
          provider_category?: Json | null
          provider_entry_id: string
          status: Database["public"]["Enums"]["source_entry_status"]
          supersedes_provider_entry_id?: string | null
          withdrawn_at?: string | null
        }
        Update: {
          account_id?: string
          amount_minor?: number
          company_id?: string
          connection_id?: string
          counterparty_name?: string | null
          currency?: string
          description?: string
          first_seen_at?: string
          id?: string
          initiated_at?: string | null
          last_observed_at?: string
          last_seen_sync_id?: string | null
          latest_raw_record_id?: string | null
          movement_key?: string | null
          occurred_on?: string
          posted_at?: string | null
          provider?: Database["public"]["Enums"]["source_provider"]
          provider_attributes?: Json
          provider_category?: Json | null
          provider_entry_id?: string
          status?: Database["public"]["Enums"]["source_entry_status"]
          supersedes_provider_entry_id?: string | null
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_entries_account_id_company_id_fkey"
            columns: ["account_id", "company_id"]
            isOneToOne: false
            referencedRelation: "source_accounts"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "source_entries_connection_id_company_id_fkey"
            columns: ["connection_id", "company_id"]
            isOneToOne: false
            referencedRelation: "source_connections"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "source_entries_latest_raw_record_id_fkey"
            columns: ["latest_raw_record_id"]
            isOneToOne: false
            referencedRelation: "source_raw_records"
            referencedColumns: ["id"]
          },
        ]
      }
      source_raw_records: {
        Row: {
          company_id: string
          connection_id: string
          id: string
          observed_at: string
          payload: Json
          payload_hash: string
          provider: Database["public"]["Enums"]["source_provider"]
          provider_record_id: string
          record_type: Database["public"]["Enums"]["source_record_type"]
          sync_id: string
        }
        Insert: {
          company_id: string
          connection_id: string
          id?: string
          observed_at?: string
          payload: Json
          payload_hash: string
          provider: Database["public"]["Enums"]["source_provider"]
          provider_record_id: string
          record_type: Database["public"]["Enums"]["source_record_type"]
          sync_id: string
        }
        Update: {
          company_id?: string
          connection_id?: string
          id?: string
          observed_at?: string
          payload?: Json
          payload_hash?: string
          provider?: Database["public"]["Enums"]["source_provider"]
          provider_record_id?: string
          record_type?: Database["public"]["Enums"]["source_record_type"]
          sync_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_raw_records_connection_id_company_id_fkey"
            columns: ["connection_id", "company_id"]
            isOneToOne: false
            referencedRelation: "source_connections"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "source_raw_records_sync_id_company_id_fkey"
            columns: ["sync_id", "company_id"]
            isOneToOne: false
            referencedRelation: "source_sync_runs"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      source_sync_runs: {
        Row: {
          company_id: string
          connection_id: string
          counts: Json
          error: string | null
          finished_at: string | null
          id: string
          provider: Database["public"]["Enums"]["source_provider"]
          started_at: string
          status: Database["public"]["Enums"]["source_sync_status"]
          sync_state_after: Json | null
          sync_state_before: Json | null
        }
        Insert: {
          company_id: string
          connection_id: string
          counts?: Json
          error?: string | null
          finished_at?: string | null
          id?: string
          provider: Database["public"]["Enums"]["source_provider"]
          started_at?: string
          status?: Database["public"]["Enums"]["source_sync_status"]
          sync_state_after?: Json | null
          sync_state_before?: Json | null
        }
        Update: {
          company_id?: string
          connection_id?: string
          counts?: Json
          error?: string | null
          finished_at?: string | null
          id?: string
          provider?: Database["public"]["Enums"]["source_provider"]
          started_at?: string
          status?: Database["public"]["Enums"]["source_sync_status"]
          sync_state_after?: Json | null
          sync_state_before?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "source_sync_runs_connection_id_company_id_fkey"
            columns: ["connection_id", "company_id"]
            isOneToOne: false
            referencedRelation: "source_connections"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      source_account_kind:
        | "checking"
        | "savings"
        | "credit"
        | "investment"
        | "rewards"
        | "other"
      source_connection_status: "active" | "error" | "revoked"
      source_entry_status: "pending" | "posted" | "failed" | "scheduled"
      source_provider: "plaid" | "rho"
      source_record_type: "account" | "transaction"
      source_sync_status: "running" | "succeeded" | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      source_account_kind: [
        "checking",
        "savings",
        "credit",
        "investment",
        "rewards",
        "other",
      ],
      source_connection_status: ["active", "error", "revoked"],
      source_entry_status: ["pending", "posted", "failed", "scheduled"],
      source_provider: ["plaid", "rho"],
      source_record_type: ["account", "transaction"],
      source_sync_status: ["running", "succeeded", "failed"],
    },
  },
} as const

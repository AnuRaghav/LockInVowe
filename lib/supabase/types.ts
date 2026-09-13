export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      company_briefs: {
        Row: {
          body: string
          company_id: string
          fingerprint: string
          generated_at: string
          generator: Json
          id: string
          sections: Json
          source_block_ids: string[]
          version: number
        }
        Insert: {
          body: string
          company_id: string
          fingerprint: string
          generated_at?: string
          generator?: Json
          id?: string
          sections?: Json
          source_block_ids?: string[]
          version: number
        }
        Update: {
          body?: string
          company_id?: string
          fingerprint?: string
          generated_at?: string
          generator?: Json
          id?: string
          sections?: Json
          source_block_ids?: string[]
          version?: number
        }
        Relationships: []
      }
      semantic_block_revisions: {
        Row: {
          as_of: string | null
          attributes: Json
          block_id: string
          body: string
          change_kind: Database["public"]["Enums"]["semantic_change_kind"]
          change_note: string | null
          company_id: string
          confidence: number | null
          context_policy: Database["public"]["Enums"]["semantic_context_policy"]
          id: string
          labels: string[]
          provenance: Json
          recorded_at: string
          revision: number
          salience: number
          source_interaction_id: string | null
          status: Database["public"]["Enums"]["semantic_block_status"]
          summary: string | null
          superseded_at: string | null
          supersedes_revision_id: string | null
          title: string
        }
        Insert: {
          as_of?: string | null
          attributes?: Json
          block_id: string
          body: string
          change_kind: Database["public"]["Enums"]["semantic_change_kind"]
          change_note?: string | null
          company_id: string
          confidence?: number | null
          context_policy: Database["public"]["Enums"]["semantic_context_policy"]
          id?: string
          labels?: string[]
          provenance?: Json
          recorded_at?: string
          revision: number
          salience: number
          source_interaction_id?: string | null
          status: Database["public"]["Enums"]["semantic_block_status"]
          summary?: string | null
          superseded_at?: string | null
          supersedes_revision_id?: string | null
          title: string
        }
        Update: {
          as_of?: string | null
          attributes?: Json
          block_id?: string
          body?: string
          change_kind?: Database["public"]["Enums"]["semantic_change_kind"]
          change_note?: string | null
          company_id?: string
          confidence?: number | null
          context_policy?: Database["public"]["Enums"]["semantic_context_policy"]
          id?: string
          labels?: string[]
          provenance?: Json
          recorded_at?: string
          revision?: number
          salience?: number
          source_interaction_id?: string | null
          status?: Database["public"]["Enums"]["semantic_block_status"]
          summary?: string | null
          superseded_at?: string | null
          supersedes_revision_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "semantic_block_revisions_block_id_company_id_fkey"
            columns: ["block_id", "company_id"]
            isOneToOne: false
            referencedRelation: "semantic_blocks"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "semantic_block_revisions_source_interaction_id_fkey"
            columns: ["source_interaction_id"]
            isOneToOne: false
            referencedRelation: "semantic_interactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "semantic_block_revisions_supersedes_revision_id_fkey"
            columns: ["supersedes_revision_id"]
            isOneToOne: false
            referencedRelation: "semantic_block_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      semantic_blocks: {
        Row: {
          as_of: string | null
          attributes: Json
          body: string
          company_id: string
          confidence: number | null
          context_policy: Database["public"]["Enums"]["semantic_context_policy"]
          created_at: string
          current_revision_id: string | null
          id: string
          key: string
          labels: string[]
          provenance: Json
          revision: number
          salience: number
          search: unknown
          status: Database["public"]["Enums"]["semantic_block_status"]
          summary: string | null
          title: string
          updated_at: string
        }
        Insert: {
          as_of?: string | null
          attributes?: Json
          body: string
          company_id: string
          confidence?: number | null
          context_policy?: Database["public"]["Enums"]["semantic_context_policy"]
          created_at?: string
          current_revision_id?: string | null
          id?: string
          key: string
          labels?: string[]
          provenance?: Json
          revision?: number
          salience?: number
          search?: unknown
          status?: Database["public"]["Enums"]["semantic_block_status"]
          summary?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          as_of?: string | null
          attributes?: Json
          body?: string
          company_id?: string
          confidence?: number | null
          context_policy?: Database["public"]["Enums"]["semantic_context_policy"]
          created_at?: string
          current_revision_id?: string | null
          id?: string
          key?: string
          labels?: string[]
          provenance?: Json
          revision?: number
          salience?: number
          search?: unknown
          status?: Database["public"]["Enums"]["semantic_block_status"]
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "semantic_blocks_current_revision_fkey"
            columns: ["current_revision_id"]
            isOneToOne: false
            referencedRelation: "semantic_block_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      semantic_interactions: {
        Row: {
          company_id: string
          created_at: string
          error: string | null
          external_key: string
          id: string
          occurred_at: string
          outcome: Json | null
          processed_at: string | null
          proposal: Json | null
          run_id: string | null
          source: string
          status: Database["public"]["Enums"]["semantic_interaction_status"]
          thread_id: string | null
          transcript: Json
        }
        Insert: {
          company_id: string
          created_at?: string
          error?: string | null
          external_key: string
          id?: string
          occurred_at?: string
          outcome?: Json | null
          processed_at?: string | null
          proposal?: Json | null
          run_id?: string | null
          source?: string
          status?: Database["public"]["Enums"]["semantic_interaction_status"]
          thread_id?: string | null
          transcript?: Json
        }
        Update: {
          company_id?: string
          created_at?: string
          error?: string | null
          external_key?: string
          id?: string
          occurred_at?: string
          outcome?: Json | null
          processed_at?: string | null
          proposal?: Json | null
          run_id?: string | null
          source?: string
          status?: Database["public"]["Enums"]["semantic_interaction_status"]
          thread_id?: string | null
          transcript?: Json
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
      semantic_block_document: {
        Args: {
          p_body: string
          p_labels: string[]
          p_summary: string
          p_title: string
        }
        Returns: unknown
      }
      semantic_block_revise: {
        Args: {
          p_as_of?: string
          p_attributes?: Json
          p_body: string
          p_change_kind?: Database["public"]["Enums"]["semantic_change_kind"]
          p_change_note?: string
          p_company_id: string
          p_confidence?: number
          p_context_policy?: Database["public"]["Enums"]["semantic_context_policy"]
          p_key: string
          p_labels?: string[]
          p_provenance?: Json
          p_recorded_at?: string
          p_salience?: number
          p_status?: Database["public"]["Enums"]["semantic_block_status"]
          p_summary?: string
          p_title: string
        }
        Returns: {
          block_id: string
          created: boolean
          revision: number
          revision_id: string
        }[]
      }
      semantic_block_search: {
        Args: {
          p_company_id: string
          p_labels?: string[]
          p_limit?: number
          p_statuses?: Database["public"]["Enums"]["semantic_block_status"][]
          p_text?: string
        }
        Returns: {
          as_of: string | null
          attributes: Json
          body: string
          company_id: string
          confidence: number | null
          context_policy: Database["public"]["Enums"]["semantic_context_policy"]
          created_at: string
          current_revision_id: string | null
          id: string
          key: string
          labels: string[]
          provenance: Json
          revision: number
          salience: number
          search: unknown
          status: Database["public"]["Enums"]["semantic_block_status"]
          summary: string | null
          title: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "semantic_blocks"
          isOneToOne: false
          isSetofReturn: true
        }
      }
    }
    Enums: {
      semantic_block_status: "active" | "dormant" | "resolved" | "archived"
      semantic_change_kind:
        | "created"
        | "revised"
        | "corrected"
        | "status_changed"
        | "archived"
      semantic_context_policy: "always" | "when_relevant" | "background"
      semantic_interaction_status:
        | "pending"
        | "processed"
        | "skipped"
        | "failed"
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
      semantic_block_status: ["active", "dormant", "resolved", "archived"],
      semantic_change_kind: [
        "created",
        "revised",
        "corrected",
        "status_changed",
        "archived",
      ],
      semantic_context_policy: ["always", "when_relevant", "background"],
      semantic_interaction_status: [
        "pending",
        "processed",
        "skipped",
        "failed",
      ],
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


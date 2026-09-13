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
      companies: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string | null
          onboarding_completed_at: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string | null
          onboarding_completed_at?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string | null
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
      conversation_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          position: number
          role: string
          thread_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          position?: never
          role: string
          thread_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          position?: never
          role?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "conversation_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_runs: {
        Row: {
          finished_at: string | null
          id: string
          started_at: string
          status: string
          thread_id: string
          user_message_id: string
        }
        Insert: {
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          thread_id: string
          user_message_id: string
        }
        Update: {
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          thread_id?: string
          user_message_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_runs_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "conversation_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_runs_thread_id_user_message_id_fkey"
            columns: ["thread_id", "user_message_id"]
            isOneToOne: false
            referencedRelation: "conversation_messages"
            referencedColumns: ["thread_id", "id"]
          },
        ]
      }
      conversation_threads: {
        Row: {
          company_id: string
          created_at: string
          id: string
          name: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          name?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          name?: string | null
        }
        Relationships: []
      }
      founder_block_revisions: {
        Row: {
          as_of: string | null
          attributes: Json
          block_id: string
          body: string
          change_kind: Database["public"]["Enums"]["semantic_change_kind"]
          change_note: string | null
          confidence: number | null
          founder_id: string
          id: string
          labels: string[]
          provenance: Json
          recorded_at: string
          revision: number
          salience: number
          sensitivity: Database["public"]["Enums"]["founder_block_sensitivity"]
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
          confidence?: number | null
          founder_id: string
          id?: string
          labels?: string[]
          provenance?: Json
          recorded_at?: string
          revision: number
          salience: number
          sensitivity: Database["public"]["Enums"]["founder_block_sensitivity"]
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
          confidence?: number | null
          founder_id?: string
          id?: string
          labels?: string[]
          provenance?: Json
          recorded_at?: string
          revision?: number
          salience?: number
          sensitivity?: Database["public"]["Enums"]["founder_block_sensitivity"]
          status?: Database["public"]["Enums"]["semantic_block_status"]
          summary?: string | null
          superseded_at?: string | null
          supersedes_revision_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "founder_block_revisions_block_id_founder_id_fkey"
            columns: ["block_id", "founder_id"]
            isOneToOne: false
            referencedRelation: "founder_blocks"
            referencedColumns: ["id", "founder_id"]
          },
          {
            foreignKeyName: "founder_block_revisions_supersedes_revision_id_fkey"
            columns: ["supersedes_revision_id"]
            isOneToOne: false
            referencedRelation: "founder_block_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      founder_blocks: {
        Row: {
          as_of: string | null
          attributes: Json
          body: string
          confidence: number | null
          created_at: string
          current_revision_id: string | null
          founder_id: string
          id: string
          key: string
          labels: string[]
          provenance: Json
          revision: number
          salience: number
          search: unknown
          sensitivity: Database["public"]["Enums"]["founder_block_sensitivity"]
          status: Database["public"]["Enums"]["semantic_block_status"]
          summary: string | null
          title: string
          updated_at: string
        }
        Insert: {
          as_of?: string | null
          attributes?: Json
          body: string
          confidence?: number | null
          created_at?: string
          current_revision_id?: string | null
          founder_id: string
          id?: string
          key: string
          labels?: string[]
          provenance?: Json
          revision?: number
          salience?: number
          search?: unknown
          sensitivity?: Database["public"]["Enums"]["founder_block_sensitivity"]
          status?: Database["public"]["Enums"]["semantic_block_status"]
          summary?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          as_of?: string | null
          attributes?: Json
          body?: string
          confidence?: number | null
          created_at?: string
          current_revision_id?: string | null
          founder_id?: string
          id?: string
          key?: string
          labels?: string[]
          provenance?: Json
          revision?: number
          salience?: number
          search?: unknown
          sensitivity?: Database["public"]["Enums"]["founder_block_sensitivity"]
          status?: Database["public"]["Enums"]["semantic_block_status"]
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "founder_blocks_current_revision_fkey"
            columns: ["current_revision_id"]
            isOneToOne: false
            referencedRelation: "founder_block_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      founder_communication_contract_revisions: {
        Row: {
          alerts: Json
          bad_news: string | null
          change_kind: Database["public"]["Enums"]["semantic_change_kind"]
          change_note: string | null
          detail: string | null
          finance_fluency: string | null
          flag_optimistic_assumptions: boolean | null
          founder_id: string
          id: string
          provenance: Json
          pushback: string | null
          recommendations: string | null
          recorded_at: string
          revision: number
        }
        Insert: {
          alerts?: Json
          bad_news?: string | null
          change_kind: Database["public"]["Enums"]["semantic_change_kind"]
          change_note?: string | null
          detail?: string | null
          finance_fluency?: string | null
          flag_optimistic_assumptions?: boolean | null
          founder_id: string
          id?: string
          provenance?: Json
          pushback?: string | null
          recommendations?: string | null
          recorded_at?: string
          revision: number
        }
        Update: {
          alerts?: Json
          bad_news?: string | null
          change_kind?: Database["public"]["Enums"]["semantic_change_kind"]
          change_note?: string | null
          detail?: string | null
          finance_fluency?: string | null
          flag_optimistic_assumptions?: boolean | null
          founder_id?: string
          id?: string
          provenance?: Json
          pushback?: string | null
          recommendations?: string | null
          recorded_at?: string
          revision?: number
        }
        Relationships: []
      }
      onboarding_sessions: {
        Row: {
          checklist: Json
          company_id: string
          completed_at: string | null
          founder_id: string
          id: string
          open_items: Json
          started_at: string
          status: string
          transcript: Json
          updated_at: string
        }
        Insert: {
          checklist?: Json
          company_id: string
          completed_at?: string | null
          founder_id: string
          id?: string
          open_items?: Json
          started_at?: string
          status?: string
          transcript?: Json
          updated_at?: string
        }
        Update: {
          checklist?: Json
          company_id?: string
          completed_at?: string | null
          founder_id?: string
          id?: string
          open_items?: Json
          started_at?: string
          status?: string
          transcript?: Json
          updated_at?: string
        }
        Relationships: []
      }
      payroll_connections: {
        Row: {
          access_token: string
          access_token_expires_at: string
          company_id: string
          created_at: string
          id: string
          last_synced_at: string | null
          provider: string
          provider_company_id: string
          refresh_token: string
          status: string
          updated_at: string
        }
        Insert: {
          access_token: string
          access_token_expires_at: string
          company_id: string
          created_at?: string
          id?: string
          last_synced_at?: string | null
          provider?: string
          provider_company_id: string
          refresh_token: string
          status?: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          access_token_expires_at?: string
          company_id?: string
          created_at?: string
          id?: string
          last_synced_at?: string | null
          provider?: string
          provider_company_id?: string
          refresh_token?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      payroll_employees: {
        Row: {
          annual_salary_usd: number | null
          company_id: string
          created_at: string
          department: string | null
          employment_status: string | null
          first_name: string | null
          hourly_rate_usd: number | null
          id: string
          last_name: string | null
          payment_unit: string | null
          payroll_connection_id: string
          provider_employee_id: string
          start_date: string | null
          termination_date: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          annual_salary_usd?: number | null
          company_id: string
          created_at?: string
          department?: string | null
          employment_status?: string | null
          first_name?: string | null
          hourly_rate_usd?: number | null
          id?: string
          last_name?: string | null
          payment_unit?: string | null
          payroll_connection_id: string
          provider_employee_id: string
          start_date?: string | null
          termination_date?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          annual_salary_usd?: number | null
          company_id?: string
          created_at?: string
          department?: string | null
          employment_status?: string | null
          first_name?: string | null
          hourly_rate_usd?: number | null
          id?: string
          last_name?: string | null
          payment_unit?: string | null
          payroll_connection_id?: string
          provider_employee_id?: string
          start_date?: string | null
          termination_date?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_employees_payroll_connection_id_fkey"
            columns: ["payroll_connection_id"]
            isOneToOne: false
            referencedRelation: "payroll_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          check_date: string
          company_id: string
          created_at: string
          id: string
          pay_period_end: string
          pay_period_start: string
          payroll_connection_id: string
          processed: boolean
          provider_payroll_id: string
          total_employer_cost_usd: number
          total_gross_pay_usd: number
          updated_at: string
        }
        Insert: {
          check_date: string
          company_id: string
          created_at?: string
          id?: string
          pay_period_end: string
          pay_period_start: string
          payroll_connection_id: string
          processed?: boolean
          provider_payroll_id: string
          total_employer_cost_usd: number
          total_gross_pay_usd: number
          updated_at?: string
        }
        Update: {
          check_date?: string
          company_id?: string
          created_at?: string
          id?: string
          pay_period_end?: string
          pay_period_start?: string
          payroll_connection_id?: string
          processed?: boolean
          provider_payroll_id?: string
          total_employer_cost_usd?: number
          total_gross_pay_usd?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_payroll_connection_id_fkey"
            columns: ["payroll_connection_id"]
            isOneToOne: false
            referencedRelation: "payroll_connections"
            referencedColumns: ["id"]
          },
        ]
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
      conversation_begin: {
        Args: { p_company_id: string; p_content: string; p_thread_id?: string }
        Returns: {
          finished_at: string | null
          id: string
          started_at: string
          status: string
          thread_id: string
          user_message_id: string
        }
        SetofOptions: {
          from: "*"
          to: "conversation_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      conversation_finish: {
        Args: {
          p_company_id: string
          p_content?: string
          p_run_id: string
          p_status: string
        }
        Returns: undefined
      }
      founder_block_revise: {
        Args: {
          p_as_of?: string
          p_attributes?: Json
          p_body: string
          p_change_kind?: Database["public"]["Enums"]["semantic_change_kind"]
          p_change_note?: string
          p_confidence?: number
          p_founder_id: string
          p_key: string
          p_labels?: string[]
          p_provenance?: Json
          p_recorded_at?: string
          p_salience?: number
          p_sensitivity?: Database["public"]["Enums"]["founder_block_sensitivity"]
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
      founder_block_search: {
        Args: {
          p_founder_id: string
          p_include_personal?: boolean
          p_labels?: string[]
          p_limit?: number
          p_statuses?: Database["public"]["Enums"]["semantic_block_status"][]
          p_text?: string
        }
        Returns: {
          as_of: string | null
          attributes: Json
          body: string
          confidence: number | null
          created_at: string
          current_revision_id: string | null
          founder_id: string
          id: string
          key: string
          labels: string[]
          provenance: Json
          revision: number
          salience: number
          search: unknown
          sensitivity: Database["public"]["Enums"]["founder_block_sensitivity"]
          status: Database["public"]["Enums"]["semantic_block_status"]
          summary: string | null
          title: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "founder_blocks"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      founder_contract_revise: {
        Args: {
          p_change_kind?: Database["public"]["Enums"]["semantic_change_kind"]
          p_change_note?: string
          p_founder_id: string
          p_patch: Json
          p_provenance?: Json
        }
        Returns: {
          alerts: Json
          bad_news: string | null
          change_kind: Database["public"]["Enums"]["semantic_change_kind"]
          change_note: string | null
          detail: string | null
          finance_fluency: string | null
          flag_optimistic_assumptions: boolean | null
          founder_id: string
          id: string
          provenance: Json
          pushback: string | null
          recommendations: string | null
          recorded_at: string
          revision: number
        }
        SetofOptions: {
          from: "*"
          to: "founder_communication_contract_revisions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      onboarding_session_record: {
        Args: {
          p_checklist?: Json
          p_founder_id: string
          p_messages?: Json
          p_open_items?: Json
          p_session_id: string
        }
        Returns: {
          checklist: Json
          company_id: string
          completed_at: string | null
          founder_id: string
          id: string
          open_items: Json
          started_at: string
          status: string
          transcript: Json
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "onboarding_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      onboarding_session_start: {
        Args: { p_company_id: string; p_founder_id: string }
        Returns: {
          checklist: Json
          company_id: string
          completed_at: string | null
          founder_id: string
          id: string
          open_items: Json
          started_at: string
          status: string
          transcript: Json
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "onboarding_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
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
      founder_block_sensitivity: "standard" | "personal"
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
      source_provider: "plaid" | "rho" | "stripe"
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
      founder_block_sensitivity: ["standard", "personal"],
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
      source_provider: ["plaid", "rho", "stripe"],
      source_record_type: ["account", "transaction"],
      source_sync_status: ["running", "succeeded", "failed"],
    },
  },
} as const


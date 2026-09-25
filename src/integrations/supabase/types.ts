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
      agent_upload_chunks: {
        Row: {
          chunk: string
          seq: number
          upload_id: string
        }
        Insert: {
          chunk: string
          seq: number
          upload_id: string
        }
        Update: {
          chunk?: string
          seq?: number
          upload_id?: string
        }
        Relationships: []
      }
      app_config: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      appointment_category: {
        Row: {
          blocks_availability: boolean
          created_at: string
          id: string
          is_bookable: boolean
          key: string
          label: string
          source: string
          updated_at: string
        }
        Insert: {
          blocks_availability?: boolean
          created_at?: string
          id?: string
          is_bookable?: boolean
          key: string
          label: string
          source: string
          updated_at?: string
        }
        Update: {
          blocks_availability?: boolean
          created_at?: string
          id?: string
          is_bookable?: boolean
          key?: string
          label?: string
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      automation_runs: {
        Row: {
          action_type: string | null
          automation_id: string | null
          automation_name: string | null
          context: Json | null
          created_at: string
          id: string
          message: string | null
          status: string
          tenant_id: string | null
          trigger_type: string | null
        }
        Insert: {
          action_type?: string | null
          automation_id?: string | null
          automation_name?: string | null
          context?: Json | null
          created_at?: string
          id?: string
          message?: string | null
          status: string
          tenant_id?: string | null
          trigger_type?: string | null
        }
        Update: {
          action_type?: string | null
          automation_id?: string | null
          automation_name?: string | null
          context?: Json | null
          created_at?: string
          id?: string
          message?: string | null
          status?: string
          tenant_id?: string | null
          trigger_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
        ]
      }
      automations: {
        Row: {
          action_config: Json
          action_type: string
          created_at: string
          enabled: boolean
          id: string
          name: string
          sort_order: number
          tenant_id: string | null
          trigger_config: Json
          trigger_type: string
          updated_at: string
        }
        Insert: {
          action_config?: Json
          action_type: string
          created_at?: string
          enabled?: boolean
          id?: string
          name: string
          sort_order?: number
          tenant_id?: string | null
          trigger_config?: Json
          trigger_type: string
          updated_at?: string
        }
        Update: {
          action_config?: Json
          action_type?: string
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          sort_order?: number
          tenant_id?: string | null
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      booking: {
        Row: {
          address: string | null
          address_lat: number | null
          address_lng: number | null
          address_source: string | null
          answers: Json
          cancel_reason: string | null
          cancel_token: string | null
          contact_overrides: Json
          created_at: string
          customer_email: string
          customer_name: string
          customer_phone: string | null
          ends_at: string
          google_event_id: string | null
          hero_event_ref: string | null
          hero_project_id: number | null
          id: string
          project_id: string | null
          reschedule_token: string | null
          rule_set_id: string
          staff_id: string
          staff_token: string | null
          starts_at: string
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          address_lat?: number | null
          address_lng?: number | null
          address_source?: string | null
          answers?: Json
          cancel_reason?: string | null
          cancel_token?: string | null
          contact_overrides?: Json
          created_at?: string
          customer_email: string
          customer_name: string
          customer_phone?: string | null
          ends_at: string
          google_event_id?: string | null
          hero_event_ref?: string | null
          hero_project_id?: number | null
          id?: string
          project_id?: string | null
          reschedule_token?: string | null
          rule_set_id: string
          staff_id: string
          staff_token?: string | null
          starts_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          address_lat?: number | null
          address_lng?: number | null
          address_source?: string | null
          answers?: Json
          cancel_reason?: string | null
          cancel_token?: string | null
          contact_overrides?: Json
          created_at?: string
          customer_email?: string
          customer_name?: string
          customer_phone?: string | null
          ends_at?: string
          google_event_id?: string | null
          hero_event_ref?: string | null
          hero_project_id?: number | null
          id?: string
          project_id?: string | null
          reschedule_token?: string | null
          rule_set_id?: string
          staff_id?: string
          staff_token?: string | null
          starts_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_rule_set_id_fkey"
            columns: ["rule_set_id"]
            isOneToOne: false
            referencedRelation: "rule_set"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      busy_block: {
        Row: {
          category_key: string | null
          created_at: string
          ends_at: string
          geo_lat: number | null
          geo_lng: number | null
          id: string
          source: string
          source_ref: string | null
          staff_id: string
          starts_at: string
        }
        Insert: {
          category_key?: string | null
          created_at?: string
          ends_at: string
          geo_lat?: number | null
          geo_lng?: number | null
          id?: string
          source: string
          source_ref?: string | null
          staff_id: string
          starts_at: string
        }
        Update: {
          category_key?: string | null
          created_at?: string
          ends_at?: string
          geo_lat?: number | null
          geo_lng?: number | null
          id?: string
          source?: string
          source_ref?: string | null
          staff_id?: string
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "busy_block_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_location_permissions: {
        Row: {
          assignment_id: string
          can_edit_guest_info: boolean
          id: string
          location_id: string
        }
        Insert: {
          assignment_id: string
          can_edit_guest_info?: boolean
          id?: string
          location_id: string
        }
        Update: {
          assignment_id?: string
          can_edit_guest_info?: boolean
          id?: string
          location_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_location_permissions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "customer_project_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_location_permissions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_notifications: {
        Row: {
          assignment_id: string | null
          completion_sent_at: string | null
          created_at: string
          first_action_sent_at: string | null
          hero_pdf_sent_at: string | null
          id: string
          last_comment_sent_at: string | null
          last_sent_at: string | null
          pending: boolean
        }
        Insert: {
          assignment_id?: string | null
          completion_sent_at?: string | null
          created_at?: string
          first_action_sent_at?: string | null
          hero_pdf_sent_at?: string | null
          id?: string
          last_comment_sent_at?: string | null
          last_sent_at?: string | null
          pending?: boolean
        }
        Update: {
          assignment_id?: string | null
          completion_sent_at?: string | null
          created_at?: string
          first_action_sent_at?: string | null
          hero_pdf_sent_at?: string | null
          id?: string
          last_comment_sent_at?: string | null
          last_sent_at?: string | null
          pending?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "customer_notifications_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: true
            referencedRelation: "customer_project_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_project_assignments: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          project_id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          project_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_project_assignments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_uploads: {
        Row: {
          created_at: string
          customer_id: string
          file_name: string
          id: string
          project_id: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          file_name: string
          id?: string
          project_id: string
          storage_path: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          file_name?: string
          id?: string
          project_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_uploads_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_uploads_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      detail_images: {
        Row: {
          annotated_path: string
          caption: string | null
          created_at: string
          id: string
          location_id: string
          original_path: string
        }
        Insert: {
          annotated_path: string
          caption?: string | null
          created_at?: string
          id?: string
          location_id: string
          original_path: string
        }
        Update: {
          annotated_path?: string
          caption?: string | null
          created_at?: string
          id?: string
          location_id?: string
          original_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "detail_images_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      dropbox_account: {
        Row: {
          access_token: string | null
          access_token_expires_at: string | null
          account_name: string | null
          app_key: string | null
          app_secret: string | null
          connected_at: string | null
          id: number
          refresh_token: string | null
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          access_token_expires_at?: string | null
          account_name?: string | null
          app_key?: string | null
          app_secret?: string | null
          connected_at?: string | null
          id?: number
          refresh_token?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          access_token_expires_at?: string | null
          account_name?: string | null
          app_key?: string | null
          app_secret?: string | null
          connected_at?: string | null
          id?: number
          refresh_token?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      dropbox_synced: {
        Row: {
          created_at: string
          dropbox_path: string | null
          hero_id: number
          kind: string
        }
        Insert: {
          created_at?: string
          dropbox_path?: string | null
          hero_id: number
          kind: string
        }
        Update: {
          created_at?: string
          dropbox_path?: string | null
          hero_id?: number
          kind?: string
        }
        Relationships: []
      }
      employees: {
        Row: {
          created_at: string
          email: string | null
          hero_partner_id: number | null
          id: string
          name: string
          password_hash: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          hero_partner_id?: number | null
          id?: string
          name: string
          password_hash?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          hero_partner_id?: number | null
          id?: string
          name?: string
          password_hash?: string | null
        }
        Relationships: []
      }
      floor_plans: {
        Row: {
          created_at: string
          id: string
          markers: Json
          name: string
          page_index: number
          project_id: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          markers?: Json
          name: string
          page_index?: number
          project_id: string
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          markers?: Json
          name?: string
          page_index?: number
          project_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "floor_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      geocode_cache: {
        Row: {
          created_at: string
          lat: number | null
          lng: number | null
          provider: string
          query: string
        }
        Insert: {
          created_at?: string
          lat?: number | null
          lng?: number | null
          provider?: string
          query: string
        }
        Update: {
          created_at?: string
          lat?: number | null
          lng?: number | null
          provider?: string
          query?: string
        }
        Relationships: []
      }
      hero_open_cache: {
        Row: {
          data: Json
          id: number
          updated_at: string
        }
        Insert: {
          data?: Json
          id?: number
          updated_at?: string
        }
        Update: {
          data?: Json
          id?: number
          updated_at?: string
        }
        Relationships: []
      }
      location_approvals: {
        Row: {
          approved: boolean
          approved_at: string | null
          assignment_id: string
          id: string
          location_id: string
        }
        Insert: {
          approved?: boolean
          approved_at?: string | null
          assignment_id: string
          id?: string
          location_id: string
        }
        Update: {
          approved?: boolean
          approved_at?: string | null
          assignment_id?: string
          id?: string
          location_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_approvals_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "customer_project_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_approvals_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      location_feedback: {
        Row: {
          author_customer_id: string | null
          author_name: string
          author_type: string
          created_at: string
          id: string
          location_id: string
          message: string
          resolved_at: string | null
          status: string
        }
        Insert: {
          author_customer_id?: string | null
          author_name: string
          author_type?: string
          created_at?: string
          id?: string
          location_id: string
          message: string
          resolved_at?: string | null
          status?: string
        }
        Update: {
          author_customer_id?: string | null
          author_name?: string
          author_type?: string
          created_at?: string
          id?: string
          location_id?: string
          message?: string
          resolved_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_feedback_author_customer_id_fkey"
            columns: ["author_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_feedback_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      location_field_config: {
        Row: {
          applies_to: string
          created_at: string
          customer_visible: boolean
          field_key: string
          field_label: string
          field_options: string | null
          field_type: string
          id: string
          is_active: boolean
          is_required: boolean
          sort_order: number
        }
        Insert: {
          applies_to?: string
          created_at?: string
          customer_visible?: boolean
          field_key: string
          field_label: string
          field_options?: string | null
          field_type: string
          id?: string
          is_active?: boolean
          is_required?: boolean
          sort_order?: number
        }
        Update: {
          applies_to?: string
          created_at?: string
          customer_visible?: boolean
          field_key?: string
          field_label?: string
          field_options?: string | null
          field_type?: string
          id?: string
          is_active?: boolean
          is_required?: boolean
          sort_order?: number
        }
        Relationships: []
      }
      location_images: {
        Row: {
          created_at: string
          id: string
          image_type: string
          location_id: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_type: string
          location_id: string
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          image_type?: string
          location_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_images_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      location_pdfs: {
        Row: {
          file_name: string
          id: string
          location_id: string
          storage_path: string
          uploaded_at: string
        }
        Insert: {
          file_name: string
          id?: string
          location_id: string
          storage_path: string
          uploaded_at?: string
        }
        Update: {
          file_name?: string
          id?: string
          location_id?: string
          storage_path?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_pdfs_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          comment: string | null
          created_at: string
          custom_fields: Json | null
          guest_info: string | null
          id: string
          image_data: string | null
          label: string | null
          location_name: string | null
          location_number: string
          location_type: string | null
          project_id: string
          system: string | null
          updated_at: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          custom_fields?: Json | null
          guest_info?: string | null
          id?: string
          image_data?: string | null
          label?: string | null
          location_name?: string | null
          location_number: string
          location_type?: string | null
          project_id: string
          system?: string | null
          updated_at?: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          custom_fields?: Json | null
          guest_info?: string | null
          id?: string
          image_data?: string | null
          label?: string | null
          location_name?: string | null
          location_number?: string
          location_type?: string | null
          project_id?: string
          system?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_notes: {
        Row: {
          action_plan: string | null
          context: string | null
          created_at: string
          created_by: string | null
          hero_logged: boolean
          id: string
          kind: string
          project_id: string | null
          summary: string | null
          title: string | null
          todos_customer: string | null
          todos_internal: string | null
          transcript: string | null
        }
        Insert: {
          action_plan?: string | null
          context?: string | null
          created_at?: string
          created_by?: string | null
          hero_logged?: boolean
          id?: string
          kind?: string
          project_id?: string | null
          summary?: string | null
          title?: string | null
          todos_customer?: string | null
          todos_internal?: string | null
          transcript?: string | null
        }
        Update: {
          action_plan?: string | null
          context?: string | null
          created_at?: string
          created_by?: string | null
          hero_logged?: boolean
          id?: string
          kind?: string
          project_id?: string | null
          summary?: string | null
          title?: string | null
          todos_customer?: string | null
          todos_internal?: string | null
          transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meeting_notes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      mister_x_players: {
        Row: {
          created_at: string
          game_id: string
          id: string
          last_ping: string
          lat: number | null
          lng: number | null
          name: string
          role: string
        }
        Insert: {
          created_at?: string
          game_id: string
          id?: string
          last_ping?: string
          lat?: number | null
          lng?: number | null
          name: string
          role: string
        }
        Update: {
          created_at?: string
          game_id?: string
          id?: string
          last_ping?: string
          lat?: number | null
          lng?: number | null
          name?: string
          role?: string
        }
        Relationships: []
      }
      notification: {
        Row: {
          attempts: number
          booking_id: string | null
          channel: string
          created_at: string
          id: string
          kind: string
          last_error: string | null
          send_after: string
          sent_at: string | null
        }
        Insert: {
          attempts?: number
          booking_id?: string | null
          channel?: string
          created_at?: string
          id?: string
          kind: string
          last_error?: string | null
          send_after?: string
          sent_at?: string | null
        }
        Update: {
          attempts?: number
          booking_id?: string | null
          channel?: string
          created_at?: string
          id?: string
          kind?: string
          last_error?: string | null
          send_after?: string
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          customer_id: string | null
          display_name: string
          employee_id: string | null
          id: string
          is_active: boolean
          role: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          display_name: string
          employee_id?: string | null
          id: string
          is_active?: boolean
          role?: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          display_name?: string
          employee_id?: string | null
          id?: string
          is_active?: boolean
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_public"
            referencedColumns: ["id"]
          },
        ]
      }
      project_employee_assignments: {
        Row: {
          created_at: string
          employee_id: string
          id: string
          project_id: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          id?: string
          project_id: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_employee_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_employee_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_employee_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_field_config: {
        Row: {
          applies_to: string
          created_at: string
          field_key: string
          field_label: string
          field_options: string | null
          field_type: string
          id: string
          is_active: boolean
          is_required: boolean
          sort_order: number
        }
        Insert: {
          applies_to?: string
          created_at?: string
          field_key: string
          field_label: string
          field_options?: string | null
          field_type: string
          id?: string
          is_active?: boolean
          is_required?: boolean
          sort_order?: number
        }
        Update: {
          applies_to?: string
          created_at?: string
          field_key?: string
          field_label?: string
          field_options?: string | null
          field_type?: string
          id?: string
          is_active?: boolean
          is_required?: boolean
          sort_order?: number
        }
        Relationships: []
      }
      project_invites: {
        Row: {
          email: string
          id: string
          project_id: string
          project_number: string | null
          reminder_sent_at: string | null
          sent_at: string
        }
        Insert: {
          email: string
          id?: string
          project_id: string
          project_number?: string | null
          reminder_sent_at?: string | null
          sent_at?: string
        }
        Update: {
          email?: string
          id?: string
          project_id?: string
          project_number?: string | null
          reminder_sent_at?: string | null
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_invites_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_layouts: {
        Row: {
          comment: string | null
          created_at: string | null
          file_name: string | null
          id: string
          project_id: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          comment?: string | null
          created_at?: string | null
          file_name?: string | null
          id?: string
          project_id: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          comment?: string | null
          created_at?: string | null
          file_name?: string | null
          id?: string
          project_id?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      projects: {
        Row: {
          archived_at: string | null
          created_at: string
          custom_fields: Json | null
          customer_name: string | null
          employee_id: string | null
          guest_password: string | null
          id: string
          project_number: string
          project_type: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          custom_fields?: Json | null
          customer_name?: string | null
          employee_id?: string | null
          guest_password?: string | null
          id?: string
          project_number: string
          project_type?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          custom_fields?: Json | null
          customer_name?: string | null
          employee_id?: string | null
          guest_password?: string | null
          id?: string
          project_number?: string
          project_type?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_public"
            referencedColumns: ["id"]
          },
        ]
      }
      projects_backup_before_employee_cleanup: {
        Row: {
          created_at: string | null
          employee_id: string | null
          guest_password: string | null
          id: string | null
          project_number: string | null
          project_type: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          employee_id?: string | null
          guest_password?: string | null
          id?: string | null
          project_number?: string | null
          project_type?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          employee_id?: string | null
          guest_password?: string | null
          id?: string | null
          project_number?: string | null
          project_type?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      public_holiday: {
        Row: {
          active: boolean
          created_at: string
          date: string
          id: string
          name: string
          origin: string
          state_code: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          date: string
          id?: string
          name: string
          origin?: string
          state_code: string
        }
        Update: {
          active?: boolean
          created_at?: string
          date?: string
          id?: string
          name?: string
          origin?: string
          state_code?: string
        }
        Relationships: []
      }
      reminder_log: {
        Row: {
          created_at: string
          detail: string | null
          email: string
          id: string
          project_id: string | null
          project_number: string | null
          status: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          email: string
          id?: string
          project_id?: string | null
          project_number?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          email?: string
          id?: string
          project_id?: string | null
          project_number?: string | null
          status?: string
        }
        Relationships: []
      }
      rule_set: {
        Row: {
          active: boolean
          assignment_mode: string
          auto_confirm: boolean
          booking_window_days: number
          buffer_after_min: number
          buffer_before_min: number
          category_id: string | null
          config: Json
          created_at: string
          duration_minutes: number
          duration_options: number[] | null
          form_fields: Json
          id: string
          key: string
          label: string
          max_per_day_global: number | null
          max_per_day_per_staff: number | null
          min_notice_min: number
          required_skills: string[]
          requires_approval: boolean
          slot_granularity_min: number
          travel_buffer: boolean
          updated_at: string
        }
        Insert: {
          active?: boolean
          assignment_mode?: string
          auto_confirm?: boolean
          booking_window_days?: number
          buffer_after_min?: number
          buffer_before_min?: number
          category_id?: string | null
          config?: Json
          created_at?: string
          duration_minutes: number
          duration_options?: number[] | null
          form_fields?: Json
          id?: string
          key: string
          label: string
          max_per_day_global?: number | null
          max_per_day_per_staff?: number | null
          min_notice_min?: number
          required_skills?: string[]
          requires_approval?: boolean
          slot_granularity_min?: number
          travel_buffer?: boolean
          updated_at?: string
        }
        Update: {
          active?: boolean
          assignment_mode?: string
          auto_confirm?: boolean
          booking_window_days?: number
          buffer_after_min?: number
          buffer_before_min?: number
          category_id?: string | null
          config?: Json
          created_at?: string
          duration_minutes?: number
          duration_options?: number[] | null
          form_fields?: Json
          id?: string
          key?: string
          label?: string
          max_per_day_global?: number | null
          max_per_day_per_staff?: number | null
          min_notice_min?: number
          required_skills?: string[]
          requires_approval?: boolean
          slot_granularity_min?: number
          travel_buffer?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rule_set_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "appointment_category"
            referencedColumns: ["id"]
          },
        ]
      }
      rule_set_staff: {
        Row: {
          rule_set_id: string
          staff_id: string
        }
        Insert: {
          rule_set_id: string
          staff_id: string
        }
        Update: {
          rule_set_id?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rule_set_staff_rule_set_id_fkey"
            columns: ["rule_set_id"]
            isOneToOne: false
            referencedRelation: "rule_set"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_set_staff_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          active: boolean
          created_at: string
          display_name: string
          employee_id: string | null
          google_calendar_id: string | null
          hero_employee_ref: string | null
          home_base_address: string | null
          home_base_lat: number | null
          home_base_lng: number | null
          id: string
          skills: string[]
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_name: string
          employee_id?: string | null
          google_calendar_id?: string | null
          hero_employee_ref?: string | null
          home_base_address?: string | null
          home_base_lat?: number | null
          home_base_lng?: number | null
          id?: string
          skills?: string[]
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_name?: string
          employee_id?: string | null
          google_calendar_id?: string | null
          hero_employee_ref?: string | null
          home_base_address?: string | null
          home_base_lat?: number | null
          home_base_lng?: number | null
          id?: string
          skills?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_public"
            referencedColumns: ["id"]
          },
        ]
      }
      travel_time_cache: {
        Row: {
          cache_key: string
          created_at: string
          minutes: number
          provider: string
        }
        Insert: {
          cache_key: string
          created_at?: string
          minutes: number
          provider?: string
        }
        Update: {
          cache_key?: string
          created_at?: string
          minutes?: number
          provider?: string
        }
        Relationships: []
      }
      vehicle_design_briefings: {
        Row: {
          additional_content: Json | null
          analysis: Json | null
          briefing_text: string | null
          comparison: string | null
          created_at: string | null
          id: string
          inspiration_paths: Json | null
          no_gos: Json | null
          priorities: Json | null
          project_id: string
          variant: string | null
        }
        Insert: {
          additional_content?: Json | null
          analysis?: Json | null
          briefing_text?: string | null
          comparison?: string | null
          created_at?: string | null
          id?: string
          inspiration_paths?: Json | null
          no_gos?: Json | null
          priorities?: Json | null
          project_id: string
          variant?: string | null
        }
        Update: {
          additional_content?: Json | null
          analysis?: Json | null
          briefing_text?: string | null
          comparison?: string | null
          created_at?: string | null
          id?: string
          inspiration_paths?: Json | null
          no_gos?: Json | null
          priorities?: Json | null
          project_id?: string
          variant?: string | null
        }
        Relationships: []
      }
      vehicle_field_config: {
        Row: {
          created_at: string
          field_key: string
          field_label: string
          field_options: string | null
          field_type: string
          id: string
          is_active: boolean
          is_required: boolean
          sort_order: number
        }
        Insert: {
          created_at?: string
          field_key: string
          field_label: string
          field_options?: string | null
          field_type?: string
          id?: string
          is_active?: boolean
          is_required?: boolean
          sort_order?: number
        }
        Update: {
          created_at?: string
          field_key?: string
          field_label?: string
          field_options?: string | null
          field_type?: string
          id?: string
          is_active?: boolean
          is_required?: boolean
          sort_order?: number
        }
        Relationships: []
      }
      vehicle_field_values: {
        Row: {
          field_key: string
          id: string
          project_id: string
          updated_at: string
          value: string | null
        }
        Insert: {
          field_key: string
          id?: string
          project_id: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          field_key?: string
          id?: string
          project_id?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_field_values_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_images: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          project_id: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          project_id: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          project_id?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_images_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_layout_approval: {
        Row: {
          approved: boolean
          approved_at: string | null
          assignment_id: string
          id: string
          project_id: string
        }
        Insert: {
          approved?: boolean
          approved_at?: string | null
          assignment_id: string
          id?: string
          project_id: string
        }
        Update: {
          approved?: boolean
          approved_at?: string | null
          assignment_id?: string
          id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_layout_approval_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_layout_feedback: {
        Row: {
          author_customer_id: string | null
          author_name: string
          author_type: string
          created_at: string
          id: string
          message: string
          project_id: string
          resolved_at: string | null
          status: string
        }
        Insert: {
          author_customer_id?: string | null
          author_name: string
          author_type?: string
          created_at?: string
          id?: string
          message: string
          project_id: string
          resolved_at?: string | null
          status?: string
        }
        Update: {
          author_customer_id?: string | null
          author_name?: string
          author_type?: string
          created_at?: string
          id?: string
          message?: string
          project_id?: string
          resolved_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_layout_feedback_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_layouts: {
        Row: {
          file_name: string
          id: string
          project_id: string
          storage_path: string
          uploaded_at: string
        }
        Insert: {
          file_name: string
          id?: string
          project_id: string
          storage_path: string
          uploaded_at?: string
        }
        Update: {
          file_name?: string
          id?: string
          project_id?: string
          storage_path?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_layouts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_measured_images: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          original_storage_path: string | null
          project_id: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          original_storage_path?: string | null
          project_id: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          original_storage_path?: string | null
          project_id?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_measured_images_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      working_hours: {
        Row: {
          created_at: string
          end_time: string
          id: string
          staff_id: string
          start_time: string
          weekday: number
        }
        Insert: {
          created_at?: string
          end_time: string
          id?: string
          staff_id: string
          start_time: string
          weekday: number
        }
        Update: {
          created_at?: string
          end_time?: string
          id?: string
          staff_id?: string
          start_time?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "working_hours_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      working_hours_exception: {
        Row: {
          created_at: string
          date: string
          end_time: string | null
          id: string
          is_available: boolean
          staff_id: string
          start_time: string | null
        }
        Insert: {
          created_at?: string
          date: string
          end_time?: string | null
          id?: string
          is_available: boolean
          staff_id: string
          start_time?: string | null
        }
        Update: {
          created_at?: string
          date?: string
          end_time?: string | null
          id?: string
          is_available?: boolean
          staff_id?: string
          start_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "working_hours_exception_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      employees_public: {
        Row: {
          created_at: string | null
          id: string | null
          name: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          name?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          name?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      auth_user_id_by_email: { Args: { p_email: string }; Returns: string }
      current_customer_id: { Args: never; Returns: string }
      current_role: { Args: never; Returns: string }
      has_customer_location: { Args: { l: string }; Returns: boolean }
      has_customer_project: { Args: { p: string }; Returns: boolean }
      hero_bauantrag_call: { Args: { p_body: Json }; Returns: Json }
      hero_cache_apply: {
        Args: { p_id: number; p_step_id: number; p_step_name: string }
        Returns: undefined
      }
      hero_delete_dropbox: { Args: { p_path: string }; Returns: Json }
      hero_list_dropbox: { Args: { p_path: string }; Returns: Json }
      hero_open_cached: { Args: never; Returns: Json }
      hero_open_compact: { Args: never; Returns: Json }
      hero_open_compact_page: {
        Args: { p_limit: number; p_offset: number }
        Returns: Json
      }
      hero_open_projects: { Args: { max_pages?: number }; Returns: Json }
      hero_open_summary: { Args: never; Returns: Json }
      hero_project_by_nr: { Args: { p_search: string }; Returns: Json }
      hero_read_dropbox: { Args: { p_path: string }; Returns: Json }
      hero_read_dropbox_binary: { Args: { p_path: string }; Returns: Json }
      hero_refresh_cache: { Args: never; Returns: string }
      hero_set_step: {
        Args: { p_match_id: number; p_step_id: number }
        Returns: Json
      }
      hero_upload_from_dropbox: {
        Args: {
          p_doc_type_id?: number
          p_dropbox_path: string
          p_filename?: string
          p_project_match_id: number
        }
        Returns: Json
      }
      hero_write_dropbox: {
        Args: { p_content: string; p_overwrite?: boolean; p_path: string }
        Returns: Json
      }
      hero_write_dropbox_base64: {
        Args: {
          p_content_base64: string
          p_overwrite?: boolean
          p_path: string
        }
        Returns: Json
      }
      is_staff: { Args: never; Returns: boolean }
      owns_project: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      project_last_activity: {
        Args: { p_created: string; p_id: string }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const

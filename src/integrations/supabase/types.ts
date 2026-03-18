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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
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
          created_at: string
          id: string
          last_sent_at: string | null
          pending: boolean
        }
        Insert: {
          assignment_id?: string | null
          created_at?: string
          id?: string
          last_sent_at?: string | null
          pending?: boolean
        }
        Update: {
          assignment_id?: string | null
          created_at?: string
          id?: string
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
          page_index: number
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
      employees: {
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
      location_field_config: {
        Row: {
          created_at: string
          field_key: string
          field_label: string
          field_options: string | null
          field_type: string
          id: string
          is_active: boolean
          sort_order: number
        }
        Insert: {
          created_at?: string
          field_key: string
          field_label: string
          field_options?: string | null
          field_type: string
          id?: string
          is_active?: boolean
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
      projects: {
        Row: {
          created_at: string
          employee_id: string | null
          guest_password: string | null
          id: string
          project_number: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          employee_id?: string | null
          guest_password?: string | null
          id?: string
          project_number: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          employee_id?: string | null
          guest_password?: string | null
          id?: string
          project_number?: string
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
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      owns_project: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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

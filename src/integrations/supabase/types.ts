export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      client_greeted: {
        Row: {
          greeted_at: string;
          page_id: string;
          sender_id: string;
          user_id: string;
        };
        Insert: {
          greeted_at?: string;
          page_id: string;
          sender_id: string;
          user_id: string;
        };
        Update: {
          greeted_at?: string;
          page_id?: string;
          sender_id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      client_ia_state: {
        Row: {
          client_fb_id: string;
          client_fb_name: string | null;
          created_at: string;
          ia_stopped: boolean;
          id: string;
          page_id: string;
          product_image_offsets: Json;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          client_fb_id: string;
          client_fb_name?: string | null;
          created_at?: string;
          ia_stopped?: boolean;
          id?: string;
          page_id: string;
          product_image_offsets?: Json;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          client_fb_id?: string;
          client_fb_name?: string | null;
          created_at?: string;
          ia_stopped?: boolean;
          id?: string;
          page_id?: string;
          product_image_offsets?: Json;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      comments_log: {
        Row: {
          ai_response: string | null;
          author_id: string | null;
          author_name: string | null;
          comment_id: string;
          content: string | null;
          created_at: string;
          id: string;
          page_id: string;
          post_id: string;
          replied: boolean;
          replied_at: string | null;
          user_id: string;
        };
        Insert: {
          ai_response?: string | null;
          author_id?: string | null;
          author_name?: string | null;
          comment_id: string;
          content?: string | null;
          created_at?: string;
          id?: string;
          page_id: string;
          post_id: string;
          replied?: boolean;
          replied_at?: string | null;
          user_id: string;
        };
        Update: {
          ai_response?: string | null;
          author_id?: string | null;
          author_name?: string | null;
          comment_id?: string;
          content?: string | null;
          created_at?: string;
          id?: string;
          page_id?: string;
          post_id?: string;
          replied?: boolean;
          replied_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      facebook_pages: {
        Row: {
          created_at: string;
          id: string;
          is_connected: boolean;
          page_access_token: string;
          page_id: string;
          page_name: string;
          token_expires_at: string | null;
          updated_at: string;
          user_access_token: string | null;
          user_id: string;
          webhook_subscribed: boolean;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_connected?: boolean;
          page_access_token: string;
          page_id: string;
          page_name: string;
          token_expires_at?: string | null;
          updated_at?: string;
          user_access_token?: string | null;
          user_id: string;
          webhook_subscribed?: boolean;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_connected?: boolean;
          page_access_token?: string;
          page_id?: string;
          page_name?: string;
          token_expires_at?: string | null;
          updated_at?: string;
          user_access_token?: string | null;
          user_id?: string;
          webhook_subscribed?: boolean;
        };
        Relationships: [];
      };
      gemini_keys: {
        Row: {
          api_key: string;
          created_at: string;
          disabled_until: string | null;
          error_count: number;
          id: string;
          is_active: boolean;
          label: string;
          last_used_at: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          api_key: string;
          created_at?: string;
          disabled_until?: string | null;
          error_count?: number;
          id?: string;
          is_active?: boolean;
          label: string;
          last_used_at?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          api_key?: string;
          created_at?: string;
          disabled_until?: string | null;
          error_count?: number;
          id?: string;
          is_active?: boolean;
          label?: string;
          last_used_at?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      messages_log: {
        Row: {
          ai_response: string | null;
          content: string | null;
          created_at: string;
          direction: string;
          id: string;
          media_type: string | null;
          media_url: string | null;
          page_id: string;
          sender_id: string;
          sender_name: string | null;
          status: string;
          user_id: string;
        };
        Insert: {
          ai_response?: string | null;
          content?: string | null;
          created_at?: string;
          direction: string;
          id?: string;
          media_type?: string | null;
          media_url?: string | null;
          page_id: string;
          sender_id: string;
          sender_name?: string | null;
          status?: string;
          user_id: string;
        };
        Update: {
          ai_response?: string | null;
          content?: string | null;
          created_at?: string;
          direction?: string;
          id?: string;
          media_type?: string | null;
          media_url?: string | null;
          page_id?: string;
          sender_id?: string;
          sender_name?: string | null;
          status?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      orders: {
        Row: {
          client_address: string | null;
          client_fb_id: string | null;
          client_fb_name: string | null;
          client_phone: string | null;
          client_whatsapp: string | null;
          created_at: string;
          id: string;
          notes: string | null;
          page_id: string | null;
          payment_reference: string | null;
          product_id: string | null;
          quantity: number;
          status: string;
          training_id: string | null;
          type: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          client_address?: string | null;
          client_fb_id?: string | null;
          client_fb_name?: string | null;
          client_phone?: string | null;
          client_whatsapp?: string | null;
          created_at?: string;
          id?: string;
          notes?: string | null;
          page_id?: string | null;
          payment_reference?: string | null;
          product_id?: string | null;
          quantity?: number;
          status?: string;
          training_id?: string | null;
          type: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          client_address?: string | null;
          client_fb_id?: string | null;
          client_fb_name?: string | null;
          client_phone?: string | null;
          client_whatsapp?: string | null;
          created_at?: string;
          id?: string;
          notes?: string | null;
          page_id?: string | null;
          payment_reference?: string | null;
          product_id?: string | null;
          quantity?: number;
          status?: string;
          training_id?: string | null;
          type?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orders_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_training_id_fkey";
            columns: ["training_id"];
            isOneToOne: false;
            referencedRelation: "trainings";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_methods: {
        Row: {
          created_at: string;
          id: string;
          instructions: string | null;
          is_active: boolean;
          label: string;
          number: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          instructions?: string | null;
          is_active?: boolean;
          label: string;
          number: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          instructions?: string | null;
          is_active?: boolean;
          label?: string;
          number?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      product_images: {
        Row: {
          created_at: string;
          id: string;
          image_path: string;
          product_id: string;
          sort_order: number;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          image_path: string;
          product_id: string;
          sort_order?: number;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          image_path?: string;
          product_id?: string;
          sort_order?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          is_active: boolean;
          name: string;
          payment_flow: string;
          price: number;
          stock: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          payment_flow?: string;
          price?: number;
          stock?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          payment_flow?: string;
          price?: number;
          stock?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string | null;
          email: string | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      prompts: {
        Row: {
          assistance_type: string | null;
          category: string;
          content: string;
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          page_id: string | null;
          page_ids: string[];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          assistance_type?: string | null;
          category?: string;
          content: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          page_id?: string | null;
          page_ids?: string[];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          assistance_type?: string | null;
          category?: string;
          content?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          page_id?: string | null;
          page_ids?: string[];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      scheduled_posts: {
        Row: {
          ai_description: string | null;
          ai_prompt: string | null;
          created_at: string;
          enhance_image: boolean;
          fb_post_id: string | null;
          fb_post_ids: Json;
          frequency: string;
          id: string;
          image_path: string | null;
          image_paths: string[];
          image_url: string | null;
          last_error: string | null;
          last_published_at: string | null;
          media: Json;
          page_id: string | null;
          page_ids: string[];
          scheduled_at: string;
          status: string;
          title: string;
          updated_at: string;
          user_id: string;
          video_path: string | null;
        };
        Insert: {
          ai_description?: string | null;
          ai_prompt?: string | null;
          created_at?: string;
          enhance_image?: boolean;
          fb_post_id?: string | null;
          fb_post_ids?: Json;
          frequency?: string;
          id?: string;
          image_path?: string | null;
          image_paths?: string[];
          image_url?: string | null;
          last_error?: string | null;
          last_published_at?: string | null;
          media?: Json;
          page_id?: string | null;
          page_ids?: string[];
          scheduled_at: string;
          status?: string;
          title: string;
          updated_at?: string;
          user_id: string;
          video_path?: string | null;
        };
        Update: {
          ai_description?: string | null;
          ai_prompt?: string | null;
          created_at?: string;
          enhance_image?: boolean;
          fb_post_id?: string | null;
          fb_post_ids?: Json;
          frequency?: string;
          id?: string;
          image_path?: string | null;
          image_paths?: string[];
          image_url?: string | null;
          last_error?: string | null;
          last_published_at?: string | null;
          media?: Json;
          page_id?: string | null;
          page_ids?: string[];
          scheduled_at?: string;
          status?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
          video_path?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "scheduled_posts_page_id_fkey";
            columns: ["page_id"];
            isOneToOne: false;
            referencedRelation: "facebook_pages";
            referencedColumns: ["id"];
          },
        ];
      };
      settings: {
        Row: {
          assistance_type: string;
          auto_reply_comments: boolean;
          auto_reply_messages: boolean;
          comment_scan_interval_minutes: number;
          default_model: string;
          facebook_app_id: string | null;
          facebook_app_secret: string | null;
          facebook_verify_token: string | null;
          global_ia_stopped: boolean;
          private_message_link: string | null;
          updated_at: string;
          use_lovable_ai_fallback: boolean;
          user_id: string;
        };
        Insert: {
          assistance_type?: string;
          auto_reply_comments?: boolean;
          auto_reply_messages?: boolean;
          comment_scan_interval_minutes?: number;
          default_model?: string;
          facebook_app_id?: string | null;
          facebook_app_secret?: string | null;
          facebook_verify_token?: string | null;
          global_ia_stopped?: boolean;
          private_message_link?: string | null;
          updated_at?: string;
          use_lovable_ai_fallback?: boolean;
          user_id: string;
        };
        Update: {
          assistance_type?: string;
          auto_reply_comments?: boolean;
          auto_reply_messages?: boolean;
          comment_scan_interval_minutes?: number;
          default_model?: string;
          facebook_app_id?: string | null;
          facebook_app_secret?: string | null;
          facebook_verify_token?: string | null;
          global_ia_stopped?: boolean;
          private_message_link?: string | null;
          updated_at?: string;
          use_lovable_ai_fallback?: boolean;
          user_id?: string;
        };
        Relationships: [];
      };
      training_files: {
        Row: {
          created_at: string;
          external_url: string | null;
          file_name: string;
          file_path: string | null;
          file_type: string;
          id: string;
          size_bytes: number | null;
          training_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          external_url?: string | null;
          file_name: string;
          file_path?: string | null;
          file_type: string;
          id?: string;
          size_bytes?: number | null;
          training_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          external_url?: string | null;
          file_name?: string;
          file_path?: string | null;
          file_type?: string;
          id?: string;
          size_bytes?: number | null;
          training_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "training_files_training_id_fkey";
            columns: ["training_id"];
            isOneToOne: false;
            referencedRelation: "trainings";
            referencedColumns: ["id"];
          },
        ];
      };
      trainings: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          is_active: boolean;
          name: string;
          payment_flow: string | null;
          price: number | null;
          pricing_type: string;
          updated_at: string;
          user_id: string;
          video_link: string | null;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          payment_flow?: string | null;
          price?: number | null;
          pricing_type: string;
          updated_at?: string;
          user_id: string;
          video_link?: string | null;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          payment_flow?: string | null;
          price?: number | null;
          pricing_type?: string;
          updated_at?: string;
          user_id?: string;
          video_link?: string | null;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      verify_facebook_webhook_token: {
        Args: { _token: string };
        Returns: boolean;
      };
    };
    Enums: {
      app_role: "admin" | "user";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const;

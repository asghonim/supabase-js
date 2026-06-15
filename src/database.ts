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
      account_avatars: {
        Row: {
          account_id: number
          created_at: string
          id: number
          uid: string
          url: string
        }
        Insert: {
          account_id: number
          created_at: string
          id?: never
          uid?: string
          url: string
        }
        Update: {
          account_id?: number
          created_at?: string
          id?: never
          uid?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_avatars_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      account_names: {
        Row: {
          account_id: number
          created_at: string
          id: number
          name: string
          uid: string
        }
        Insert: {
          account_id: number
          created_at: string
          id?: never
          name: string
          uid?: string
        }
        Update: {
          account_id?: number
          created_at?: string
          id?: never
          name?: string
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_names_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      account_platform_roles: {
        Row: {
          account_id: number
          created_at: string
          granted_by_account_id: number | null
          platform_role_id: number
        }
        Insert: {
          account_id: number
          created_at?: string
          granted_by_account_id?: number | null
          platform_role_id: number
        }
        Update: {
          account_id?: number
          created_at?: string
          granted_by_account_id?: number | null
          platform_role_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "account_platform_roles_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_platform_roles_granted_by_account_id_fkey"
            columns: ["granted_by_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_platform_roles_platform_role_id_fkey"
            columns: ["platform_role_id"]
            isOneToOne: false
            referencedRelation: "platform_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          created_at: string
          id: number
          uid: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: never
          uid?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: never
          uid?: string
          user_id?: string | null
        }
        Relationships: []
      }
      addon_feature_entitlements: {
        Row: {
          addon_version_id: number
          created_at: string
          feature_id: number
          id: number
          reset_period: Database["public"]["Enums"]["feature_reset_period"]
          uid: string
          value_boolean: boolean | null
          value_limit: number | null
        }
        Insert: {
          addon_version_id: number
          created_at?: string
          feature_id: number
          id?: never
          reset_period?: Database["public"]["Enums"]["feature_reset_period"]
          uid?: string
          value_boolean?: boolean | null
          value_limit?: number | null
        }
        Update: {
          addon_version_id?: number
          created_at?: string
          feature_id?: number
          id?: never
          reset_period?: Database["public"]["Enums"]["feature_reset_period"]
          uid?: string
          value_boolean?: boolean | null
          value_limit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "addon_feature_entitlements_addon_version_id_fkey"
            columns: ["addon_version_id"]
            isOneToOne: false
            referencedRelation: "addon_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addon_feature_entitlements_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["id"]
          },
        ]
      }
      addon_versions: {
        Row: {
          addon_id: number
          billing_interval: Database["public"]["Enums"]["billing_interval"]
          billing_provider_price_id: string | null
          created_at: string
          currency: string
          effective_from: string
          id: number
          is_active: boolean
          price_amount: number
          uid: string
        }
        Insert: {
          addon_id: number
          billing_interval?: Database["public"]["Enums"]["billing_interval"]
          billing_provider_price_id?: string | null
          created_at?: string
          currency?: string
          effective_from?: string
          id?: never
          is_active?: boolean
          price_amount: number
          uid?: string
        }
        Update: {
          addon_id?: number
          billing_interval?: Database["public"]["Enums"]["billing_interval"]
          billing_provider_price_id?: string | null
          created_at?: string
          currency?: string
          effective_from?: string
          id?: never
          is_active?: boolean
          price_amount?: number
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "addon_versions_addon_id_fkey"
            columns: ["addon_id"]
            isOneToOne: false
            referencedRelation: "addons"
            referencedColumns: ["id"]
          },
        ]
      }
      addons: {
        Row: {
          created_at: string
          description: string | null
          id: number
          is_active: boolean
          key: string
          name: string
          uid: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: never
          is_active?: boolean
          key: string
          name: string
          uid?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: never
          is_active?: boolean
          key?: string
          name?: string
          uid?: string
          updated_at?: string
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          account_id: number
          created_at: string
          expires_at: string | null
          id: number
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          org_id: number
          revoked_at: string | null
          scopes: string[]
          uid: string
        }
        Insert: {
          account_id: number
          created_at?: string
          expires_at?: string | null
          id?: never
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          org_id: number
          revoked_at?: string | null
          scopes?: string[]
          uid?: string
        }
        Update: {
          account_id?: number
          created_at?: string
          expires_at?: string | null
          id?: never
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          org_id?: number
          revoked_at?: string | null
          scopes?: string[]
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_scopes: {
        Row: {
          created_at: string
          description: string | null
          id: number
          key: string
          name: string
          uid: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: never
          key: string
          name: string
          uid?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: never
          key?: string
          name?: string
          uid?: string
        }
        Relationships: []
      }
      attribute_values: {
        Row: {
          attribute_id: number
          created_at: string
          id: number
          sort_order: number
          uid: string
          value: string
        }
        Insert: {
          attribute_id: number
          created_at?: string
          id?: never
          sort_order?: number
          uid?: string
          value: string
        }
        Update: {
          attribute_id?: number
          created_at?: string
          id?: never
          sort_order?: number
          uid?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "attribute_values_attribute_id_fkey"
            columns: ["attribute_id"]
            isOneToOne: false
            referencedRelation: "attributes"
            referencedColumns: ["id"]
          },
        ]
      }
      attributes: {
        Row: {
          created_at: string
          id: number
          name: string
          uid: string
        }
        Insert: {
          created_at?: string
          id?: never
          name: string
          uid?: string
        }
        Update: {
          created_at?: string
          id?: never
          name?: string
          uid?: string
        }
        Relationships: []
      }
      auction_bids: {
        Row: {
          amount: number
          auction_id: number
          bidder_id: number
          created_at: string
          id: number
          is_proxy: boolean
          uid: string
        }
        Insert: {
          amount: number
          auction_id: number
          bidder_id: number
          created_at?: string
          id?: never
          is_proxy?: boolean
          uid?: string
        }
        Update: {
          amount?: number
          auction_id?: number
          bidder_id?: number
          created_at?: string
          id?: never
          is_proxy?: boolean
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "auction_bids_auction_id_fkey"
            columns: ["auction_id"]
            isOneToOne: false
            referencedRelation: "auctions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auction_bids_bidder_id_fkey"
            columns: ["bidder_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      auction_statistics: {
        Row: {
          auction_id: number
          bid_count: number
          highest_bid: number | null
          highest_bidder_id: number | null
        }
        Insert: {
          auction_id: number
          bid_count?: number
          highest_bid?: number | null
          highest_bidder_id?: number | null
        }
        Update: {
          auction_id?: number
          bid_count?: number
          highest_bid?: number | null
          highest_bidder_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "auction_statistics_auction_id_fkey"
            columns: ["auction_id"]
            isOneToOne: true
            referencedRelation: "auctions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auction_statistics_highest_bidder_id_fkey"
            columns: ["highest_bidder_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      auctions: {
        Row: {
          buy_now_price: number | null
          created_at: string
          end_time: string
          extended_count: number
          extension_minutes: number
          id: number
          listing_id: number
          minimum_increment: number
          original_end_time: string
          reserve_price: number | null
          start_time: string
          starting_price: number
          status: Database["public"]["Enums"]["auction_status"]
          uid: string
        }
        Insert: {
          buy_now_price?: number | null
          created_at?: string
          end_time: string
          extended_count?: number
          extension_minutes?: number
          id?: never
          listing_id: number
          minimum_increment?: number
          original_end_time: string
          reserve_price?: number | null
          start_time: string
          starting_price?: number
          status?: Database["public"]["Enums"]["auction_status"]
          uid?: string
        }
        Update: {
          buy_now_price?: number | null
          created_at?: string
          end_time?: string
          extended_count?: number
          extension_minutes?: number
          id?: never
          listing_id?: number
          minimum_increment?: number
          original_end_time?: string
          reserve_price?: number | null
          start_time?: string
          starting_price?: number
          status?: Database["public"]["Enums"]["auction_status"]
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "auctions_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_webhook_events: {
        Row: {
          billing_provider: Database["public"]["Enums"]["billing_provider"]
          created_at: string
          event_id: string
          event_type: string
          failure_reason: string | null
          id: number
          payload: Json
          processed_at: string | null
          retry_count: number
          status: Database["public"]["Enums"]["webhook_event_status"]
          uid: string
        }
        Insert: {
          billing_provider: Database["public"]["Enums"]["billing_provider"]
          created_at?: string
          event_id: string
          event_type: string
          failure_reason?: string | null
          id?: never
          payload?: Json
          processed_at?: string | null
          retry_count?: number
          status?: Database["public"]["Enums"]["webhook_event_status"]
          uid?: string
        }
        Update: {
          billing_provider?: Database["public"]["Enums"]["billing_provider"]
          created_at?: string
          event_id?: string
          event_type?: string
          failure_reason?: string | null
          id?: never
          payload?: Json
          processed_at?: string | null
          retry_count?: number
          status?: Database["public"]["Enums"]["webhook_event_status"]
          uid?: string
        }
        Relationships: []
      }
      cart_items: {
        Row: {
          cart_id: number
          created_at: string
          id: number
          listing_id: number
          quantity: number
          uid: string
        }
        Insert: {
          cart_id: number
          created_at?: string
          id?: never
          listing_id: number
          quantity?: number
          uid?: string
        }
        Update: {
          cart_id?: number
          created_at?: string
          id?: never
          listing_id?: number
          quantity?: number
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      carts: {
        Row: {
          account_id: number
          created_at: string
          currency: string
          id: number
          status: Database["public"]["Enums"]["cart_status"]
          uid: string
          updated_at: string
        }
        Insert: {
          account_id: number
          created_at?: string
          currency?: string
          id?: never
          status?: Database["public"]["Enums"]["cart_status"]
          uid?: string
          updated_at?: string
        }
        Update: {
          account_id?: number
          created_at?: string
          currency?: string
          id?: never
          status?: Database["public"]["Enums"]["cart_status"]
          uid?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          id: number
          name: string
          organization_id: number
          parent_category_id: number | null
          slug: string
          uid: string
        }
        Insert: {
          created_at?: string
          id?: never
          name: string
          organization_id: number
          parent_category_id?: number | null
          slug: string
          uid?: string
        }
        Update: {
          created_at?: string
          id?: never
          name?: string
          organization_id?: number
          parent_category_id?: number | null
          slug?: string
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_parent_category_id_fkey"
            columns: ["parent_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      checkout_items: {
        Row: {
          checkout_session_id: number
          created_at: string
          discount_amount: number
          id: number
          line_total: number
          listing_id: number
          quantity: number
          seller_id: number
          snapshot_sku: string | null
          snapshot_title: string
          tax_amount: number
          uid: string
          unit_price: number
        }
        Insert: {
          checkout_session_id: number
          created_at?: string
          discount_amount?: number
          id?: never
          line_total?: number
          listing_id: number
          quantity?: number
          seller_id: number
          snapshot_sku?: string | null
          snapshot_title: string
          tax_amount?: number
          uid?: string
          unit_price: number
        }
        Update: {
          checkout_session_id?: number
          created_at?: string
          discount_amount?: number
          id?: never
          line_total?: number
          listing_id?: number
          quantity?: number
          seller_id?: number
          snapshot_sku?: string | null
          snapshot_title?: string
          tax_amount?: number
          uid?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "checkout_items_checkout_session_id_fkey"
            columns: ["checkout_session_id"]
            isOneToOne: false
            referencedRelation: "checkout_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkout_items_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkout_items_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "seller_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      checkout_sessions: {
        Row: {
          account_id: number
          cart_id: number | null
          created_at: string
          currency: string
          discount: number
          expires_at: string
          id: number
          shipping: number
          status: Database["public"]["Enums"]["checkout_status"]
          subtotal: number
          tax: number
          total: number
          uid: string
        }
        Insert: {
          account_id: number
          cart_id?: number | null
          created_at?: string
          currency?: string
          discount?: number
          expires_at?: string
          id?: never
          shipping?: number
          status?: Database["public"]["Enums"]["checkout_status"]
          subtotal?: number
          tax?: number
          total?: number
          uid?: string
        }
        Update: {
          account_id?: number
          cart_id?: number | null
          created_at?: string
          currency?: string
          discount?: number
          expires_at?: string
          id?: never
          shipping?: number
          status?: Database["public"]["Enums"]["checkout_status"]
          subtotal?: number
          tax?: number
          total?: number
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "checkout_sessions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkout_sessions_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
        ]
      }
      commissions: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: number
          journal_entry_id: number | null
          order_item_id: number
          percentage: number
          seller_id: number
          uid: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: never
          journal_entry_id?: number | null
          order_item_id: number
          percentage: number
          seller_id: number
          uid?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: never
          journal_entry_id?: number | null
          order_item_id?: number
          percentage?: number
          seller_id?: number
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "commissions_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: true
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "seller_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      content_blocks: {
        Row: {
          block_order: number
          block_type: string
          content_version_id: number
          data_json: Json
          id: number
          uid: string
        }
        Insert: {
          block_order: number
          block_type: string
          content_version_id: number
          data_json?: Json
          id?: never
          uid?: string
        }
        Update: {
          block_order?: number
          block_type?: string
          content_version_id?: number
          data_json?: Json
          id?: never
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_blocks_content_version_id_fkey"
            columns: ["content_version_id"]
            isOneToOne: false
            referencedRelation: "content_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      content_categories: {
        Row: {
          category_id: number
          content_id: number
        }
        Insert: {
          category_id: number
          content_id: number
        }
        Update: {
          category_id?: number
          content_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_categories_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
        ]
      }
      content_history: {
        Row: {
          action: string
          content_id: number
          created_at: string
          id: number
          new_values_json: Json | null
          old_values_json: Json | null
          performed_by_account_id: number | null
          uid: string
        }
        Insert: {
          action: string
          content_id: number
          created_at?: string
          id?: never
          new_values_json?: Json | null
          old_values_json?: Json | null
          performed_by_account_id?: number | null
          uid?: string
        }
        Update: {
          action?: string
          content_id?: number
          created_at?: string
          id?: never
          new_values_json?: Json | null
          old_values_json?: Json | null
          performed_by_account_id?: number | null
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_history_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_history_performed_by_account_id_fkey"
            columns: ["performed_by_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      content_media: {
        Row: {
          content_version_id: number
          media_id: number
        }
        Insert: {
          content_version_id: number
          media_id: number
        }
        Update: {
          content_version_id?: number
          media_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_media_content_version_id_fkey"
            columns: ["content_version_id"]
            isOneToOne: false
            referencedRelation: "content_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_media_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
        ]
      }
      content_snippets: {
        Row: {
          created_at: string
          data_json: Json
          id: number
          organization_id: number
          slug: string
          uid: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          data_json?: Json
          id?: never
          organization_id: number
          slug: string
          uid?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          data_json?: Json
          id?: never
          organization_id?: number
          slug?: string
          uid?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_snippets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_tags: {
        Row: {
          content_id: number
          tag_id: number
        }
        Insert: {
          content_id: number
          tag_id: number
        }
        Update: {
          content_id?: number
          tag_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_tags_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      content_translations: {
        Row: {
          body_json: Json
          content_id: number
          created_at: string
          id: number
          language: string
          seo_description: string | null
          seo_title: string | null
          title: string
          uid: string
          updated_at: string
        }
        Insert: {
          body_json?: Json
          content_id: number
          created_at?: string
          id?: never
          language: string
          seo_description?: string | null
          seo_title?: string | null
          title: string
          uid?: string
          updated_at?: string
        }
        Update: {
          body_json?: Json
          content_id?: number
          created_at?: string
          id?: never
          language?: string
          seo_description?: string | null
          seo_title?: string | null
          title?: string
          uid?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_translations_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
        ]
      }
      content_types: {
        Row: {
          created_at: string
          description: string | null
          id: number
          name: string
          organization_id: number | null
          slug: string
          uid: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: never
          name: string
          organization_id?: number | null
          slug: string
          uid?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: never
          name?: string
          organization_id?: number | null
          slug?: string
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_versions: {
        Row: {
          body_json: Json
          content_id: number
          created_at: string
          created_by_account_id: number | null
          id: number
          seo_description: string | null
          seo_title: string | null
          summary: string | null
          title: string
          uid: string
          version_number: number
        }
        Insert: {
          body_json?: Json
          content_id: number
          created_at?: string
          created_by_account_id?: number | null
          id?: never
          seo_description?: string | null
          seo_title?: string | null
          summary?: string | null
          title: string
          uid?: string
          version_number: number
        }
        Update: {
          body_json?: Json
          content_id?: number
          created_at?: string
          created_by_account_id?: number | null
          id?: never
          seo_description?: string | null
          seo_title?: string | null
          summary?: string | null
          title?: string
          uid?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_versions_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_versions_created_by_account_id_fkey"
            columns: ["created_by_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      contents: {
        Row: {
          content_type_id: number
          created_at: string
          created_by_account_id: number | null
          id: number
          organization_id: number
          publish_at: string | null
          published_version_id: number | null
          slug: string
          status: string
          title: string
          uid: string
          unpublish_at: string | null
          updated_at: string
        }
        Insert: {
          content_type_id: number
          created_at?: string
          created_by_account_id?: number | null
          id?: never
          organization_id: number
          publish_at?: string | null
          published_version_id?: number | null
          slug: string
          status?: string
          title: string
          uid?: string
          unpublish_at?: string | null
          updated_at?: string
        }
        Update: {
          content_type_id?: number
          created_at?: string
          created_by_account_id?: number | null
          id?: never
          organization_id?: number
          publish_at?: string | null
          published_version_id?: number | null
          slug?: string
          status?: string
          title?: string
          uid?: string
          unpublish_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contents_content_type_id_fkey"
            columns: ["content_type_id"]
            isOneToOne: false
            referencedRelation: "content_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contents_created_by_account_id_fkey"
            columns: ["created_by_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_contents_published_version"
            columns: ["id", "published_version_id"]
            isOneToOne: false
            referencedRelation: "content_versions"
            referencedColumns: ["content_id", "id"]
          },
        ]
      }
      conversation_participants: {
        Row: {
          account_id: number
          conversation_id: number
          created_at: string
          id: number
          joined_at: string
          role: Database["public"]["Enums"]["conversation_participant_role"]
          uid: string
        }
        Insert: {
          account_id: number
          conversation_id: number
          created_at?: string
          id?: never
          joined_at?: string
          role?: Database["public"]["Enums"]["conversation_participant_role"]
          uid?: string
        }
        Update: {
          account_id?: number
          conversation_id?: number
          created_at?: string
          id?: never
          joined_at?: string
          role?: Database["public"]["Enums"]["conversation_participant_role"]
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participants_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_reads: {
        Row: {
          account_id: number
          conversation_id: number
          created_at: string
          id: number
          last_read_at: string
          last_read_message_id: number | null
          last_read_message_number: number | null
          uid: string
        }
        Insert: {
          account_id: number
          conversation_id: number
          created_at?: string
          id?: never
          last_read_at?: string
          last_read_message_id?: number | null
          last_read_message_number?: number | null
          uid?: string
        }
        Update: {
          account_id?: number
          conversation_id?: number
          created_at?: string
          id?: never
          last_read_at?: string
          last_read_message_id?: number | null
          last_read_message_number?: number | null
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_reads_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_reads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_reads_last_read_message_id_fkey"
            columns: ["last_read_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_targets: {
        Row: {
          conversation_id: number
          created_at: string
          id: number
          target_id: string
          target_type: string
          uid: string
        }
        Insert: {
          conversation_id: number
          created_at?: string
          id?: never
          target_id: string
          target_type: string
          uid?: string
        }
        Update: {
          conversation_id?: number
          created_at?: string
          id?: never
          target_id?: string
          target_type?: string
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_targets_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          created_by: number | null
          id: number
          last_message_at: string | null
          last_message_number: number | null
          message_count: number
          tenant_id: number | null
          title: string | null
          type: Database["public"]["Enums"]["conversation_type"]
          uid: string
        }
        Insert: {
          created_at?: string
          created_by?: number | null
          id?: never
          last_message_at?: string | null
          last_message_number?: number | null
          message_count?: number
          tenant_id?: number | null
          title?: string | null
          type?: Database["public"]["Enums"]["conversation_type"]
          uid?: string
        }
        Update: {
          created_at?: string
          created_by?: number | null
          id?: never
          last_message_at?: string | null
          last_message_number?: number | null
          message_count?: number
          tenant_id?: number | null
          title?: string | null
          type?: Database["public"]["Enums"]["conversation_type"]
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_notes: {
        Row: {
          billing_provider_credit_note_id: string | null
          created_at: string
          currency: string
          id: number
          invoice_id: number
          number: string | null
          organization_id: number
          reason: Database["public"]["Enums"]["credit_note_reason"]
          status: Database["public"]["Enums"]["credit_note_status"]
          total_amount: number
          uid: string
          voided_at: string | null
        }
        Insert: {
          billing_provider_credit_note_id?: string | null
          created_at?: string
          currency?: string
          id?: never
          invoice_id: number
          number?: string | null
          organization_id: number
          reason: Database["public"]["Enums"]["credit_note_reason"]
          status?: Database["public"]["Enums"]["credit_note_status"]
          total_amount?: number
          uid?: string
          voided_at?: string | null
        }
        Update: {
          billing_provider_credit_note_id?: string | null
          created_at?: string
          currency?: string
          id?: never
          invoice_id?: number
          number?: string | null
          organization_id?: number
          reason?: Database["public"]["Enums"]["credit_note_reason"]
          status?: Database["public"]["Enums"]["credit_note_status"]
          total_amount?: number
          uid?: string
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_notes_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      features: {
        Row: {
          created_at: string
          description: string | null
          id: number
          is_active: boolean
          key: string
          name: string
          type: Database["public"]["Enums"]["feature_type"]
          uid: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: never
          is_active?: boolean
          key: string
          name: string
          type: Database["public"]["Enums"]["feature_type"]
          uid?: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: never
          is_active?: boolean
          key?: string
          name?: string
          type?: Database["public"]["Enums"]["feature_type"]
          uid?: string
          unit?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      idempotency_keys: {
        Row: {
          created_at: string
          expires_at: string
          id: number
          key: string
          locked_at: string | null
          request_hash: string
          request_path: string
          response_body: Json | null
          response_status: number | null
          uid: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: never
          key: string
          locked_at?: string | null
          request_hash: string
          request_path: string
          response_body?: Json | null
          response_status?: number | null
          uid?: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: never
          key?: string
          locked_at?: string | null
          request_hash?: string
          request_path?: string
          response_body?: Json | null
          response_status?: number | null
          uid?: string
        }
        Relationships: []
      }
      inventory_reservations: {
        Row: {
          created_at: string
          expires_at: string | null
          id: number
          quantity: number
          reference_id: number
          reference_type: string
          released_at: string | null
          status: Database["public"]["Enums"]["reservation_status"]
          uid: string
          variant_id: number
          warehouse_id: number | null
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: never
          quantity: number
          reference_id: number
          reference_type: string
          released_at?: string | null
          status?: Database["public"]["Enums"]["reservation_status"]
          uid?: string
          variant_id: number
          warehouse_id?: number | null
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: never
          quantity?: number
          reference_id?: number
          reference_type?: string
          released_at?: string | null
          status?: Database["public"]["Enums"]["reservation_status"]
          uid?: string
          variant_id?: number
          warehouse_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_reservations_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_reservations_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_transactions: {
        Row: {
          created_at: string
          id: number
          note: string | null
          quantity_change: number
          reason: string
          reference_id: number | null
          reference_type: string | null
          uid: string
          variant_id: number
          warehouse_id: number
        }
        Insert: {
          created_at?: string
          id?: never
          note?: string | null
          quantity_change: number
          reason: string
          reference_id?: number | null
          reference_type?: string | null
          uid?: string
          variant_id: number
          warehouse_id: number
        }
        Update: {
          created_at?: string
          id?: never
          note?: string | null
          quantity_change?: number
          reason?: string
          reference_id?: number | null
          reference_type?: string | null
          uid?: string
          variant_id?: number
          warehouse_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transactions_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_line_items: {
        Row: {
          billing_provider_line_item_id: string | null
          created_at: string
          description: string
          id: number
          invoice_id: number
          metadata: Json
          period_end: string | null
          period_start: string | null
          quantity: number
          snapshot_feature_key: string | null
          snapshot_plan_name: string | null
          total_amount: number
          type: string
          uid: string
          unit_amount: number
        }
        Insert: {
          billing_provider_line_item_id?: string | null
          created_at?: string
          description: string
          id?: never
          invoice_id: number
          metadata?: Json
          period_end?: string | null
          period_start?: string | null
          quantity?: number
          snapshot_feature_key?: string | null
          snapshot_plan_name?: string | null
          total_amount?: number
          type: string
          uid?: string
          unit_amount?: number
        }
        Update: {
          billing_provider_line_item_id?: string | null
          created_at?: string
          description?: string
          id?: never
          invoice_id?: number
          metadata?: Json
          period_end?: string | null
          period_start?: string | null
          quantity?: number
          snapshot_feature_key?: string | null
          snapshot_plan_name?: string | null
          total_amount?: number
          type?: string
          uid?: string
          unit_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_due: number
          amount_paid: number
          billing_provider:
            | Database["public"]["Enums"]["billing_provider"]
            | null
          billing_provider_invoice_id: string | null
          billing_reason: Database["public"]["Enums"]["billing_reason"] | null
          created_at: string
          currency: string
          discount_amount: number
          due_date: string | null
          id: number
          idempotency_key: string | null
          metadata: Json
          number: string | null
          organization_id: number
          paid_at: string | null
          period_end: string | null
          period_start: string | null
          snapshot_customer_address: Json | null
          snapshot_customer_email: string | null
          snapshot_customer_name: string | null
          snapshot_plan_name: string | null
          snapshot_tax_rates: Json
          status: Database["public"]["Enums"]["invoice_status"]
          subscription_id: number | null
          subtotal_amount: number
          tax_amount: number
          total_amount: number
          type: Database["public"]["Enums"]["invoice_type"]
          uid: string
          updated_at: string
          voided_at: string | null
        }
        Insert: {
          amount_due?: number
          amount_paid?: number
          billing_provider?:
            | Database["public"]["Enums"]["billing_provider"]
            | null
          billing_provider_invoice_id?: string | null
          billing_reason?: Database["public"]["Enums"]["billing_reason"] | null
          created_at?: string
          currency?: string
          discount_amount?: number
          due_date?: string | null
          id?: never
          idempotency_key?: string | null
          metadata?: Json
          number?: string | null
          organization_id: number
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          snapshot_customer_address?: Json | null
          snapshot_customer_email?: string | null
          snapshot_customer_name?: string | null
          snapshot_plan_name?: string | null
          snapshot_tax_rates?: Json
          status?: Database["public"]["Enums"]["invoice_status"]
          subscription_id?: number | null
          subtotal_amount?: number
          tax_amount?: number
          total_amount?: number
          type?: Database["public"]["Enums"]["invoice_type"]
          uid?: string
          updated_at?: string
          voided_at?: string | null
        }
        Update: {
          amount_due?: number
          amount_paid?: number
          billing_provider?:
            | Database["public"]["Enums"]["billing_provider"]
            | null
          billing_provider_invoice_id?: string | null
          billing_reason?: Database["public"]["Enums"]["billing_reason"] | null
          created_at?: string
          currency?: string
          discount_amount?: number
          due_date?: string | null
          id?: never
          idempotency_key?: string | null
          metadata?: Json
          number?: string | null
          organization_id?: number
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          snapshot_customer_address?: Json | null
          snapshot_customer_email?: string | null
          snapshot_customer_name?: string | null
          snapshot_plan_name?: string | null
          snapshot_tax_rates?: Json
          status?: Database["public"]["Enums"]["invoice_status"]
          subscription_id?: number | null
          subtotal_amount?: number
          tax_amount?: number
          total_amount?: number
          type?: Database["public"]["Enums"]["invoice_type"]
          uid?: string
          updated_at?: string
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          created_at: string
          description: string | null
          id: number
          idempotency_key: string | null
          posted_at: string | null
          reference_id: number | null
          reference_type: string | null
          uid: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: never
          idempotency_key?: string | null
          posted_at?: string | null
          reference_id?: number | null
          reference_type?: string | null
          uid?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: never
          idempotency_key?: string | null
          posted_at?: string | null
          reference_id?: number | null
          reference_type?: string | null
          uid?: string
        }
        Relationships: []
      }
      journal_lines: {
        Row: {
          amount: number
          created_at: string
          id: number
          journal_entry_id: number
          ledger_account_id: number
          uid: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: never
          journal_entry_id: number
          ledger_account_id: number
          uid?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: never
          journal_entry_id?: number
          ledger_account_id?: number
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_lines_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_ledger_account_id_fkey"
            columns: ["ledger_account_id"]
            isOneToOne: false
            referencedRelation: "ledger_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_accounts: {
        Row: {
          account_type: Database["public"]["Enums"]["ledger_account_type"]
          created_at: string
          currency: string
          description: string | null
          id: number
          is_active: boolean
          name: string
          uid: string
        }
        Insert: {
          account_type: Database["public"]["Enums"]["ledger_account_type"]
          created_at?: string
          currency?: string
          description?: string | null
          id?: never
          is_active?: boolean
          name: string
          uid?: string
        }
        Update: {
          account_type?: Database["public"]["Enums"]["ledger_account_type"]
          created_at?: string
          currency?: string
          description?: string | null
          id?: never
          is_active?: boolean
          name?: string
          uid?: string
        }
        Relationships: []
      }
      listing_attributes: {
        Row: {
          created_at: string
          id: number
          listing_id: number
          name: string
          uid: string
          value: string
        }
        Insert: {
          created_at?: string
          id?: never
          listing_id: number
          name: string
          uid?: string
          value: string
        }
        Update: {
          created_at?: string
          id?: never
          listing_id?: number
          name?: string
          uid?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_attributes_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_images: {
        Row: {
          created_at: string
          id: number
          listing_id: number
          sort_order: number
          uid: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: never
          listing_id: number
          sort_order?: number
          uid?: string
          url: string
        }
        Update: {
          created_at?: string
          id?: never
          listing_id?: number
          sort_order?: number
          uid?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_images_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_reviews: {
        Row: {
          buyer_id: number
          created_at: string
          id: number
          listing_id: number
          order_id: number
          rating: number
          review: string | null
          uid: string
        }
        Insert: {
          buyer_id: number
          created_at?: string
          id?: never
          listing_id: number
          order_id: number
          rating: number
          review?: string | null
          uid?: string
        }
        Update: {
          buyer_id?: number
          created_at?: string
          id?: never
          listing_id?: number
          order_id?: number
          rating?: number
          review?: string | null
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_reviews_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_reviews_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_watchers: {
        Row: {
          account_id: number
          created_at: string
          listing_id: number
        }
        Insert: {
          account_id: number
          created_at?: string
          listing_id: number
        }
        Update: {
          account_id?: number
          created_at?: string
          listing_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "listing_watchers_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_watchers_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          created_at: string
          currency: string
          description: string | null
          id: number
          listing_type: Database["public"]["Enums"]["listing_type"]
          metadata: Json
          price: number | null
          quantity: number
          seller_id: number
          status: Database["public"]["Enums"]["listing_status"]
          title: string
          uid: string
          updated_at: string
          variant_id: number | null
        }
        Insert: {
          created_at?: string
          currency?: string
          description?: string | null
          id?: never
          listing_type?: Database["public"]["Enums"]["listing_type"]
          metadata?: Json
          price?: number | null
          quantity?: number
          seller_id: number
          status?: Database["public"]["Enums"]["listing_status"]
          title: string
          uid?: string
          updated_at?: string
          variant_id?: number | null
        }
        Update: {
          created_at?: string
          currency?: string
          description?: string | null
          id?: never
          listing_type?: Database["public"]["Enums"]["listing_type"]
          metadata?: Json
          price?: number | null
          quantity?: number
          seller_id?: number
          status?: Database["public"]["Enums"]["listing_status"]
          title?: string
          uid?: string
          updated_at?: string
          variant_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "listings_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "seller_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      media: {
        Row: {
          created_at: string
          created_by_account_id: number | null
          filename: string
          folder_id: number | null
          height: number | null
          id: number
          mime_type: string
          organization_id: number
          size_bytes: number | null
          storage_path: string
          uid: string
          width: number | null
        }
        Insert: {
          created_at?: string
          created_by_account_id?: number | null
          filename: string
          folder_id?: number | null
          height?: number | null
          id?: never
          mime_type: string
          organization_id: number
          size_bytes?: number | null
          storage_path: string
          uid?: string
          width?: number | null
        }
        Update: {
          created_at?: string
          created_by_account_id?: number | null
          filename?: string
          folder_id?: number | null
          height?: number | null
          id?: never
          mime_type?: string
          organization_id?: number
          size_bytes?: number | null
          storage_path?: string
          uid?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "media_created_by_account_id_fkey"
            columns: ["created_by_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "media_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      media_folders: {
        Row: {
          created_at: string
          id: number
          name: string
          organization_id: number
          parent_folder_id: number | null
          uid: string
        }
        Insert: {
          created_at?: string
          id?: never
          name: string
          organization_id: number
          parent_folder_id?: number | null
          uid?: string
        }
        Update: {
          created_at?: string
          id?: never
          name?: string
          organization_id?: number
          parent_folder_id?: number | null
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_folders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_folders_parent_folder_id_fkey"
            columns: ["parent_folder_id"]
            isOneToOne: false
            referencedRelation: "media_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      message_attachments: {
        Row: {
          content_type: string | null
          created_at: string
          file_name: string
          id: number
          message_id: number
          size: number | null
          storage_key: string
          uid: string
        }
        Insert: {
          content_type?: string | null
          created_at?: string
          file_name: string
          id?: never
          message_id: number
          size?: number | null
          storage_key: string
          uid?: string
        }
        Update: {
          content_type?: string | null
          created_at?: string
          file_name?: string
          id?: never
          message_id?: number
          size?: number | null
          storage_key?: string
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          account_id: number
          created_at: string
          id: number
          message_id: number
          reaction: string
          uid: string
        }
        Insert: {
          account_id: number
          created_at?: string
          id?: never
          message_id: number
          reaction: string
          uid?: string
        }
        Update: {
          account_id?: number
          created_at?: string
          id?: never
          message_id?: number
          reaction?: string
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_versions: {
        Row: {
          body: string
          created_at: string
          id: number
          message_id: number
          uid: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: never
          message_id: number
          uid?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: never
          message_id?: number
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_versions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string | null
          conversation_id: number
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: number
          message_number: number
          parent_message_id: number | null
          sender_id: number
          uid: string
        }
        Insert: {
          body?: string | null
          conversation_id: number
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: never
          message_number?: number
          parent_message_id?: number | null
          sender_id: number
          uid?: string
        }
        Update: {
          body?: string | null
          conversation_id?: number
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: never
          message_number?: number
          parent_message_id?: number | null
          sender_id?: number
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_parent_message_id_fkey"
            columns: ["parent_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_deliveries: {
        Row: {
          attempts: number
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          error_message: string | null
          failed_at: string | null
          id: number
          last_attempt_at: string | null
          metadata: Json
          provider: string | null
          provider_message_id: string | null
          recipient_id: number
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_delivery_status"]
          uid: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          error_message?: string | null
          failed_at?: string | null
          id?: never
          last_attempt_at?: string | null
          metadata?: Json
          provider?: string | null
          provider_message_id?: string | null
          recipient_id: number
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_delivery_status"]
          uid?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          error_message?: string | null
          failed_at?: string | null
          id?: never
          last_attempt_at?: string | null
          metadata?: Json
          provider?: string | null
          provider_message_id?: string | null
          recipient_id?: number
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_delivery_status"]
          uid?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_deliveries_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "notification_recipients"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_digests: {
        Row: {
          account_id: number
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          frequency: Database["public"]["Enums"]["notification_frequency"]
          id: number
          recipient_id: number
          scheduled_for: string
          sent_at: string | null
          uid: string
        }
        Insert: {
          account_id: number
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          frequency: Database["public"]["Enums"]["notification_frequency"]
          id?: never
          recipient_id: number
          scheduled_for: string
          sent_at?: string | null
          uid?: string
        }
        Update: {
          account_id?: number
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          frequency?: Database["public"]["Enums"]["notification_frequency"]
          id?: never
          recipient_id?: number
          scheduled_for?: string
          sent_at?: string | null
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_digests_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_digests_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "notification_recipients"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_events: {
        Row: {
          actor_account_id: number | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: number
          occurred_at: string
          payload: Json
          type: string
          uid: string
        }
        Insert: {
          actor_account_id?: number | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: never
          occurred_at?: string
          payload?: Json
          type: string
          uid?: string
        }
        Update: {
          actor_account_id?: number | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: never
          occurred_at?: string
          payload?: Json
          type?: string
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_events_actor_account_id_fkey"
            columns: ["actor_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_inbox: {
        Row: {
          account_id: number
          action_url: string | null
          archived_at: string | null
          body: string
          created_at: string
          group_key: string | null
          id: number
          image_url: string | null
          is_read: boolean
          read_at: string | null
          recipient_id: number
          title: string
          uid: string
        }
        Insert: {
          account_id: number
          action_url?: string | null
          archived_at?: string | null
          body: string
          created_at?: string
          group_key?: string | null
          id?: never
          image_url?: string | null
          is_read?: boolean
          read_at?: string | null
          recipient_id: number
          title: string
          uid?: string
        }
        Update: {
          account_id?: number
          action_url?: string | null
          archived_at?: string | null
          body?: string
          created_at?: string
          group_key?: string | null
          id?: never
          image_url?: string | null
          is_read?: boolean
          read_at?: string | null
          recipient_id?: number
          title?: string
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_inbox_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_inbox_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "notification_recipients"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          account_id: number
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          frequency: Database["public"]["Enums"]["notification_frequency"]
          id: number
          is_enabled: boolean
          notification_type: string
          uid: string
          updated_at: string
        }
        Insert: {
          account_id: number
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          frequency?: Database["public"]["Enums"]["notification_frequency"]
          id?: never
          is_enabled?: boolean
          notification_type: string
          uid?: string
          updated_at?: string
        }
        Update: {
          account_id?: number
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          frequency?: Database["public"]["Enums"]["notification_frequency"]
          id?: never
          is_enabled?: boolean
          notification_type?: string
          uid?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_recipients: {
        Row: {
          account_id: number
          created_at: string
          event_id: number
          id: number
          status: Database["public"]["Enums"]["notification_recipient_status"]
          uid: string
        }
        Insert: {
          account_id: number
          created_at?: string
          event_id: number
          id?: never
          status?: Database["public"]["Enums"]["notification_recipient_status"]
          uid?: string
        }
        Update: {
          account_id?: number
          created_at?: string
          event_id?: number
          id?: never
          status?: Database["public"]["Enums"]["notification_recipient_status"]
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_recipients_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_recipients_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "notification_events"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_templates: {
        Row: {
          body_template: string
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          id: number
          is_active: boolean
          locale: string
          subject_template: string | null
          type: string
          uid: string
          updated_at: string
          version: number
        }
        Insert: {
          body_template: string
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          id?: never
          is_active?: boolean
          locale?: string
          subject_template?: string | null
          type: string
          uid?: string
          updated_at?: string
          version?: number
        }
        Update: {
          body_template?: string
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          id?: never
          is_active?: boolean
          locale?: string
          subject_template?: string | null
          type?: string
          uid?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      order_events: {
        Row: {
          created_at: string
          event_type: string
          id: number
          order_id: number
          payload: Json
          uid: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: never
          order_id: number
          payload?: Json
          uid?: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: never
          order_id?: number
          payload?: Json
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          discount: number
          id: number
          line_total: number
          listing_id: number
          order_id: number
          quantity: number
          seller_id: number
          snapshot_sku: string | null
          snapshot_title: string
          tax: number
          uid: string
          unit_price: number
          variant_id: number | null
        }
        Insert: {
          created_at?: string
          discount?: number
          id?: never
          line_total?: number
          listing_id: number
          order_id: number
          quantity?: number
          seller_id: number
          snapshot_sku?: string | null
          snapshot_title: string
          tax?: number
          uid?: string
          unit_price: number
          variant_id?: number | null
        }
        Update: {
          created_at?: string
          discount?: number
          id?: never
          line_total?: number
          listing_id?: number
          order_id?: number
          quantity?: number
          seller_id?: number
          snapshot_sku?: string | null
          snapshot_title?: string
          tax?: number
          uid?: string
          unit_price?: number
          variant_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "seller_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          buyer_account_id: number
          cancelled_at: string | null
          checkout_session_id: number | null
          created_at: string
          currency: string
          discount: number
          id: number
          metadata: Json
          order_number: string
          paid_at: string | null
          shipping: number
          shipping_address: Json
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          tax: number
          total: number
          uid: string
        }
        Insert: {
          buyer_account_id: number
          cancelled_at?: string | null
          checkout_session_id?: number | null
          created_at?: string
          currency?: string
          discount?: number
          id?: never
          metadata?: Json
          order_number?: string
          paid_at?: string | null
          shipping?: number
          shipping_address?: Json
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          tax?: number
          total?: number
          uid?: string
        }
        Update: {
          buyer_account_id?: number
          cancelled_at?: string | null
          checkout_session_id?: number | null
          created_at?: string
          currency?: string
          discount?: number
          id?: never
          metadata?: Json
          order_number?: string
          paid_at?: string | null
          shipping?: number
          shipping_address?: Json
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          tax?: number
          total?: number
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_buyer_account_id_fkey"
            columns: ["buyer_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_checkout_session_id_fkey"
            columns: ["checkout_session_id"]
            isOneToOne: false
            referencedRelation: "checkout_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_billing_emails: {
        Row: {
          billing_email: string
          created_at: string
          id: number
          organization_id: number
          uid: string
        }
        Insert: {
          billing_email: string
          created_at?: string
          id?: never
          organization_id: number
          uid?: string
        }
        Update: {
          billing_email?: string
          created_at?: string
          id?: never
          organization_id?: number
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_billing_emails_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          account_id: number
          created_at: string
          id: number
          invited_by_account_id: number | null
          joined_at: string
          organization_id: number
          organization_role_id: number
          uid: string
        }
        Insert: {
          account_id: number
          created_at?: string
          id?: never
          invited_by_account_id?: number | null
          joined_at?: string
          organization_id: number
          organization_role_id?: number
          uid?: string
        }
        Update: {
          account_id?: number
          created_at?: string
          id?: never
          invited_by_account_id?: number | null
          joined_at?: string
          organization_id?: number
          organization_role_id?: number
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_invited_by_account_id_fkey"
            columns: ["invited_by_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_organization_role_id_fkey"
            columns: ["organization_role_id"]
            isOneToOne: false
            referencedRelation: "organization_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_names: {
        Row: {
          created_at: string
          id: number
          name: string
          organization_id: number
          uid: string
        }
        Insert: {
          created_at?: string
          id?: never
          name: string
          organization_id: number
          uid?: string
        }
        Update: {
          created_at?: string
          id?: never
          name?: string
          organization_id?: number
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_names_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_role_permissions: {
        Row: {
          created_at: string
          organization_role_id: number
          permission_id: number
        }
        Insert: {
          created_at?: string
          organization_role_id: number
          permission_id: number
        }
        Update: {
          created_at?: string
          organization_role_id?: number
          permission_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "organization_role_permissions_organization_role_id_fkey"
            columns: ["organization_role_id"]
            isOneToOne: false
            referencedRelation: "organization_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_roles: {
        Row: {
          created_at: string
          description: string | null
          id: number
          is_system: boolean
          key: string
          name: string
          organization_id: number | null
          uid: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: never
          is_system?: boolean
          key: string
          name: string
          organization_id?: number | null
          uid?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: never
          is_system?: boolean
          key?: string
          name?: string
          organization_id?: number | null
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: number
          metadata: Json
          slug: string
          uid: string
        }
        Insert: {
          created_at?: string
          id?: never
          metadata?: Json
          slug: string
          uid?: string
        }
        Update: {
          created_at?: string
          id?: never
          metadata?: Json
          slug?: string
          uid?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          amount_refunded: number
          billing_provider: Database["public"]["Enums"]["billing_provider"]
          billing_provider_payment_id: string | null
          billing_provider_payment_method_id: string | null
          buyer_account_id: number | null
          created_at: string
          currency: string
          failure_code: string | null
          failure_reason: string | null
          id: number
          invoice_id: number | null
          metadata: Json
          method: Database["public"]["Enums"]["payment_method"] | null
          order_id: number | null
          organization_id: number
          processed_at: string | null
          status: Database["public"]["Enums"]["payment_status"]
          uid: string
          updated_at: string
        }
        Insert: {
          amount: number
          amount_refunded?: number
          billing_provider: Database["public"]["Enums"]["billing_provider"]
          billing_provider_payment_id?: string | null
          billing_provider_payment_method_id?: string | null
          buyer_account_id?: number | null
          created_at?: string
          currency?: string
          failure_code?: string | null
          failure_reason?: string | null
          id?: never
          invoice_id?: number | null
          metadata?: Json
          method?: Database["public"]["Enums"]["payment_method"] | null
          order_id?: number | null
          organization_id: number
          processed_at?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          uid?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          amount_refunded?: number
          billing_provider?: Database["public"]["Enums"]["billing_provider"]
          billing_provider_payment_id?: string | null
          billing_provider_payment_method_id?: string | null
          buyer_account_id?: number | null
          created_at?: string
          currency?: string
          failure_code?: string | null
          failure_reason?: string | null
          id?: never
          invoice_id?: number | null
          metadata?: Json
          method?: Database["public"]["Enums"]["payment_method"] | null
          order_id?: number | null
          organization_id?: number
          processed_at?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          uid?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_buyer_account_id_fkey"
            columns: ["buyer_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          created_at: string
          description: string | null
          id: number
          key: string
          name: string
          scope: string
          uid: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: never
          key: string
          name: string
          scope: string
          uid?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: never
          key?: string
          name?: string
          scope?: string
          uid?: string
        }
        Relationships: []
      }
      plan_feature_entitlements: {
        Row: {
          created_at: string
          feature_id: number
          id: number
          plan_version_id: number
          reset_period: Database["public"]["Enums"]["feature_reset_period"]
          uid: string
          value_boolean: boolean | null
          value_limit: number | null
        }
        Insert: {
          created_at?: string
          feature_id: number
          id?: never
          plan_version_id: number
          reset_period?: Database["public"]["Enums"]["feature_reset_period"]
          uid?: string
          value_boolean?: boolean | null
          value_limit?: number | null
        }
        Update: {
          created_at?: string
          feature_id?: number
          id?: never
          plan_version_id?: number
          reset_period?: Database["public"]["Enums"]["feature_reset_period"]
          uid?: string
          value_boolean?: boolean | null
          value_limit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_feature_entitlements_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_feature_entitlements_plan_version_id_fkey"
            columns: ["plan_version_id"]
            isOneToOne: false
            referencedRelation: "plan_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_versions: {
        Row: {
          billing_interval: Database["public"]["Enums"]["billing_interval"]
          billing_provider:
            | Database["public"]["Enums"]["billing_provider"]
            | null
          billing_provider_plan_id: string | null
          billing_provider_price_id: string | null
          created_at: string
          currency: string
          effective_from: string
          effective_until: string | null
          id: number
          is_active: boolean
          metadata: Json
          plan_id: number
          price_amount: number
          trial_days: number
          uid: string
          version_number: number
        }
        Insert: {
          billing_interval?: Database["public"]["Enums"]["billing_interval"]
          billing_provider?:
            | Database["public"]["Enums"]["billing_provider"]
            | null
          billing_provider_plan_id?: string | null
          billing_provider_price_id?: string | null
          created_at?: string
          currency?: string
          effective_from?: string
          effective_until?: string | null
          id?: never
          is_active?: boolean
          metadata?: Json
          plan_id: number
          price_amount?: number
          trial_days?: number
          uid?: string
          version_number?: number
        }
        Update: {
          billing_interval?: Database["public"]["Enums"]["billing_interval"]
          billing_provider?:
            | Database["public"]["Enums"]["billing_provider"]
            | null
          billing_provider_plan_id?: string | null
          billing_provider_price_id?: string | null
          created_at?: string
          currency?: string
          effective_from?: string
          effective_until?: string | null
          id?: never
          is_active?: boolean
          metadata?: Json
          plan_id?: number
          price_amount?: number
          trial_days?: number
          uid?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "plan_versions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          created_at: string
          description: string | null
          id: number
          is_active: boolean
          is_public: boolean
          metadata: Json
          name: string
          slug: string
          sort_order: number
          uid: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: never
          is_active?: boolean
          is_public?: boolean
          metadata?: Json
          name: string
          slug: string
          sort_order?: number
          uid?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: never
          is_active?: boolean
          is_public?: boolean
          metadata?: Json
          name?: string
          slug?: string
          sort_order?: number
          uid?: string
          updated_at?: string
        }
        Relationships: []
      }
      platform_role_permissions: {
        Row: {
          created_at: string
          permission_id: number
          platform_role_id: number
        }
        Insert: {
          created_at?: string
          permission_id: number
          platform_role_id: number
        }
        Update: {
          created_at?: string
          permission_id?: number
          platform_role_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "platform_role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_role_permissions_platform_role_id_fkey"
            columns: ["platform_role_id"]
            isOneToOne: false
            referencedRelation: "platform_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_roles: {
        Row: {
          created_at: string
          description: string | null
          id: number
          is_system: boolean
          key: string
          name: string
          uid: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: never
          is_system?: boolean
          key: string
          name: string
          uid?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: never
          is_system?: boolean
          key?: string
          name?: string
          uid?: string
        }
        Relationships: []
      }
      prices: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: number
          uid: string
          valid_from: string
          valid_until: string | null
          variant_id: number
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: never
          uid?: string
          valid_from?: string
          valid_until?: string | null
          variant_id: number
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: never
          uid?: string
          valid_from?: string
          valid_until?: string | null
          variant_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "prices_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          created_at: string
          description: string | null
          id: number
          is_active: boolean
          name: string
          parent_id: number | null
          slug: string
          sort_order: number
          uid: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: never
          is_active?: boolean
          name: string
          parent_id?: number | null
          slug: string
          sort_order?: number
          uid?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: never
          is_active?: boolean
          name?: string
          parent_id?: number | null
          slug?: string
          sort_order?: number
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          created_at: string
          id: number
          name: string
          product_id: number
          sku: string | null
          status: Database["public"]["Enums"]["variant_status"]
          uid: string
        }
        Insert: {
          created_at?: string
          id?: never
          name: string
          product_id: number
          sku?: string | null
          status?: Database["public"]["Enums"]["variant_status"]
          uid?: string
        }
        Update: {
          created_at?: string
          id?: never
          name?: string
          product_id?: number
          sku?: string | null
          status?: Database["public"]["Enums"]["variant_status"]
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          brand: string | null
          category_id: number | null
          created_at: string
          description: string | null
          id: number
          metadata: Json
          name: string
          sku: string | null
          status: Database["public"]["Enums"]["product_status"]
          uid: string
          updated_at: string
        }
        Insert: {
          brand?: string | null
          category_id?: number | null
          created_at?: string
          description?: string | null
          id?: never
          metadata?: Json
          name: string
          sku?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          uid?: string
          updated_at?: string
        }
        Update: {
          brand?: string | null
          category_id?: number | null
          created_at?: string
          description?: string | null
          id?: never
          metadata?: Json
          name?: string
          sku?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          uid?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      promotion_redemptions: {
        Row: {
          account_id: number
          amount_saved: number
          created_at: string
          id: number
          order_id: number | null
          promotion_id: number
          uid: string
        }
        Insert: {
          account_id: number
          amount_saved?: number
          created_at?: string
          id?: never
          order_id?: number | null
          promotion_id: number
          uid?: string
        }
        Update: {
          account_id?: number
          amount_saved?: number
          created_at?: string
          id?: never
          order_id?: number | null
          promotion_id?: number
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotion_redemptions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_redemptions_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
        ]
      }
      promotions: {
        Row: {
          code: string | null
          created_at: string
          description: string | null
          end_date: string | null
          id: number
          is_active: boolean
          max_uses: number | null
          max_uses_per_user: number | null
          min_order_amount: number | null
          name: string
          promotion_type: Database["public"]["Enums"]["promotion_type"]
          start_date: string | null
          uid: string
          uses_count: number
          value: number
        }
        Insert: {
          code?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: never
          is_active?: boolean
          max_uses?: number | null
          max_uses_per_user?: number | null
          min_order_amount?: number | null
          name: string
          promotion_type: Database["public"]["Enums"]["promotion_type"]
          start_date?: string | null
          uid?: string
          uses_count?: number
          value: number
        }
        Update: {
          code?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: never
          is_active?: boolean
          max_uses?: number | null
          max_uses_per_user?: number | null
          min_order_amount?: number | null
          name?: string
          promotion_type?: Database["public"]["Enums"]["promotion_type"]
          start_date?: string | null
          uid?: string
          uses_count?: number
          value?: number
        }
        Relationships: []
      }
      proxy_bids: {
        Row: {
          auction_id: number
          bidder_id: number
          created_at: string
          id: number
          maximum_amount: number
          uid: string
        }
        Insert: {
          auction_id: number
          bidder_id: number
          created_at?: string
          id?: never
          maximum_amount: number
          uid?: string
        }
        Update: {
          auction_id?: number
          bidder_id?: number
          created_at?: string
          id?: never
          maximum_amount?: number
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "proxy_bids_auction_id_fkey"
            columns: ["auction_id"]
            isOneToOne: false
            referencedRelation: "auctions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proxy_bids_bidder_id_fkey"
            columns: ["bidder_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: number
          journal_entry_id: number | null
          payment_id: number
          processed_at: string | null
          reason: string | null
          return_id: number | null
          status: Database["public"]["Enums"]["refund_status"]
          uid: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: never
          journal_entry_id?: number | null
          payment_id: number
          processed_at?: string | null
          reason?: string | null
          return_id?: number | null
          status?: Database["public"]["Enums"]["refund_status"]
          uid?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: never
          journal_entry_id?: number | null
          payment_id?: number
          processed_at?: string | null
          reason?: string | null
          return_id?: number | null
          status?: Database["public"]["Enums"]["refund_status"]
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "returns"
            referencedColumns: ["id"]
          },
        ]
      }
      return_items: {
        Row: {
          id: number
          order_item_id: number
          quantity: number
          reason: string | null
          return_id: number
        }
        Insert: {
          id?: never
          order_item_id: number
          quantity?: number
          reason?: string | null
          return_id: number
        }
        Update: {
          id?: never
          order_item_id?: number
          quantity?: number
          reason?: string | null
          return_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "return_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_items_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "returns"
            referencedColumns: ["id"]
          },
        ]
      }
      returns: {
        Row: {
          approved_at: string | null
          completed_at: string | null
          created_at: string
          id: number
          order_id: number
          reason: string | null
          received_at: string | null
          status: Database["public"]["Enums"]["return_status"]
          uid: string
        }
        Insert: {
          approved_at?: string | null
          completed_at?: string | null
          created_at?: string
          id?: never
          order_id: number
          reason?: string | null
          received_at?: string | null
          status?: Database["public"]["Enums"]["return_status"]
          uid?: string
        }
        Update: {
          approved_at?: string | null
          completed_at?: string | null
          created_at?: string
          id?: never
          order_id?: number
          reason?: string | null
          received_at?: string | null
          status?: Database["public"]["Enums"]["return_status"]
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "returns_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_payouts: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: number
          journal_entry_id: number | null
          payout_method: string | null
          payout_reference: string | null
          processed_at: string | null
          scheduled_for: string | null
          seller_id: number
          status: Database["public"]["Enums"]["payout_status"]
          uid: string
          wallet_id: number
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: never
          journal_entry_id?: number | null
          payout_method?: string | null
          payout_reference?: string | null
          processed_at?: string | null
          scheduled_for?: string | null
          seller_id: number
          status?: Database["public"]["Enums"]["payout_status"]
          uid?: string
          wallet_id: number
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: never
          journal_entry_id?: number | null
          payout_method?: string | null
          payout_reference?: string | null
          processed_at?: string | null
          scheduled_for?: string | null
          seller_id?: number
          status?: Database["public"]["Enums"]["payout_status"]
          uid?: string
          wallet_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "seller_payouts_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_payouts_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "seller_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_payouts_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_profiles: {
        Row: {
          account_id: number
          bio: string | null
          created_at: string
          display_name: string
          id: number
          rating: number | null
          review_count: number
          status: string
          uid: string
        }
        Insert: {
          account_id: number
          bio?: string | null
          created_at?: string
          display_name: string
          id?: never
          rating?: number | null
          review_count?: number
          status?: string
          uid?: string
        }
        Update: {
          account_id?: number
          bio?: string | null
          created_at?: string
          display_name?: string
          id?: never
          rating?: number | null
          review_count?: number
          status?: string
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_profiles_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_reviews: {
        Row: {
          buyer_id: number
          created_at: string
          id: number
          order_id: number
          rating: number
          review: string | null
          seller_id: number
          uid: string
        }
        Insert: {
          buyer_id: number
          created_at?: string
          id?: never
          order_id: number
          rating: number
          review?: string | null
          seller_id: number
          uid?: string
        }
        Update: {
          buyer_id?: number
          created_at?: string
          id?: never
          order_id?: number
          rating?: number
          review?: string | null
          seller_id?: number
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_reviews_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_reviews_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "seller_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      seo_metadata: {
        Row: {
          canonical_url: string | null
          content_id: number
          created_at: string
          meta_description: string | null
          meta_title: string | null
          og_description: string | null
          og_image_id: number | null
          og_title: string | null
          robots: string
          uid: string
          updated_at: string
        }
        Insert: {
          canonical_url?: string | null
          content_id: number
          created_at?: string
          meta_description?: string | null
          meta_title?: string | null
          og_description?: string | null
          og_image_id?: number | null
          og_title?: string | null
          robots?: string
          uid?: string
          updated_at?: string
        }
        Update: {
          canonical_url?: string | null
          content_id?: number
          created_at?: string
          meta_description?: string | null
          meta_title?: string | null
          og_description?: string | null
          og_image_id?: number | null
          og_title?: string | null
          robots?: string
          uid?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seo_metadata_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: true
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seo_metadata_og_image_id_fkey"
            columns: ["og_image_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_items: {
        Row: {
          id: number
          order_item_id: number
          quantity: number
          shipment_id: number
        }
        Insert: {
          id?: never
          order_item_id: number
          quantity?: number
          shipment_id: number
        }
        Update: {
          id?: never
          order_item_id?: number
          quantity?: number
          shipment_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "shipment_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_items_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          carrier: string | null
          created_at: string
          delivered_at: string | null
          id: number
          metadata: Json
          order_id: number
          seller_id: number
          shipped_at: string | null
          status: Database["public"]["Enums"]["shipment_status"]
          tracking_number: string | null
          tracking_url: string | null
          uid: string
        }
        Insert: {
          carrier?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: never
          metadata?: Json
          order_id: number
          seller_id: number
          shipped_at?: string | null
          status?: Database["public"]["Enums"]["shipment_status"]
          tracking_number?: string | null
          tracking_url?: string | null
          uid?: string
        }
        Update: {
          carrier?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: never
          metadata?: Json
          order_id?: number
          seller_id?: number
          shipped_at?: string | null
          status?: Database["public"]["Enums"]["shipment_status"]
          tracking_number?: string | null
          tracking_url?: string | null
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "seller_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_addons: {
        Row: {
          addon_version_id: number
          billing_provider_subscription_item_id: string | null
          created_at: string
          ends_at: string | null
          id: number
          quantity: number
          started_at: string
          status: string
          subscription_id: number
          uid: string
          updated_at: string
        }
        Insert: {
          addon_version_id: number
          billing_provider_subscription_item_id?: string | null
          created_at?: string
          ends_at?: string | null
          id?: never
          quantity?: number
          started_at?: string
          status?: string
          subscription_id: number
          uid?: string
          updated_at?: string
        }
        Update: {
          addon_version_id?: number
          billing_provider_subscription_item_id?: string | null
          created_at?: string
          ends_at?: string | null
          id?: never
          quantity?: number
          started_at?: string
          status?: string
          subscription_id?: number
          uid?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_addons_addon_version_id_fkey"
            columns: ["addon_version_id"]
            isOneToOne: false
            referencedRelation: "addon_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_addons_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_change_requests: {
        Row: {
          billing_impact: Json
          billing_provider_payload: Json
          created_at: string
          current_plan_version_id: number | null
          effective_at: string | null
          expires_at: string
          failure_reason: string | null
          id: number
          idempotency_key: string | null
          metadata: Json
          organization_id: number
          payment_behavior: Database["public"]["Enums"]["payment_behavior"]
          processed_at: string | null
          proration_behavior: Database["public"]["Enums"]["proration_behavior"]
          requested_by_account_id: number
          status: Database["public"]["Enums"]["change_request_status"]
          subscription_id: number | null
          target_plan_version_id: number | null
          type: Database["public"]["Enums"]["change_request_type"]
          uid: string
        }
        Insert: {
          billing_impact?: Json
          billing_provider_payload?: Json
          created_at?: string
          current_plan_version_id?: number | null
          effective_at?: string | null
          expires_at?: string
          failure_reason?: string | null
          id?: never
          idempotency_key?: string | null
          metadata?: Json
          organization_id: number
          payment_behavior?: Database["public"]["Enums"]["payment_behavior"]
          processed_at?: string | null
          proration_behavior?: Database["public"]["Enums"]["proration_behavior"]
          requested_by_account_id: number
          status?: Database["public"]["Enums"]["change_request_status"]
          subscription_id?: number | null
          target_plan_version_id?: number | null
          type: Database["public"]["Enums"]["change_request_type"]
          uid?: string
        }
        Update: {
          billing_impact?: Json
          billing_provider_payload?: Json
          created_at?: string
          current_plan_version_id?: number | null
          effective_at?: string | null
          expires_at?: string
          failure_reason?: string | null
          id?: never
          idempotency_key?: string | null
          metadata?: Json
          organization_id?: number
          payment_behavior?: Database["public"]["Enums"]["payment_behavior"]
          processed_at?: string | null
          proration_behavior?: Database["public"]["Enums"]["proration_behavior"]
          requested_by_account_id?: number
          status?: Database["public"]["Enums"]["change_request_status"]
          subscription_id?: number | null
          target_plan_version_id?: number | null
          type?: Database["public"]["Enums"]["change_request_type"]
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_change_requests_current_plan_version_id_fkey"
            columns: ["current_plan_version_id"]
            isOneToOne: false
            referencedRelation: "plan_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_change_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_change_requests_requested_by_account_id_fkey"
            columns: ["requested_by_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_change_requests_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_change_requests_target_plan_version_id_fkey"
            columns: ["target_plan_version_id"]
            isOneToOne: false
            referencedRelation: "plan_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_contracts: {
        Row: {
          created_at: string
          custom_pricing: Json
          document_url: string | null
          end_date: string | null
          id: number
          negotiated_features: Json
          organization_id: number
          signed_at: string | null
          signed_by_account_id: number | null
          sla_tier: string | null
          start_date: string
          status: Database["public"]["Enums"]["contract_status"]
          subscription_id: number | null
          uid: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          custom_pricing?: Json
          document_url?: string | null
          end_date?: string | null
          id?: never
          negotiated_features?: Json
          organization_id: number
          signed_at?: string | null
          signed_by_account_id?: number | null
          sla_tier?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["contract_status"]
          subscription_id?: number | null
          uid?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          custom_pricing?: Json
          document_url?: string | null
          end_date?: string | null
          id?: never
          negotiated_features?: Json
          organization_id?: number
          signed_at?: string | null
          signed_by_account_id?: number | null
          sla_tier?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["contract_status"]
          subscription_id?: number | null
          uid?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_contracts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_contracts_signed_by_account_id_fkey"
            columns: ["signed_by_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_contracts_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_entitlements: {
        Row: {
          computed_at: string
          created_at: string
          feature_id: number
          feature_key: string
          id: number
          is_unlimited: boolean
          organization_id: number
          source: Database["public"]["Enums"]["entitlement_source"]
          subscription_id: number
          uid: string
          valid_until: string | null
          value_boolean: boolean | null
          value_limit: number | null
        }
        Insert: {
          computed_at?: string
          created_at?: string
          feature_id: number
          feature_key: string
          id?: never
          is_unlimited?: boolean
          organization_id: number
          source?: Database["public"]["Enums"]["entitlement_source"]
          subscription_id: number
          uid?: string
          valid_until?: string | null
          value_boolean?: boolean | null
          value_limit?: number | null
        }
        Update: {
          computed_at?: string
          created_at?: string
          feature_id?: number
          feature_key?: string
          id?: never
          is_unlimited?: boolean
          organization_id?: number
          source?: Database["public"]["Enums"]["entitlement_source"]
          subscription_id?: number
          uid?: string
          valid_until?: string | null
          value_boolean?: boolean | null
          value_limit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_entitlements_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_entitlements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_entitlements_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_events: {
        Row: {
          created_at: string
          id: number
          occurred_at: string
          organization_id: number
          payload: Json
          subscription_id: number | null
          type: string
          uid: string
        }
        Insert: {
          created_at?: string
          id?: never
          occurred_at?: string
          organization_id: number
          payload?: Json
          subscription_id?: number | null
          type: string
          uid?: string
        }
        Update: {
          created_at?: string
          id?: never
          occurred_at?: string
          organization_id?: number
          payload?: Json
          subscription_id?: number | null
          type?: string
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_events_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          billing_anchor_day: number | null
          billing_provider:
            | Database["public"]["Enums"]["billing_provider"]
            | null
          billing_provider_subscription_id: string | null
          cancel_at: string | null
          cancelled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          ended_at: string | null
          id: number
          metadata: Json
          organization_id: number
          plan_version_id: number
          quantity: number
          status: Database["public"]["Enums"]["subscription_status"]
          trial_end: string | null
          trial_start: string | null
          uid: string
          updated_at: string
        }
        Insert: {
          billing_anchor_day?: number | null
          billing_provider?:
            | Database["public"]["Enums"]["billing_provider"]
            | null
          billing_provider_subscription_id?: string | null
          cancel_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          ended_at?: string | null
          id?: never
          metadata?: Json
          organization_id: number
          plan_version_id: number
          quantity?: number
          status?: Database["public"]["Enums"]["subscription_status"]
          trial_end?: string | null
          trial_start?: string | null
          uid?: string
          updated_at?: string
        }
        Update: {
          billing_anchor_day?: number | null
          billing_provider?:
            | Database["public"]["Enums"]["billing_provider"]
            | null
          billing_provider_subscription_id?: string | null
          cancel_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          ended_at?: string | null
          id?: never
          metadata?: Json
          organization_id?: number
          plan_version_id?: number
          quantity?: number
          status?: Database["public"]["Enums"]["subscription_status"]
          trial_end?: string | null
          trial_start?: string | null
          uid?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_version_id_fkey"
            columns: ["plan_version_id"]
            isOneToOne: false
            referencedRelation: "plan_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          created_at: string
          id: number
          name: string
          organization_id: number
          slug: string
          uid: string
        }
        Insert: {
          created_at?: string
          id?: never
          name: string
          organization_id: number
          slug: string
          uid?: string
        }
        Update: {
          created_at?: string
          id?: never
          name?: string
          organization_id?: number
          slug?: string
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          assigned_to_account_id: number | null
          authenticated_account_id: number | null
          category: string | null
          company_name: string | null
          created_at: string
          due_at: string | null
          email: string | null
          first_response_at: string | null
          full_name: string | null
          id: number
          ip_address: unknown
          message: string
          metadata: Json
          phone: string | null
          priority: Database["public"]["Enums"]["ticket_priority"]
          referer: string | null
          resolved_at: string | null
          source: string | null
          spam_score: number | null
          status: Database["public"]["Enums"]["ticket_status"]
          subject: string | null
          uid: string
          user_agent: string | null
        }
        Insert: {
          assigned_to_account_id?: number | null
          authenticated_account_id?: number | null
          category?: string | null
          company_name?: string | null
          created_at?: string
          due_at?: string | null
          email?: string | null
          first_response_at?: string | null
          full_name?: string | null
          id?: never
          ip_address?: unknown
          message: string
          metadata?: Json
          phone?: string | null
          priority?: Database["public"]["Enums"]["ticket_priority"]
          referer?: string | null
          resolved_at?: string | null
          source?: string | null
          spam_score?: number | null
          status?: Database["public"]["Enums"]["ticket_status"]
          subject?: string | null
          uid?: string
          user_agent?: string | null
        }
        Update: {
          assigned_to_account_id?: number | null
          authenticated_account_id?: number | null
          category?: string | null
          company_name?: string | null
          created_at?: string
          due_at?: string | null
          email?: string | null
          first_response_at?: string | null
          full_name?: string | null
          id?: never
          ip_address?: unknown
          message?: string
          metadata?: Json
          phone?: string | null
          priority?: Database["public"]["Enums"]["ticket_priority"]
          referer?: string | null
          resolved_at?: string | null
          source?: string | null
          spam_score?: number | null
          status?: Database["public"]["Enums"]["ticket_status"]
          subject?: string | null
          uid?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tickets_assigned_to_account_id_fkey"
            columns: ["assigned_to_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_authenticated_account_id_fkey"
            columns: ["authenticated_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_records: {
        Row: {
          created_at: string
          feature_id: number | null
          feature_key: string
          id: number
          idempotency_key: string | null
          metadata: Json
          organization_id: number
          period_end: string
          period_start: string
          quantity: number
          recorded_at: string
          subscription_id: number | null
          uid: string
        }
        Insert: {
          created_at?: string
          feature_id?: number | null
          feature_key: string
          id?: never
          idempotency_key?: string | null
          metadata?: Json
          organization_id: number
          period_end: string
          period_start: string
          quantity?: number
          recorded_at?: string
          subscription_id?: number | null
          uid?: string
        }
        Update: {
          created_at?: string
          feature_id?: number | null
          feature_key?: string
          id?: never
          idempotency_key?: string | null
          metadata?: Json
          organization_id?: number
          period_end?: string
          period_start?: string
          quantity?: number
          recorded_at?: string
          subscription_id?: number | null
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_records_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_records_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_summaries: {
        Row: {
          created_at: string
          feature_id: number
          feature_key: string
          id: number
          last_updated_at: string
          organization_id: number
          period_end: string
          period_start: string
          subscription_id: number
          total_quantity: number
          uid: string
        }
        Insert: {
          created_at?: string
          feature_id: number
          feature_key: string
          id?: never
          last_updated_at?: string
          organization_id: number
          period_end: string
          period_start: string
          subscription_id: number
          total_quantity?: number
          uid?: string
        }
        Update: {
          created_at?: string
          feature_id?: number
          feature_key?: string
          id?: never
          last_updated_at?: string
          organization_id?: number
          period_end?: string
          period_start?: string
          subscription_id?: number
          total_quantity?: number
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_summaries_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_summaries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_summaries_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      variant_attribute_values: {
        Row: {
          attribute_value_id: number
          variant_id: number
        }
        Insert: {
          attribute_value_id: number
          variant_id: number
        }
        Update: {
          attribute_value_id?: number
          variant_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "variant_attribute_values_attribute_value_id_fkey"
            columns: ["attribute_value_id"]
            isOneToOne: false
            referencedRelation: "attribute_values"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_attribute_values_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_holds: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          expires_at: string | null
          id: number
          idempotency_key: string | null
          reference_id: number | null
          reference_type: string | null
          released_at: string | null
          status: Database["public"]["Enums"]["wallet_hold_status"]
          uid: string
          wallet_id: number
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          expires_at?: string | null
          id?: never
          idempotency_key?: string | null
          reference_id?: number | null
          reference_type?: string | null
          released_at?: string | null
          status?: Database["public"]["Enums"]["wallet_hold_status"]
          uid?: string
          wallet_id: number
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          expires_at?: string | null
          id?: never
          idempotency_key?: string | null
          reference_id?: number | null
          reference_type?: string | null
          released_at?: string | null
          status?: Database["public"]["Enums"]["wallet_hold_status"]
          uid?: string
          wallet_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "wallet_holds_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          created_at: string
          currency: string
          current_balance: number
          id: number
          is_active: boolean
          ledger_account_id: number
          owner_id: number
          owner_type: Database["public"]["Enums"]["wallet_owner_type"]
          uid: string
        }
        Insert: {
          created_at?: string
          currency?: string
          current_balance?: number
          id?: never
          is_active?: boolean
          ledger_account_id: number
          owner_id: number
          owner_type: Database["public"]["Enums"]["wallet_owner_type"]
          uid?: string
        }
        Update: {
          created_at?: string
          currency?: string
          current_balance?: number
          id?: never
          is_active?: boolean
          ledger_account_id?: number
          owner_id?: number
          owner_type?: Database["public"]["Enums"]["wallet_owner_type"]
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallets_ledger_account_id_fkey"
            columns: ["ledger_account_id"]
            isOneToOne: false
            referencedRelation: "ledger_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouses: {
        Row: {
          address: Json
          created_at: string
          id: number
          is_active: boolean
          name: string
          uid: string
        }
        Insert: {
          address?: Json
          created_at?: string
          id?: never
          is_active?: boolean
          name: string
          uid?: string
        }
        Update: {
          address?: Json
          created_at?: string
          id?: never
          is_active?: boolean
          name?: string
          uid?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      archive_notification: { Args: { p_inbox_id: number }; Returns: undefined }
      current_price: {
        Args: { p_currency?: string; p_variant_id: number }
        Returns: number
      }
      get_my_org_permissions: { Args: { p_org_id: number }; Returns: string[] }
      get_my_platform_permissions: { Args: never; Returns: string[] }
      inventory_stock: {
        Args: { p_variant_id: number; p_warehouse_id?: number }
        Returns: number
      }
      mark_all_notifications_read: { Args: never; Returns: undefined }
      mark_notification_read: {
        Args: { p_inbox_id: number }
        Returns: undefined
      }
      set_current_price: {
        Args: { p_amount: number; p_currency?: string; p_variant_id: number }
        Returns: {
          amount: number
          created_at: string
          currency: string
          id: number
          uid: string
          valid_from: string
          valid_until: string | null
          variant_id: number
        }
        SetofOptions: {
          from: "*"
          to: "prices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      unread_notification_count: { Args: never; Returns: number }
      wallet_available_balance: {
        Args: { p_wallet_id: number }
        Returns: number
      }
      wallet_create: {
        Args: {
          p_currency?: string
          p_name?: string
          p_owner_id: number
          p_owner_type: Database["public"]["Enums"]["wallet_owner_type"]
        }
        Returns: number
      }
      wallet_deposit: {
        Args: {
          p_amount: number
          p_description: string
          p_idempotency_key?: string
          p_reference_id?: number
          p_reference_type?: string
          p_source_account_id: number
          p_wallet_id: number
        }
        Returns: number
      }
      wallet_spend: {
        Args: {
          p_amount: number
          p_description: string
          p_dest_account_id: number
          p_idempotency_key?: string
          p_reference_id?: number
          p_reference_type?: string
          p_wallet_id: number
        }
        Returns: number
      }
      wallet_transfer: {
        Args: {
          p_amount: number
          p_description: string
          p_from_wallet_id: number
          p_idempotency_key?: string
          p_reference_id?: number
          p_reference_type?: string
          p_to_wallet_id: number
        }
        Returns: number
      }
    }
    Enums: {
      auction_status: "scheduled" | "active" | "ended" | "cancelled"
      billing_interval: "daily" | "weekly" | "monthly" | "yearly"
      billing_provider: "stripe" | "paddle" | "manual"
      billing_reason:
        | "subscription_create"
        | "subscription_cycle"
        | "subscription_update"
        | "subscription_threshold"
        | "manual"
        | "upcoming"
      cart_status: "active" | "converted" | "abandoned"
      change_request_status:
        | "pending"
        | "processing"
        | "awaiting_payment"
        | "completed"
        | "failed"
        | "cancelled"
        | "expired"
      change_request_type:
        | "create"
        | "upgrade"
        | "downgrade"
        | "cancel"
        | "pause"
        | "resume"
        | "renew"
        | "add_seats"
        | "remove_seats"
        | "add_addon"
        | "remove_addon"
      checkout_status:
        | "pending"
        | "payment_pending"
        | "completed"
        | "expired"
        | "cancelled"
      contract_status: "draft" | "active" | "expired" | "terminated"
      conversation_participant_role: "owner" | "admin" | "member"
      conversation_type: "direct" | "group" | "channel" | "comments"
      credit_note_reason:
        | "duplicate"
        | "fraudulent"
        | "order_change"
        | "product_unsatisfactory"
      credit_note_status: "draft" | "issued" | "void"
      entitlement_source: "plan" | "addon" | "override" | "promotion"
      feature_reset_period: "daily" | "weekly" | "monthly" | "yearly" | "never"
      feature_type: "boolean" | "limit" | "metered"
      invoice_status: "draft" | "open" | "paid" | "void" | "uncollectible"
      invoice_type: "subscription" | "one_time" | "credit_note"
      ledger_account_type:
        | "wallet"
        | "bank"
        | "revenue"
        | "platform_fee"
        | "escrow"
        | "refund_reserve"
        | "system"
      listing_status:
        | "draft"
        | "active"
        | "sold"
        | "ended"
        | "ended_no_sale"
        | "cancelled"
      listing_type: "fixed_price" | "auction"
      notification_channel:
        | "in_app"
        | "email"
        | "push"
        | "sms"
        | "slack"
        | "webhook"
      notification_delivery_status:
        | "pending"
        | "queued"
        | "sent"
        | "delivered"
        | "failed"
        | "cancelled"
      notification_frequency:
        | "immediate"
        | "hourly_digest"
        | "daily_digest"
        | "weekly_digest"
      notification_recipient_status:
        | "pending"
        | "processing"
        | "delivered"
        | "failed"
      order_status:
        | "draft"
        | "pending_payment"
        | "paid"
        | "processing"
        | "shipped"
        | "delivered"
        | "cancelled"
        | "refunded"
      org_member_role: "owner" | "admin" | "member" | "billing"
      payment_behavior:
        | "default_incomplete"
        | "error_if_incomplete"
        | "allow_incomplete"
      payment_method: "card" | "bank_transfer" | "wallet" | "manual" | "crypto"
      payment_status:
        | "pending"
        | "processing"
        | "succeeded"
        | "failed"
        | "cancelled"
        | "refunded"
        | "partially_refunded"
      payout_status: "pending" | "processing" | "completed" | "failed"
      product_status: "draft" | "active" | "archived"
      promotion_type: "percentage" | "fixed_amount" | "free_shipping"
      proration_behavior: "create_prorations" | "none" | "always_invoice"
      refund_status: "pending" | "processing" | "completed" | "failed"
      reservation_status: "active" | "released" | "consumed" | "expired"
      return_status:
        | "requested"
        | "approved"
        | "rejected"
        | "received"
        | "completed"
      shipment_status:
        | "pending"
        | "packed"
        | "shipped"
        | "delivered"
        | "returned"
      subscription_status:
        | "incomplete"
        | "incomplete_expired"
        | "trialing"
        | "active"
        | "past_due"
        | "paused"
        | "cancelled"
        | "expired"
      ticket_priority: "low" | "normal" | "high" | "urgent"
      ticket_status:
        | "new"
        | "reviewed"
        | "in_progress"
        | "waiting_customer"
        | "resolved"
        | "closed"
        | "spam"
      variant_status: "active" | "inactive" | "discontinued"
      wallet_hold_status: "active" | "released" | "consumed" | "expired"
      wallet_owner_type: "account" | "organization"
      webhook_event_status: "pending" | "processed" | "failed" | "ignored"
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
    Enums: {
      auction_status: ["scheduled", "active", "ended", "cancelled"],
      billing_interval: ["daily", "weekly", "monthly", "yearly"],
      billing_provider: ["stripe", "paddle", "manual"],
      billing_reason: [
        "subscription_create",
        "subscription_cycle",
        "subscription_update",
        "subscription_threshold",
        "manual",
        "upcoming",
      ],
      cart_status: ["active", "converted", "abandoned"],
      change_request_status: [
        "pending",
        "processing",
        "awaiting_payment",
        "completed",
        "failed",
        "cancelled",
        "expired",
      ],
      change_request_type: [
        "create",
        "upgrade",
        "downgrade",
        "cancel",
        "pause",
        "resume",
        "renew",
        "add_seats",
        "remove_seats",
        "add_addon",
        "remove_addon",
      ],
      checkout_status: [
        "pending",
        "payment_pending",
        "completed",
        "expired",
        "cancelled",
      ],
      contract_status: ["draft", "active", "expired", "terminated"],
      conversation_participant_role: ["owner", "admin", "member"],
      conversation_type: ["direct", "group", "channel", "comments"],
      credit_note_reason: [
        "duplicate",
        "fraudulent",
        "order_change",
        "product_unsatisfactory",
      ],
      credit_note_status: ["draft", "issued", "void"],
      entitlement_source: ["plan", "addon", "override", "promotion"],
      feature_reset_period: ["daily", "weekly", "monthly", "yearly", "never"],
      feature_type: ["boolean", "limit", "metered"],
      invoice_status: ["draft", "open", "paid", "void", "uncollectible"],
      invoice_type: ["subscription", "one_time", "credit_note"],
      ledger_account_type: [
        "wallet",
        "bank",
        "revenue",
        "platform_fee",
        "escrow",
        "refund_reserve",
        "system",
      ],
      listing_status: [
        "draft",
        "active",
        "sold",
        "ended",
        "ended_no_sale",
        "cancelled",
      ],
      listing_type: ["fixed_price", "auction"],
      notification_channel: [
        "in_app",
        "email",
        "push",
        "sms",
        "slack",
        "webhook",
      ],
      notification_delivery_status: [
        "pending",
        "queued",
        "sent",
        "delivered",
        "failed",
        "cancelled",
      ],
      notification_frequency: [
        "immediate",
        "hourly_digest",
        "daily_digest",
        "weekly_digest",
      ],
      notification_recipient_status: [
        "pending",
        "processing",
        "delivered",
        "failed",
      ],
      order_status: [
        "draft",
        "pending_payment",
        "paid",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
        "refunded",
      ],
      org_member_role: ["owner", "admin", "member", "billing"],
      payment_behavior: [
        "default_incomplete",
        "error_if_incomplete",
        "allow_incomplete",
      ],
      payment_method: ["card", "bank_transfer", "wallet", "manual", "crypto"],
      payment_status: [
        "pending",
        "processing",
        "succeeded",
        "failed",
        "cancelled",
        "refunded",
        "partially_refunded",
      ],
      payout_status: ["pending", "processing", "completed", "failed"],
      product_status: ["draft", "active", "archived"],
      promotion_type: ["percentage", "fixed_amount", "free_shipping"],
      proration_behavior: ["create_prorations", "none", "always_invoice"],
      refund_status: ["pending", "processing", "completed", "failed"],
      reservation_status: ["active", "released", "consumed", "expired"],
      return_status: [
        "requested",
        "approved",
        "rejected",
        "received",
        "completed",
      ],
      shipment_status: [
        "pending",
        "packed",
        "shipped",
        "delivered",
        "returned",
      ],
      subscription_status: [
        "incomplete",
        "incomplete_expired",
        "trialing",
        "active",
        "past_due",
        "paused",
        "cancelled",
        "expired",
      ],
      ticket_priority: ["low", "normal", "high", "urgent"],
      ticket_status: [
        "new",
        "reviewed",
        "in_progress",
        "waiting_customer",
        "resolved",
        "closed",
        "spam",
      ],
      variant_status: ["active", "inactive", "discontinued"],
      wallet_hold_status: ["active", "released", "consumed", "expired"],
      wallet_owner_type: ["account", "organization"],
      webhook_event_status: ["pending", "processed", "failed", "ignored"],
    },
  },
} as const

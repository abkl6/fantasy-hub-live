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
      leagues: {
        Row: {
          created_at: string
          current_week: number
          external_id: string | null
          id: string
          last_synced_at: string | null
          name: string
          platform: string
          playoff_teams: number
          regular_season_weeks: number
          roster_slots: Json
          scoring_rules: Json
          scoring_type: string
          season: number
          team_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_week?: number
          external_id?: string | null
          id?: string
          last_synced_at?: string | null
          name: string
          platform?: string
          playoff_teams?: number
          regular_season_weeks?: number
          roster_slots?: Json
          scoring_rules?: Json
          scoring_type?: string
          season?: number
          team_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_week?: number
          external_id?: string | null
          id?: string
          last_synced_at?: string | null
          name?: string
          platform?: string
          playoff_teams?: number
          regular_season_weeks?: number
          roster_slots?: Json
          scoring_rules?: Json
          scoring_type?: string
          season?: number
          team_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      matchups: {
        Row: {
          away_score: number
          away_team_id: string | null
          created_at: string
          home_score: number
          home_team_id: string | null
          id: string
          is_final: boolean
          league_id: string
          user_id: string
          week: number
        }
        Insert: {
          away_score?: number
          away_team_id?: string | null
          created_at?: string
          home_score?: number
          home_team_id?: string | null
          id?: string
          is_final?: boolean
          league_id: string
          user_id: string
          week: number
        }
        Update: {
          away_score?: number
          away_team_id?: string | null
          created_at?: string
          home_score?: number
          home_team_id?: string | null
          id?: string
          is_final?: boolean
          league_id?: string
          user_id?: string
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "matchups_away_team_id_fkey"
            columns: ["away_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matchups_home_team_id_fkey"
            columns: ["home_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matchups_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_credentials: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          payload: Json
          platform: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          payload?: Json
          platform: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          payload?: Json
          platform?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      players: {
        Row: {
          bye_week: number | null
          created_at: string
          full_name: string
          id: string
          nfl_team: string | null
          position: string
          proj_points_season: number
          proj_points_week: number
          search_name: string
          sleeper_id: string | null
          status: string
          updated_at: string
          volatility: number
        }
        Insert: {
          bye_week?: number | null
          created_at?: string
          full_name: string
          id?: string
          nfl_team?: string | null
          position: string
          proj_points_season?: number
          proj_points_week?: number
          search_name: string
          sleeper_id?: string | null
          status?: string
          updated_at?: string
          volatility?: number
        }
        Update: {
          bye_week?: number | null
          created_at?: string
          full_name?: string
          id?: string
          nfl_team?: string | null
          position?: string
          proj_points_season?: number
          proj_points_week?: number
          search_name?: string
          sleeper_id?: string | null
          status?: string
          updated_at?: string
          volatility?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      roster_spots: {
        Row: {
          created_at: string
          id: string
          is_auto: boolean
          is_starter: boolean
          league_id: string
          nfl_team: string | null
          player_id: string | null
          player_name: string
          position: string
          proj_points: number
          slot: string
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_auto?: boolean
          is_starter?: boolean
          league_id: string
          nfl_team?: string | null
          player_id?: string | null
          player_name: string
          position: string
          proj_points?: number
          slot?: string
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_auto?: boolean
          is_starter?: boolean
          league_id?: string
          nfl_team?: string | null
          player_id?: string | null
          player_name?: string
          position?: string
          proj_points?: number
          slot?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roster_spots_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_spots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_spots_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_moves: {
        Row: {
          created_at: string
          details: Json
          id: string
          label: string
          league_id: string
          move_type: string
          status: string
          team_id: string | null
          title_delta: number
          user_id: string
          win_delta: number
        }
        Insert: {
          created_at?: string
          details?: Json
          id?: string
          label: string
          league_id: string
          move_type: string
          status?: string
          team_id?: string | null
          title_delta?: number
          user_id: string
          win_delta?: number
        }
        Update: {
          created_at?: string
          details?: Json
          id?: string
          label?: string
          league_id?: string
          move_type?: string
          status?: string
          team_id?: string | null
          title_delta?: number
          user_id?: string
          win_delta?: number
        }
        Relationships: [
          {
            foreignKeyName: "saved_moves_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_moves_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          external_id: string | null
          id: string
          is_mine: boolean
          league_id: string
          losses: number
          name: string
          owner_name: string | null
          points_against: number
          points_for: number
          ties: number
          updated_at: string
          user_id: string
          wins: number
        }
        Insert: {
          created_at?: string
          external_id?: string | null
          id?: string
          is_mine?: boolean
          league_id: string
          losses?: number
          name: string
          owner_name?: string | null
          points_against?: number
          points_for?: number
          ties?: number
          updated_at?: string
          user_id: string
          wins?: number
        }
        Update: {
          created_at?: string
          external_id?: string | null
          id?: string
          is_mine?: boolean
          league_id?: string
          losses?: number
          name?: string
          owner_name?: string | null
          points_against?: number
          points_for?: number
          ties?: number
          updated_at?: string
          user_id?: string
          wins?: number
        }
        Relationships: [
          {
            foreignKeyName: "teams_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_history: {
        Row: {
          created_at: string
          gave: Json
          got: Json
          id: string
          league_id: string
          note: string | null
          partner_team_name: string | null
          playoff_odds_after: number
          playoff_odds_before: number
          points_delta: number
          status: string
          team_id: string | null
          title_odds_after: number
          title_odds_before: number
          user_id: string
          verdict: string
          week: number
          wins_after: number
          wins_before: number
        }
        Insert: {
          created_at?: string
          gave?: Json
          got?: Json
          id?: string
          league_id: string
          note?: string | null
          partner_team_name?: string | null
          playoff_odds_after?: number
          playoff_odds_before?: number
          points_delta?: number
          status?: string
          team_id?: string | null
          title_odds_after?: number
          title_odds_before?: number
          user_id: string
          verdict?: string
          week?: number
          wins_after?: number
          wins_before?: number
        }
        Update: {
          created_at?: string
          gave?: Json
          got?: Json
          id?: string
          league_id?: string
          note?: string | null
          partner_team_name?: string | null
          playoff_odds_after?: number
          playoff_odds_before?: number
          points_delta?: number
          status?: string
          team_id?: string | null
          title_odds_after?: number
          title_odds_before?: number
          user_id?: string
          verdict?: string
          week?: number
          wins_after?: number
          wins_before?: number
        }
        Relationships: [
          {
            foreignKeyName: "trade_history_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_history_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
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

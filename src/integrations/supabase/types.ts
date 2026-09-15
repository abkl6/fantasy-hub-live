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
      cron_keys: {
        Row: {
          created_at: string
          name: string
          token: string
        }
        Insert: {
          created_at?: string
          name: string
          token?: string
        }
        Update: {
          created_at?: string
          name?: string
          token?: string
        }
        Relationships: []
      }
      draft_picks: {
        Row: {
          created_at: string
          id: string
          league_id: string
          nfl_team: string | null
          pick_number: number
          player_name: string
          position: string
          proj_points_season: number
          round: number | null
          team_id: string
          updated_at: string
          user_id: string
          value_vs_adp: number
        }
        Insert: {
          created_at?: string
          id?: string
          league_id: string
          nfl_team?: string | null
          pick_number: number
          player_name: string
          position: string
          proj_points_season?: number
          round?: number | null
          team_id: string
          updated_at?: string
          user_id: string
          value_vs_adp?: number
        }
        Update: {
          created_at?: string
          id?: string
          league_id?: string
          nfl_team?: string | null
          pick_number?: number
          player_name?: string
          position?: string
          proj_points_season?: number
          round?: number | null
          team_id?: string
          updated_at?: string
          user_id?: string
          value_vs_adp?: number
        }
        Relationships: [
          {
            foreignKeyName: "draft_picks_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_picks_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      faab_bids: {
        Row: {
          amount: number
          created_at: string
          id: string
          league_id: string
          player_name: string
          team_id: string | null
          updated_at: string
          user_id: string
          week: number
          won: boolean
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          league_id: string
          player_name: string
          team_id?: string | null
          updated_at?: string
          user_id: string
          week?: number
          won?: boolean
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          league_id?: string
          player_name?: string
          team_id?: string | null
          updated_at?: string
          user_id?: string
          week?: number
          won?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "faab_bids_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faab_bids_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      leagues: {
        Row: {
          color: string | null
          created_at: string
          current_week: number
          external_id: string | null
          faab_budget: number
          format: string
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
          color?: string | null
          created_at?: string
          current_week?: number
          external_id?: string | null
          faab_budget?: number
          format?: string
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
          color?: string | null
          created_at?: string
          current_week?: number
          external_id?: string | null
          faab_budget?: number
          format?: string
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
      live_player_stats: {
        Row: {
          created_at: string
          game_clock: string | null
          game_state: string
          id: string
          opponent: string | null
          player_id: string
          season: number
          sleeper_id: string | null
          stats: Json
          updated_at: string
          week: number
        }
        Insert: {
          created_at?: string
          game_clock?: string | null
          game_state?: string
          id?: string
          opponent?: string | null
          player_id: string
          season: number
          sleeper_id?: string | null
          stats?: Json
          updated_at?: string
          week: number
        }
        Update: {
          created_at?: string
          game_clock?: string | null
          game_state?: string
          id?: string
          opponent?: string | null
          player_id?: string
          season?: number
          sleeper_id?: string | null
          stats?: Json
          updated_at?: string
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "live_player_stats_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
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
      nfl_schedule: {
        Row: {
          created_at: string
          id: string
          nfl_team: string
          opponent: string | null
          season: number
          week: number
        }
        Insert: {
          created_at?: string
          id?: string
          nfl_team: string
          opponent?: string | null
          season?: number
          week: number
        }
        Update: {
          created_at?: string
          id?: string
          nfl_team?: string
          opponent?: string | null
          season?: number
          week?: number
        }
        Relationships: []
      }
      notification_log: {
        Row: {
          body: string
          created_at: string
          dedupe_key: string | null
          detail: string | null
          id: string
          kind: string
          ref: string | null
          title: string
          url: string | null
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          dedupe_key?: string | null
          detail?: string | null
          id?: string
          kind: string
          ref?: string | null
          title: string
          url?: string | null
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          dedupe_key?: string | null
          detail?: string | null
          id?: string
          kind?: string
          ref?: string | null
          title?: string
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      notification_prefs: {
        Row: {
          created_at: string
          inactives: boolean
          lead_change: boolean
          lineup_lock: boolean
          red_zone: boolean
          scoring_plays: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          inactives?: boolean
          lead_change?: boolean
          lineup_lock?: boolean
          red_zone?: boolean
          scoring_plays?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          inactives?: boolean
          lead_change?: boolean
          lineup_lock?: boolean
          red_zone?: boolean
          scoring_plays?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pick_values: {
        Row: {
          created_at: string
          fetched_at: string
          format: string
          id: string
          round: number
          season: number
          slot: string
          source: string
          updated_at: string
          value: number
        }
        Insert: {
          created_at?: string
          fetched_at?: string
          format: string
          id?: string
          round: number
          season: number
          slot?: string
          source?: string
          updated_at?: string
          value?: number
        }
        Update: {
          created_at?: string
          fetched_at?: string
          format?: string
          id?: string
          round?: number
          season?: number
          slot?: string
          source?: string
          updated_at?: string
          value?: number
        }
        Relationships: []
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
      player_news: {
        Row: {
          created_at: string
          id: string
          injury_body_part: string | null
          news_text: string | null
          player_id: string | null
          player_name: string
          position: string
          published_at: string
          source: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          injury_body_part?: string | null
          news_text?: string | null
          player_id?: string | null
          player_name: string
          position: string
          published_at?: string
          source?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          injury_body_part?: string | null
          news_text?: string | null
          player_id?: string | null
          player_name?: string
          position?: string
          published_at?: string
          source?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_news_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_projection_overrides: {
        Row: {
          created_at: string
          id: string
          player_id: string
          proj_points_season: number
          proj_points_week: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          player_id: string
          proj_points_season?: number
          proj_points_week?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          player_id?: string
          proj_points_season?: number
          proj_points_week?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_projection_overrides_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_trade_values: {
        Row: {
          age: number | null
          created_at: string
          display_name: string
          fetched_at: string
          format: string
          id: string
          nfl_team: string | null
          norm_name: string
          overall_rank: number | null
          player_id: string | null
          position: string
          position_rank: number | null
          source: string
          tier: number | null
          updated_at: string
          value: number
        }
        Insert: {
          age?: number | null
          created_at?: string
          display_name: string
          fetched_at?: string
          format: string
          id?: string
          nfl_team?: string | null
          norm_name: string
          overall_rank?: number | null
          player_id?: string | null
          position: string
          position_rank?: number | null
          source?: string
          tier?: number | null
          updated_at?: string
          value?: number
        }
        Update: {
          age?: number | null
          created_at?: string
          display_name?: string
          fetched_at?: string
          format?: string
          id?: string
          nfl_team?: string | null
          norm_name?: string
          overall_rank?: number | null
          player_id?: string | null
          position?: string
          position_rank?: number | null
          source?: string
          tier?: number | null
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "player_trade_values_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_week_stats: {
        Row: {
          created_at: string
          id: string
          opponent: string | null
          player_id: string
          season: number
          src_points: number
          stats: Json
          updated_at: string
          week: number
        }
        Insert: {
          created_at?: string
          id?: string
          opponent?: string | null
          player_id: string
          season?: number
          src_points?: number
          stats?: Json
          updated_at?: string
          week: number
        }
        Update: {
          created_at?: string
          id?: string
          opponent?: string | null
          player_id?: string
          season?: number
          src_points?: number
          stats?: Json
          updated_at?: string
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "player_week_stats_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          age: number | null
          bye_week: number | null
          created_at: string
          full_name: string
          id: string
          ir_since: string | null
          nfl_team: string | null
          position: string
          proj_points_season: number
          proj_points_week: number
          search_name: string
          sleeper_id: string | null
          stat_projections: Json
          status: string
          updated_at: string
          volatility: number
          years_exp: number | null
        }
        Insert: {
          age?: number | null
          bye_week?: number | null
          created_at?: string
          full_name: string
          id?: string
          ir_since?: string | null
          nfl_team?: string | null
          position: string
          proj_points_season?: number
          proj_points_week?: number
          search_name: string
          sleeper_id?: string | null
          stat_projections?: Json
          status?: string
          updated_at?: string
          volatility?: number
          years_exp?: number | null
        }
        Update: {
          age?: number | null
          bye_week?: number | null
          created_at?: string
          full_name?: string
          id?: string
          ir_since?: string | null
          nfl_team?: string | null
          position?: string
          proj_points_season?: number
          proj_points_week?: number
          search_name?: string
          sleeper_id?: string | null
          stat_projections?: Json
          status?: string
          updated_at?: string
          volatility?: number
          years_exp?: number | null
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
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
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
      scoring_events: {
        Row: {
          created_at: string
          dedupe_key: string
          delta: Json
          description: string
          id: string
          nfl_team: string | null
          occurred_at: string
          player_id: string
          player_name: string
          position: string
          season: number
          week: number
        }
        Insert: {
          created_at?: string
          dedupe_key: string
          delta?: Json
          description: string
          id?: string
          nfl_team?: string | null
          occurred_at?: string
          player_id: string
          player_name: string
          position: string
          season: number
          week: number
        }
        Update: {
          created_at?: string
          dedupe_key?: string
          delta?: Json
          description?: string
          id?: string
          nfl_team?: string | null
          occurred_at?: string
          player_id?: string
          player_name?: string
          position?: string
          season?: number
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "scoring_events_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      team_draft_picks: {
        Row: {
          count: number
          created_at: string
          id: string
          league_id: string
          original_team_id: string | null
          round: number
          season: number
          slot: string
          team_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          count?: number
          created_at?: string
          id?: string
          league_id: string
          original_team_id?: string | null
          round: number
          season: number
          slot?: string
          team_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          count?: number
          created_at?: string
          id?: string
          league_id?: string
          original_team_id?: string | null
          round?: number
          season?: number
          slot?: string
          team_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_draft_picks_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_draft_picks_original_team_id_fkey"
            columns: ["original_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_draft_picks_team_id_fkey"
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
          faab_remaining: number | null
          faab_spent: number
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
          faab_remaining?: number | null
          faab_spent?: number
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
          faab_remaining?: number | null
          faab_spent?: number
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
      trade_value_refresh_log: {
        Row: {
          error: string | null
          id: string
          picks_upserted: number
          rows_upserted: number
          run_at: string
          scope: string
          source: string
          status: string
        }
        Insert: {
          error?: string | null
          id?: string
          picks_upserted?: number
          rows_upserted?: number
          run_at?: string
          scope?: string
          source?: string
          status?: string
        }
        Update: {
          error?: string | null
          id?: string
          picks_upserted?: number
          rows_upserted?: number
          run_at?: string
          scope?: string
          source?: string
          status?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      weekly_snapshots: {
        Row: {
          created_at: string
          id: string
          league_id: string
          playoff_odds: number
          power_score: number
          proj_losses: number
          proj_wins: number
          review: Json | null
          team_id: string
          title_odds: number
          user_id: string
          week: number
        }
        Insert: {
          created_at?: string
          id?: string
          league_id: string
          playoff_odds?: number
          power_score?: number
          proj_losses?: number
          proj_wins?: number
          review?: Json | null
          team_id: string
          title_odds?: number
          user_id: string
          week: number
        }
        Update: {
          created_at?: string
          id?: string
          league_id?: string
          playoff_odds?: number
          power_score?: number
          proj_losses?: number
          proj_wins?: number
          review?: Json | null
          team_id?: string
          title_odds?: number
          user_id?: string
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "weekly_snapshots_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_snapshots_team_id_fkey"
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      norm_player_name: { Args: { name: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const

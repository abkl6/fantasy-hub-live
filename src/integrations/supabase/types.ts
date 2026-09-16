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
      age_curves: {
        Row: {
          created_at: string
          fitted_at: string
          format: string
          id: string
          points: Json
          position: string
          sample_size: number
          source: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          fitted_at?: string
          format?: string
          id?: string
          points?: Json
          position: string
          sample_size?: number
          source?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          fitted_at?: string
          format?: string
          id?: string
          points?: Json
          position?: string
          sample_size?: number
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      calibration_log: {
        Row: {
          actual: number | null
          brier: number | null
          created_at: string
          error: number | null
          graded_at: string | null
          id: string
          kind: string
          league_id: string | null
          position: string | null
          predicted: number
          season: number
          subject: string
          team_id: string | null
          updated_at: string
          user_id: string
          week: number
        }
        Insert: {
          actual?: number | null
          brier?: number | null
          created_at?: string
          error?: number | null
          graded_at?: string | null
          id?: string
          kind: string
          league_id?: string | null
          position?: string | null
          predicted: number
          season: number
          subject: string
          team_id?: string | null
          updated_at?: string
          user_id: string
          week: number
        }
        Update: {
          actual?: number | null
          brier?: number | null
          created_at?: string
          error?: number | null
          graded_at?: string | null
          id?: string
          kind?: string
          league_id?: string | null
          position?: string | null
          predicted?: number
          season?: number
          subject?: string
          team_id?: string | null
          updated_at?: string
          user_id?: string
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "calibration_log_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calibration_log_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
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
      defense_ranks: {
        Row: {
          created_at: string
          id: string
          nfl_team: string
          points_allowed: number
          rank: number
          season: number
          updated_at: string
          week: number
        }
        Insert: {
          created_at?: string
          id?: string
          nfl_team: string
          points_allowed?: number
          rank: number
          season: number
          updated_at?: string
          week: number
        }
        Update: {
          created_at?: string
          id?: string
          nfl_team?: string
          points_allowed?: number
          rank?: number
          season?: number
          updated_at?: string
          week?: number
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
      job_errors: {
        Row: {
          created_at: string
          detail: Json
          id: string
          message: string
          platform: string | null
          scope: string | null
          source: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          detail?: Json
          id?: string
          message: string
          platform?: string | null
          scope?: string | null
          source: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          detail?: Json
          id?: string
          message?: string
          platform?: string | null
          scope?: string | null
          source?: string
          user_id?: string | null
        }
        Relationships: []
      }
      leagues: {
        Row: {
          all_play_weeks: Json
          class_override: string | null
          color: string | null
          consolation: Json
          contest_format: string
          created_at: string
          current_week: number
          divisions: Json
          external_id: string | null
          faab_budget: number
          format: string
          id: string
          last_confirmed_at: string | null
          last_sync_error: string | null
          last_synced_at: string | null
          league_type: string
          name: string
          platform: string
          playoff_byes: number
          playoff_seed_type: string | null
          playoff_teams: number
          playoff_week_start: number | null
          playoff_weeks: Json
          points_playoff_teams: number | null
          points_playoff_week: number | null
          projection_source: string
          regular_season_weeks: number
          roster_slots: Json
          rules_text: string | null
          scoring_rules: Json
          scoring_type: string
          season: number
          settings_source: Json
          sos_adjust: boolean
          sync_paused: boolean
          team_count: number
          third_place_game: boolean
          type_source: string
          updated_at: string
          user_id: string
          variant: string
          waiver_run_times: Json
          waiver_type: string | null
          weekly_high_bonus: boolean
          weekly_high_label: string | null
        }
        Insert: {
          all_play_weeks?: Json
          class_override?: string | null
          color?: string | null
          consolation?: Json
          contest_format?: string
          created_at?: string
          current_week?: number
          divisions?: Json
          external_id?: string | null
          faab_budget?: number
          format?: string
          id?: string
          last_confirmed_at?: string | null
          last_sync_error?: string | null
          last_synced_at?: string | null
          league_type?: string
          name: string
          platform?: string
          playoff_byes?: number
          playoff_seed_type?: string | null
          playoff_teams?: number
          playoff_week_start?: number | null
          playoff_weeks?: Json
          points_playoff_teams?: number | null
          points_playoff_week?: number | null
          projection_source?: string
          regular_season_weeks?: number
          roster_slots?: Json
          rules_text?: string | null
          scoring_rules?: Json
          scoring_type?: string
          season?: number
          settings_source?: Json
          sos_adjust?: boolean
          sync_paused?: boolean
          team_count?: number
          third_place_game?: boolean
          type_source?: string
          updated_at?: string
          user_id: string
          variant?: string
          waiver_run_times?: Json
          waiver_type?: string | null
          weekly_high_bonus?: boolean
          weekly_high_label?: string | null
        }
        Update: {
          all_play_weeks?: Json
          class_override?: string | null
          color?: string | null
          consolation?: Json
          contest_format?: string
          created_at?: string
          current_week?: number
          divisions?: Json
          external_id?: string | null
          faab_budget?: number
          format?: string
          id?: string
          last_confirmed_at?: string | null
          last_sync_error?: string | null
          last_synced_at?: string | null
          league_type?: string
          name?: string
          platform?: string
          playoff_byes?: number
          playoff_seed_type?: string | null
          playoff_teams?: number
          playoff_week_start?: number | null
          playoff_weeks?: Json
          points_playoff_teams?: number | null
          points_playoff_week?: number | null
          projection_source?: string
          regular_season_weeks?: number
          roster_slots?: Json
          rules_text?: string | null
          scoring_rules?: Json
          scoring_type?: string
          season?: number
          settings_source?: Json
          sos_adjust?: boolean
          sync_paused?: boolean
          team_count?: number
          third_place_game?: boolean
          type_source?: string
          updated_at?: string
          user_id?: string
          variant?: string
          waiver_run_times?: Json
          waiver_type?: string | null
          weekly_high_bonus?: boolean
          weekly_high_label?: string | null
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
      manual_lineups: {
        Row: {
          confirmed: boolean
          created_at: string
          id: string
          league_id: string
          slots: Json
          team_id: string
          updated_at: string
          user_id: string
          week: number
        }
        Insert: {
          confirmed?: boolean
          created_at?: string
          id?: string
          league_id: string
          slots?: Json
          team_id: string
          updated_at?: string
          user_id: string
          week: number
        }
        Update: {
          confirmed?: boolean
          created_at?: string
          id?: string
          league_id?: string
          slots?: Json
          team_id?: string
          updated_at?: string
          user_id?: string
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "manual_lineups_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_lineups_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_transactions: {
        Row: {
          created_at: string
          dedupe_key: string
          from_team_id: string | null
          id: string
          kind: string
          league_id: string
          norm_name: string
          occurred_on: string
          player_name: string
          position: string | null
          raw_line: string | null
          to_team_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dedupe_key: string
          from_team_id?: string | null
          id?: string
          kind: string
          league_id: string
          norm_name: string
          occurred_on: string
          player_name: string
          position?: string | null
          raw_line?: string | null
          to_team_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dedupe_key?: string
          from_team_id?: string | null
          id?: string
          kind?: string
          league_id?: string
          norm_name?: string
          occurred_on?: string
          player_name?: string
          position?: string | null
          raw_line?: string | null
          to_team_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "manual_transactions_from_team_id_fkey"
            columns: ["from_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_transactions_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_transactions_to_team_id_fkey"
            columns: ["to_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
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
      player_blend_rates: {
        Row: {
          blend_weight: number
          created_at: string
          games_played: number
          id: string
          per_game: Json
          player_id: string
          season: number
          source: string
          updated_at: string
        }
        Insert: {
          blend_weight?: number
          created_at?: string
          games_played?: number
          id?: string
          per_game?: Json
          player_id: string
          season: number
          source?: string
          updated_at?: string
        }
        Update: {
          blend_weight?: number
          created_at?: string
          games_played?: number
          id?: string
          per_game?: Json
          player_id?: string
          season?: number
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_blend_rates_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_constraints: {
        Row: {
          created_at: string
          id: string
          league_id: string
          norm_name: string
          player_id: string | null
          player_name: string
          tag: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          league_id: string
          norm_name: string
          player_id?: string | null
          player_name: string
          tag: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          league_id?: string
          norm_name?: string
          player_id?: string | null
          player_name?: string
          tag?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_constraints_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_constraints_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
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
      player_season_projections: {
        Row: {
          created_at: string
          id: string
          player_id: string
          season: number
          source: string
          src_points: number
          stats: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          player_id: string
          season: number
          source: string
          src_points?: number
          stats?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          player_id?: string
          season?: number
          source?: string
          src_points?: number
          stats?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_season_projections_player_id_fkey"
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
          source: string
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
          source?: string
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
          source?: string
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
          espn_id: string | null
          full_name: string
          id: string
          ir_since: string | null
          ktc_slug: string | null
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
          yahoo_id: string | null
          years_exp: number | null
        }
        Insert: {
          age?: number | null
          bye_week?: number | null
          created_at?: string
          espn_id?: string | null
          full_name: string
          id?: string
          ir_since?: string | null
          ktc_slug?: string | null
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
          yahoo_id?: string | null
          years_exp?: number | null
        }
        Update: {
          age?: number | null
          bye_week?: number | null
          created_at?: string
          espn_id?: string | null
          full_name?: string
          id?: string
          ir_since?: string | null
          ktc_slug?: string | null
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
          yahoo_id?: string | null
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
      projection_batches: {
        Row: {
          created_at: string
          id: string
          label: string
          matched_count: number
          published: boolean
          row_count: number
          rows: Json
          season: number
          source: string
          updated_at: string
          uploaded_by: string | null
          week: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          matched_count?: number
          published?: boolean
          row_count?: number
          rows?: Json
          season: number
          source: string
          updated_at?: string
          uploaded_by?: string | null
          week?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          matched_count?: number
          published?: boolean
          row_count?: number
          rows?: Json
          season?: number
          source?: string
          updated_at?: string
          uploaded_by?: string | null
          week?: number | null
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
      recommendation_log: {
        Row: {
          acted_at: string | null
          action: string
          add_name: string | null
          created_at: string
          detail: string | null
          drop_name: string | null
          dynasty_rank_delta: number
          dynasty_value_delta: number
          grade: string | null
          grade_note: string | null
          graded_week: number | null
          headline: string
          id: string
          impact_label: string | null
          kind: string
          league_id: string
          playoff_delta: number
          points_delta: number
          rec_key: string
          surface: string
          team_class: string | null
          team_id: string | null
          title_delta: number
          updated_at: string
          user_id: string
          week: number
        }
        Insert: {
          acted_at?: string | null
          action?: string
          add_name?: string | null
          created_at?: string
          detail?: string | null
          drop_name?: string | null
          dynasty_rank_delta?: number
          dynasty_value_delta?: number
          grade?: string | null
          grade_note?: string | null
          graded_week?: number | null
          headline: string
          id?: string
          impact_label?: string | null
          kind: string
          league_id: string
          playoff_delta?: number
          points_delta?: number
          rec_key: string
          surface?: string
          team_class?: string | null
          team_id?: string | null
          title_delta?: number
          updated_at?: string
          user_id: string
          week: number
        }
        Update: {
          acted_at?: string | null
          action?: string
          add_name?: string | null
          created_at?: string
          detail?: string | null
          drop_name?: string | null
          dynasty_rank_delta?: number
          dynasty_value_delta?: number
          grade?: string | null
          grade_note?: string | null
          graded_week?: number | null
          headline?: string
          id?: string
          impact_label?: string | null
          kind?: string
          league_id?: string
          playoff_delta?: number
          points_delta?: number
          rec_key?: string
          surface?: string
          team_class?: string | null
          team_id?: string | null
          title_delta?: number
          updated_at?: string
          user_id?: string
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_log_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_log_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
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
      score_reconciliation: {
        Row: {
          computed: number
          created_at: string
          diff: number
          id: string
          league_id: string
          reported: number
          season: number
          team_id: string | null
          top_player_diff: number
          top_player_name: string | null
          updated_at: string
          user_id: string
          week: number
        }
        Insert: {
          computed?: number
          created_at?: string
          diff?: number
          id?: string
          league_id: string
          reported?: number
          season: number
          team_id?: string | null
          top_player_diff?: number
          top_player_name?: string | null
          updated_at?: string
          user_id: string
          week: number
        }
        Update: {
          computed?: number
          created_at?: string
          diff?: number
          id?: string
          league_id?: string
          reported?: number
          season?: number
          team_id?: string | null
          top_player_diff?: number
          top_player_name?: string | null
          updated_at?: string
          user_id?: string
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "score_reconciliation_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "score_reconciliation_team_id_fkey"
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
      strategy_rules: {
        Row: {
          category: string
          created_at: string
          enabled: boolean
          id: string
          key: string
          rationale: string
          rule: string
          sort_order: number
          updated_at: string
          weight: number
        }
        Insert: {
          category: string
          created_at?: string
          enabled?: boolean
          id?: string
          key: string
          rationale: string
          rule: string
          sort_order?: number
          updated_at?: string
          weight?: number
        }
        Update: {
          category?: string
          created_at?: string
          enabled?: boolean
          id?: string
          key?: string
          rationale?: string
          rule?: string
          sort_order?: number
          updated_at?: string
          weight?: number
        }
        Relationships: []
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
      team_implied_totals: {
        Row: {
          created_at: string
          id: string
          implied: number
          nfl_team: string
          season: number
          source: string
          updated_at: string
          week: number
        }
        Insert: {
          created_at?: string
          id?: string
          implied: number
          nfl_team: string
          season: number
          source?: string
          updated_at?: string
          week: number
        }
        Update: {
          created_at?: string
          id?: string
          implied?: number
          nfl_team?: string
          season?: number
          source?: string
          updated_at?: string
          week?: number
        }
        Relationships: []
      }
      team_position_strength: {
        Row: {
          created_at: string
          games: number
          id: string
          measure: number | null
          multiplier: number
          nfl_team: string
          position_group: string
          prior_games: number
          prior_measure: number | null
          season: number
          source: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          games?: number
          id?: string
          measure?: number | null
          multiplier?: number
          nfl_team: string
          position_group: string
          prior_games?: number
          prior_measure?: number | null
          season: number
          source?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          games?: number
          id?: string
          measure?: number | null
          multiplier?: number
          nfl_team?: string
          position_group?: string
          prior_games?: number
          prior_measure?: number | null
          season?: number
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      teams: {
        Row: {
          created_at: string
          division: string | null
          eliminated_week: number | null
          external_id: string | null
          faab_remaining: number | null
          faab_spent: number
          id: string
          is_mine: boolean
          league_id: string
          losses: number
          name: string
          owner_name: string | null
          playoff_seed: number | null
          points_against: number
          points_for: number
          ties: number
          updated_at: string
          user_id: string
          vp: number
          wins: number
        }
        Insert: {
          created_at?: string
          division?: string | null
          eliminated_week?: number | null
          external_id?: string | null
          faab_remaining?: number | null
          faab_spent?: number
          id?: string
          is_mine?: boolean
          league_id: string
          losses?: number
          name: string
          owner_name?: string | null
          playoff_seed?: number | null
          points_against?: number
          points_for?: number
          ties?: number
          updated_at?: string
          user_id: string
          vp?: number
          wins?: number
        }
        Update: {
          created_at?: string
          division?: string | null
          eliminated_week?: number | null
          external_id?: string | null
          faab_remaining?: number | null
          faab_spent?: number
          id?: string
          is_mine?: boolean
          league_id?: string
          losses?: number
          name?: string
          owner_name?: string | null
          playoff_seed?: number | null
          points_against?: number
          points_for?: number
          ties?: number
          updated_at?: string
          user_id?: string
          vp?: number
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
      unmatched_players: {
        Row: {
          batch_id: string | null
          created_at: string
          id: string
          nfl_team: string | null
          payload: Json
          position: string | null
          raw_name: string
          resolved_player_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          id?: string
          nfl_team?: string | null
          payload?: Json
          position?: string | null
          raw_name: string
          resolved_player_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          id?: string
          nfl_team?: string | null
          payload?: Json
          position?: string | null
          raw_name?: string
          resolved_player_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unmatched_players_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "projection_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unmatched_players_resolved_player_id_fkey"
            columns: ["resolved_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
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
      volatility_adjustments: {
        Row: {
          created_at: string
          id: string
          next: number
          position: string
          previous: number
          reason: string
          sample_weeks: number
          season: number
          week: number
        }
        Insert: {
          created_at?: string
          id?: string
          next: number
          position: string
          previous: number
          reason: string
          sample_weeks?: number
          season: number
          week: number
        }
        Update: {
          created_at?: string
          id?: string
          next?: number
          position?: string
          previous?: number
          reason?: string
          sample_weeks?: number
          season?: number
          week?: number
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

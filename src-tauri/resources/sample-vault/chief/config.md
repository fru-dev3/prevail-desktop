# AI Ready Life: Chief — Config

> Fill in your details. Chief of Staff reads this file to orchestrate your daily and weekly briefs.
> Leave a field blank rather than guessing — the agent will flag it.

## Identity
name: Alex Rivera
timezone: America/Chicago
wake_time: 06:15
daily_brief_time: 06:45

## Active Domains
# Comma-separated — list only the domains you have plugins installed for
primary_domains_active: people, mail, chief, explore, wealth, tax, insurance, homestead, health, fitness, career, travel, calendar

## This Quarter
current_quarter: Q2 2026
annual_theme: Build durable foundations without lighting up the burn rate

## Top Priorities
# List 3-5 priorities for this quarter — Chief will track these across all domains
top_priorities_this_quarter:
  - Clear the three June deadlines: Q2 tax 6/15, HVAC 6/18, Acme 6/20
  - Make the capital call: HVAC from cash, bind $1M umbrella, hold mortgage prepay
  - Grow consulting recurring revenue toward the $8k/mo full-time threshold
  - Stay on half-marathon training and bring LDL down before the Aug recheck

## Review Cadence
daily_brief_enabled: true
weekly_preview_day: Sunday
weekly_preview_time: 08:00
monthly_review_day: 1

## Alerts
alert_threshold_urgent: deadline within 5 days OR account movement over $1,000
domains_to_check_daily: mail, calendar, chief
domains_to_check_weekly: wealth, tax, insurance, homestead, health, career, travel, people

## Integrations
notion_connected: false
notion_database_id: 
gdrive_connected: false
gdrive_root_folder: 

## Preferences
brief_format: prioritized action list with cross-domain tags
brief_length: one page
include_weather: true
include_market_snapshot: true

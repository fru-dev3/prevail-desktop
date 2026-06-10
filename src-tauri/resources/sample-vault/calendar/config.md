# AI Ready Life: Calendar — Config

> Fill in your details. Skills read this file to personalize their output.
> Leave a field blank rather than guessing — the agent will flag it.

## Identity
name: Alex Rivera
timezone: America/Chicago
employer: TechFlow Inc (Senior Software Engineer); Alex Rivera Consulting LLC (side)

## Primary Calendar
primary_calendar: Google Calendar (personal)
calendar_id_or_email: alex.rivera@example.com

## Work Schedule
work_hours_start: 09:00
work_hours_end: 17:30
work_days: Mon-Fri
focus_block_duration_hours: 2
meeting_free_days: Wednesday

## Domain Deadline Sync
# Comma-separated — which domain deadlines to pull into calendar
domains_to_sync_deadlines: career, homestead, insurance, wealth, health, travel

## Family / School
school_district: Austin ISD
children_school_names: Sunset Valley Elementary (Maya, 1st grade)
school_calendar_url: https://example.com/sunset-valley-calendar

## Recurring Deadlines
# One per line: name | date/frequency | source_domain
key_recurring_deadlines:
  - Mortgage payment (Lone Star) | 1st of month | homestead
  - Maya swim lessons | Tue and Thu 16:00 | health
  - Saturday long run | weekly Sat AM | health
  - Consulting invoicing | end of month | career

## Integrations
google_calendar_connected: true
notion_connected: true
notion_calendar_db_id: demo-notion-cal-0042

## Focus Time Preferences
preferred_focus_time_of_day: morning
focus_block_label: Deep Work
protect_focus_blocks: true

## Goals
weekly_focus_hours_target: 12
max_meetings_per_day: 4
buffer_between_meetings_minutes: 15

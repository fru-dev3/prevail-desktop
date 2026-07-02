---
id: sync-activities-browser
runner: browser-agent
trigger: refresh
favorite: true
method: browser
capability: sync-activities
session: profile
start_url: https://www.strava.com/athlete/training
domain_allow: [www.strava.com, strava.com]
success_url_contains: strava.com
goal: Open Strava in the logged-in session and read recent activities (type, date, distance, moving time, elevation, average pace or speed, average and max heart rate). Read-only: never kudos, comment, edit, or delete an activity.
outputs:
  - { path: data/strava-activities-${date}.json, kind: replace }
---
# Sync activities (browser, favorite)

Pull recent runs and rides from Strava using the logged-in browser session, no
API token needed. This is the favorite. If the browser is blocked or
unavailable, the pack falls through to the Strava API method, then to the
llm summariser, all writing the same data/strava-activities file the analysis
skills read.

Read-only. Capture type, date, distance, moving time, elevation, pace or speed,
and heart rate, then write a normalized JSON document. Never kudos, comment,
edit, or delete.

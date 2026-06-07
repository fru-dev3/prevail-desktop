---
name: coursera
type: app
description: >
  Tracks enrolled course progress, completion percentages, certificate status, and upcoming assignment deadlines on Coursera via Playwright with Chrome cookie session. Used by learning-agent for monthly progress sync and the weekly learning brief. Requires headless=False. Configure Coursera email and Chrome profile in vault/learning/config.md.
---

# Coursera

**Auth:** Playwright + Chrome cookies (session from existing Chrome login)
**URL:** https://www.coursera.org
**Configuration:** Set Coursera email and Chrome profile in `vault/learning/config.md`

## What It Provides

Coursera is one of the most rigorous consumer learning platforms — structured certificate programs backed by universities (Stanford, Johns Hopkins, Duke) and major tech companies (Google, IBM, Meta, Deeplearning.ai). Certificates on Coursera require completing graded assignments, passing quizzes (minimum 80% in most programs), and in some cases peer review. This makes them more credible than completion badges from less structured platforms. The platform is particularly strong for data science, machine learning, cloud certifications, and business fundamentals.

This skill reads Coursera's "My Learning" dashboard to extract progress data for the monthly learning sync. Rather than requiring the user to log in and manually check progress, the skill automates the collection and routes data to the vault for tracking and analysis.

## Data Available

**From coursera.org/my-learning:**
- All enrolled courses with status (In Progress / Completed / Dropped)
- Completion percentage for each in-progress course
- Certificate status: In Progress / Earned / Not started
- Next assignment or quiz deadline (if applicable — Coursera has both deadline-based and self-paced options)
- Specialization progress: if enrolled in a multi-course track, shows how many courses completed and which are remaining
- Grade and passing status for completed graded items
- Recommended next courses based on enrollment history

**From individual course pages:**
- Module-by-module completion (checked vs. unchecked)
- Quiz scores and attempt counts
- Certificate download link (for completed courses)

## Configuration

Add to `vault/learning/config.md`:
```yaml
coursera_email: "YOUR_COURSERA_EMAIL"
coursera_chrome_profile: "/Users/YOU/Library/Application Support/Google/Chrome/Default"
```

## Technical Notes

- **Always headless=False** — Coursera uses bot detection and may require CAPTCHA with headless Chrome
- **Dashboard URL:** coursera.org/my-learning — shows all enrolled courses and progress
- **Certificate download:** Available from the completed course page; download to `vault/learning/01_prior/certs/` for record-keeping
- **Session freshness:** Coursera sessions typically persist for 30+ days; re-authenticate in Chrome if the skill receives a login redirect
- **Free vs. paid courses:** Some courses are available to audit (free) but certificates require payment — note audit status in progress tracking

## Key URLs

```
https://www.coursera.org/my-learning  # main dashboard
https://www.coursera.org/account-profile  # profile and learning activity
```

## Specializations and Professional Certificates

Coursera's most valuable credentials are Professional Certificates (Google Data Analytics, Google Project Management, IBM Data Science, Meta Front-End Developer) and Specializations (DeepLearning.AI Machine Learning Specialization, Johns Hopkins Data Science). These take 3-6 months and produce a credential that has real market recognition, especially when the issuing organization is well-known.

## Used By

- `aireadylife-learning-op-monthly-sync` — pull current completion percentages and deadline dates for all enrolled courses
- `aireadylife-learning-flow-build-progress-summary` — provide updated completion data for pace analysis

## Vault Output

- `~/Documents/aireadylife/vault/learning/00_current/coursera/` — course progress records
- `~/Documents/aireadylife/vault/learning/01_prior/certs/` — downloaded certificates for completed courses

# 1Password — Prompt Reference

## Routine

1. **Session Health Check:** "Is the 1Password CLI session still active?
   If it expires within 7 days, surface the re-auth command."

## Hygiene

2. **Stale Item Audit:** "List items in the Personal and Business vaults
   that haven't been modified in 12+ months. Suggest which to keep, prune,
   or update."

3. **Critical Item Coverage:** "Check that every critical business
   credential (Mercury, QuickBooks, IRS EFTPS, Plaid client secret) has
   both a current password AND 2FA backup codes attached as a secure
   note. Flag any gap."

## On-Demand

4. **Retrieve Credential:** "Get the login for <service> from the
   <vault> vault. Output: username, masked password, and any 2FA secret.
   Never write the password to a file."

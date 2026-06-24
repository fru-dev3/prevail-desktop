// broker — the single authorization checkpoint for consequential desktop actions
// (C1 / O94 / A-05). Instead of each consequential command verifying approval
// inline, they call through here, so there is ONE place that answers "may this
// action run?". Today it verifies the single-use, payload-bound approval token;
// future policy (risk classes, budgets, rate limits) belongs here too.

/// Authorize a consequential (domain, action) given its approval token. Returns
/// Err if the token is missing / invalid / expired / replayed, or isn't bound to
/// this exact (domain, action).
pub(crate) fn authorize_action(domain: &str, action: &str, approval_token: &str) -> Result<(), String> {
    if !crate::approval::verify_and_consume(approval_token, &crate::approval::action_payload(domain, action)) {
        return Err("approval token invalid, expired, or already used".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn authorize_requires_a_valid_bound_single_use_token() {
        let tok = crate::approval::mint(&crate::approval::action_payload("career", "email the recruiter"));
        // bound to the wrong action → rejected
        assert!(super::authorize_action("career", "delete everything", &tok).is_err());
        // correct action → accepted once
        assert!(super::authorize_action("career", "email the recruiter", &tok).is_ok());
        // replay → rejected (single-use)
        assert!(super::authorize_action("career", "email the recruiter", &tok).is_err());
    }
}

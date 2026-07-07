// macOS Keychain wrapper
//
// Uses the system `security` CLI rather than pulling in a native
// keychain crate. Two reasons:
//   1. /usr/bin/security ships on every macOS box.
//   2. Native crates often want extra entitlements that complicate
//      our notarization story; shelling out side-steps that.
//
// All secrets are stored as `generic-password` items scoped to
// service="prevail.ingestion" by default, with a caller-supplied
// account name (typically the integration: "fidelity", "composio", …).
//
// Errors are exposed as plain strings so the orchestrator can ferry
// them to the UI for display.

use std::process::Command;

const SECURITY_BIN: &str = "/usr/bin/security";

fn run(args: &[&str], stdin: Option<&[u8]>) -> Result<std::process::Output, String> {
    use std::io::Write;
    let mut cmd = Command::new(SECURITY_BIN);
    cmd.args(args);
    if stdin.is_some() {
        cmd.stdin(std::process::Stdio::piped());
    }
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn security: {e}"))?;
    if let Some(payload) = stdin {
        if let Some(mut s) = child.stdin.take() {
            s.write_all(payload).map_err(|e| format!("stdin: {e}"))?;
        }
    }
    let out = child
        .wait_with_output()
        .map_err(|e| format!("wait security: {e}"))?;
    Ok(out)
}

/// Add (or replace) a generic-password entry. The secret is fed on STDIN, not
/// as a `-w <secret>` argv (which is briefly visible to any local process via
/// `ps`). `security` reads the password from stdin when `-w` is given with no
/// value.
pub fn set(service: &str, account: &str, secret: &str) -> Result<(), String> {
    let payload = format!("{secret}\n");
    let out = run(
        &[
            "add-generic-password",
            "-U", // overwrite if it exists
            "-s",
            service,
            "-a",
            account,
            "-w", // no value: read the password from stdin
        ],
        Some(payload.as_bytes()),
    )?;
    if out.status.success() {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).to_string();
        Err(format!("keychain set failed: {err}"))
    }
}

/// Read a generic-password entry. Returns the secret as a UTF-8 string.
pub fn get(service: &str, account: &str) -> Result<String, String> {
    let out = run(
        &[
            "find-generic-password",
            "-w", // print only the password
            "-s",
            service,
            "-a",
            account,
        ],
        None,
    )?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).to_string();
        return Err(format!("keychain get failed: {err}"));
    }
    let mut s = String::from_utf8_lossy(&out.stdout).to_string();
    if s.ends_with('\n') { s.pop(); }
    Ok(s)
}

/// Remove a generic-password entry. Silent success if missing.
pub fn del(service: &str, account: &str) -> Result<(), String> {
    let out = run(
        &[
            "delete-generic-password",
            "-s",
            service,
            "-a",
            account,
        ],
        None,
    )?;
    // exit 44 = "item not found" which we treat as success
    if out.status.success() || out.status.code() == Some(44) {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).to_string();
        Err(format!("keychain del failed: {err}"))
    }
}

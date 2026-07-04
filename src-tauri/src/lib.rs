// Prevail desktop — Rust backend.
//
// v0.1 deliberately does NOT bundle the prevail CLI as a sidecar. Every
// cockpit feature is reimplemented natively:
//   - vault scanning via std::fs + walkdir
//   - CLI invocation via tauri-plugin-shell (spawns the user's existing
//     claude / codex / agy / ollama binaries from PATH)
//   - benchmark run loading via serde_json over results.json + score.json
//
// This keeps the desktop installable with zero CLI prereqs beyond
// whatever AI CLIs the user already has, and avoids the bundled-sidecar
// signing complexity for the first release.

mod benchmark;
mod appcmds;
mod bunker;
mod vault_lock;
mod chat;
mod children;
mod clis;
mod distill;
mod gateway_log;
mod hooks;
mod intent_daemon;
mod domain;
mod intents;
mod normalize;
mod consolidate;
mod idealstate;
mod omega;
mod google;
mod paths;
mod settings;
mod threads;
mod usage;
mod vault;
pub(crate) use chat::{build_cli_env, ideal_state_preamble, resolve_bin_abs, scrubbed_env_pairs};
pub(crate) use settings::close_to_tray_enabled;
pub(crate) use appcmds::secs_to_ymdhms;
mod engine;
mod vaultio;
mod approval;
mod broker;
mod loops;
mod activity;
mod ingestion;
mod runtime_connectors;
mod retrospect;
mod favicon;
mod composio;
mod nango;
mod reminders;
mod surface;
mod skillgen;
mod taskgen;
mod tasks;
mod telegram;
mod discord_bridge;
mod email_bridge;
mod native_bridge;
mod slack_bridge;
mod telegram_bridge;
mod watchdog;
mod webhook_bridge;
mod webui;
mod integrations;

use std::fs;
use std::path::Path;
#[allow(unused_imports)]
use tauri_plugin_shell::ShellExt;

// The spawned-child registry (register/unregister/snapshot/abort_sessions)
// lives in children.rs.

// ─────────────────────────────────────────────────────────────────────
// Vault scanning

// Domain shape + scan_vault live in vault.rs.

pub(crate) const NON_DOMAIN_DIRS: &[&str] = &[
    "domains", // v3 container — its children are scanned separately, not it
    "benchmark",
    "apps",
    ".git",
    ".DS_Store",
    "node_modules",
    "_archive",
    "_scratch",
];

// Retry I/O on EINTR (os error 4). macOS sandboxing + Tauri's runtime
// can interrupt syscalls; the fix is the standard retry-on-EINTR loop.
pub(crate) fn read_dir_retry(p: &Path) -> std::io::Result<fs::ReadDir> {
    for _ in 0..5 {
        match fs::read_dir(p) {
            Ok(it) => return Ok(it),
            Err(e) if e.raw_os_error() == Some(4) => continue,
            Err(e) => return Err(e),
        }
    }
    fs::read_dir(p)
}
pub(crate) fn read_to_string_retry<P: AsRef<Path>>(p: P) -> std::io::Result<String> {
    // Transparently decrypts sealed vault files when the session is unlocked
    // (engine::maybe_decrypt is a passthrough for plaintext / foreign paths).
    let p = p.as_ref();
    for _ in 0..5 {
        match fs::read_to_string(p) {
            Ok(s) => return Ok(engine::maybe_decrypt(p, s)),
            Err(e) if e.raw_os_error() == Some(4) => continue,
            Err(e) => return Err(e),
        }
    }
    fs::read_to_string(p).map(|s| engine::maybe_decrypt(p, s))
}

// (the domain state preview + scan_vault command moved to vault.rs)

// ─────────────────────────────────────────────────────────────────────
// CLI / provider detection (CliInfo, detect_clis) lives in clis.rs.

// Provider keys + UI settings/prefs + close-to-tray live in settings.rs.

// ─────────────────────────────────────────────────────────────────────
// Chat + CLI/env spawn helpers (ChatArgs, chat_send, build_cli_env,
// scrubbed_env_pairs, ideal_state_preamble, resolve_bin_abs) live in chat.rs;
// re-exported at the crate root so other modules keep using crate::<name>.


// ─────────────────────────────────────────────────────────────────────
// Benchmark saved-runs (BenchmarkRun, benchmark_runs, benchmark_run_detail)
// lives in benchmark.rs.

// ─────────────────────────────────────────────────────────────────────
// Usage accounting (UsageRecord, usage_append, usage_summary[_domain], the
// engine-summary mapping, and the one-time legacy-ledger migration) lives in
// usage.rs.

// ─────────────────────────────────────────────────────────────────────
// Intent ledger — the self-learning core. A chat IS an intent, and intents
// must never be lost. Every turn appends one JSON line to
// <vault>/<domain>/_intents.jsonl (<vault>/_intents.jsonl for the no-domain
// General space) the instant it happens: on send (the exact prompt) and on
// completion (the raw, unprocessed reply). Append-only, never overwritten —
// this is the rebuild-from-scratch source of truth. Each record carries the
// domain, model, and every preference in effect, so a future (better) model
// can be re-run against the original intent and the result rebuilt.

// The intent/decision/journal commands (intent_append, intents_read[_all],
// journal_append, decision_append, decisions_read, decision_feedback) live in
// intents.rs.

// ─────────────────────────────────────────────────────────────────────
// Benchmark questions bank (BenchQuestion[Input], benchmark_questions,
// benchmark_save/set_archived/delete/export/import_question[s]) lives in
// benchmark.rs.

// ─────────────────────────────────────────────────────────────────────
// Benchmark effectiveness matrix (MatrixRow, benchmark_matrix) lives in
// benchmark.rs.

// ─────────────────────────────────────────────────────────────────────
// App-shell commands (read_file, import_sample_vault, create_domain, OS
// integration, diagnostics, uninstall, save_session, …) live in appcmds.rs.


// ─────────────────────────────────────────────────────────────────────
// Threads (ThreadMeta/Turn/Full, list_threads/load_thread/save_thread/
// rename_thread/delete_thread) live in threads.rs.

// Domain workspace (DomainContext/LogEntry, read_domain_prompts, domain_tree,
// domain_context, scan_skills, skill_create) lives in domain.rs.

// ─────────────────────────────────────────────────────────────────────
// Telegram one-shot send (TelegramResult, telegram_send) lives in telegram.rs.


// ─────────────────────────────────────────────────────────────────────
// Native benchmark runner (BenchmarkRun/Score/SuggestArgs, benchmark_start /
// score / suggest) lives in benchmark.rs.

// ─────────────────────────────────────────────────────────────────────
// Entry point

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // C2: guard the vault against concurrent writers. The single-instance
        // plugin must be registered FIRST. A second launch never spins up a
        // second process pointed at the same vault folder (which the in-process
        // write lock cannot serialize); instead it just refocuses the window
        // that is already running.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            use tauri::Manager;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // F8: system-wide capture hotkey + deep-link handling. The shortcut
        // itself is registered in setup() (needs the app handle); deep-link URLs
        // (prevail://...) are forwarded to the frontend as an event, the
        // foundation for OAuth/connect redirects.
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        // Start-on-boot (LaunchAgent). The frontend toggles it via the
        // autostart plugin's enable/disable in Settings → General.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        // System tray + close-to-tray. Clicking the tray shows the window;
        // closing the window hides it instead of quitting when the
        // "Close to tray" pref is on (read from the window's localStorage via
        // a JS-set flag is awkward in Rust, so we always hide-on-close and let
        // Quit (tray menu / ⌘Q) actually exit).
        .setup(|app| {
            // Set VAULT_ROOT from the configured vault at startup so the first
            // no-arg engine calls (connectors list, etc.) inject the correct
            // PREVAIL_VAULT_ROOT before the UI calls engine_set_config_vault.
            if let Some(v) = engine::engine_config_vault() {
                engine::set_vault_root(Some(v));
            }
            use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
            use tauri::tray::TrayIconBuilder;
            use tauri::Manager;
            // B2-30: a purposeful tray menu — the fastest ways into Prevail without
            // hunting for the window. Quick actions emit to the frontend (which
            // shows the window + navigates); Show/Quit are window controls.
            let new_chat = MenuItemBuilder::with_id("new_chat", "New chat").build(app)?;
            let council = MenuItemBuilder::with_id("council", "Ask the council").build(app)?;
            let briefing = MenuItemBuilder::with_id("briefing", "Today's briefing").build(app)?;
            let incognito = MenuItemBuilder::with_id("incognito", "Toggle incognito").build(app)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let show = MenuItemBuilder::with_id("show", "Show Prevail").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit Prevail").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&new_chat, &council, &briefing, &incognito, &sep1, &show, &quit])
                .build()?;
            let _ = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    use tauri::{Emitter, Manager};
                    // Bring the window up, then tell the frontend which action to run.
                    let reveal_and_emit = |action: &str| {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                            let _ = w.emit("prevail:tray-action", action.to_string());
                        }
                    };
                    match event.id().as_ref() {
                        "new_chat" => reveal_and_emit("new-chat"),
                        "council" => reveal_and_emit("council"),
                        "briefing" => reveal_and_emit("briefing"),
                        "incognito" => reveal_and_emit("incognito"),
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    use tauri::tray::{MouseButton, TrayIconEvent};
                    use tauri::Manager;
                    if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Headless / auto-start: if PREVAIL_WEBUI_USER + PREVAIL_WEBUI_PASS
            // are set, start the WebUI bridge on boot (for a 24/7 remote
            // assistant, and for automated validation). Loopback-only + the
            // same allowlist as the manual toggle.
            if let (Ok(u), Ok(p)) = (std::env::var("PREVAIL_WEBUI_USER"), std::env::var("PREVAIL_WEBUI_PASS")) {
                if !u.is_empty() && !p.is_empty() {
                    let port: u16 = std::env::var("PREVAIL_WEBUI_PORT").ok().and_then(|s| s.parse().ok()).unwrap_or(8787);
                    let handle = app.handle().clone();
                    let st = app.state::<webui::WebuiState>();
                    let _ = st.start(handle, port, u, p);
                }
            }

            // F8: register the global capture hotkey (Cmd/Ctrl+Shift+Space).
            // Pressing it from anywhere reveals the window and opens Quick
            // Capture, so a note can be captured without the app focused.
            {
                use tauri::Emitter;
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
                let capture = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Space);
                if let Err(e) = app.global_shortcut().on_shortcut(capture, move |app, _sc, event| {
                    if event.state() == ShortcutState::Pressed {
                        use tauri::Manager;
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                            let _ = w.emit("prevail:quick-capture", ());
                        }
                    }
                }) {
                    eprintln!("global capture shortcut registration failed: {e}");
                }
            }

            // F8: forward deep-link opens (prevail://...) to the frontend so
            // OAuth/connect redirects can complete in-app.
            {
                use tauri::Emitter;
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    let urls: Vec<String> = event.urls().iter().map(|u| u.to_string()).collect();
                    let _ = handle.emit("prevail:deep-link", urls);
                });
            }

            // Memory watchdog: always-on safety net. Never fires in normal use;
            // only steps in if Prevail's footprint approaches a machine-freezing
            // fraction of physical RAM, at which point it stops the largest
            // runaway task and warns the UI.
            watchdog::start(app.handle().clone());

            Ok(())
        })
        .on_window_event(|window, event| {
            // Close-to-tray: hide instead of quitting on window close. The tray
            // "Quit" item (or ⌘Q) still exits. Gated by a pref flag the frontend
            // writes to a file the Rust side can read cheaply.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if close_to_tray_enabled() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .manage(ingestion::OrchestratorState::default())
        .manage(telegram_bridge::BridgeState::new())
        .manage(webhook_bridge::WebhookState::default())
        .manage(native_bridge::NativeBridgeState::default())
        .manage(discord_bridge::DiscordState::default())
        .manage(slack_bridge::SlackState::default())
        .manage(email_bridge::EmailState::default())
        .manage(distill::DistillState::new())
        .manage(intent_daemon::IntentDaemonState::new())
        .manage(reminders::RemindersState::new())
        .manage(taskgen::TaskGenState::new())
        .manage(skillgen::SkillGenState::new())
        .manage(webui::WebuiState::default())
        .invoke_handler(tauri::generate_handler![
            vault::scan_vault,
            vault::vault_migrate_layout,
            normalize::vault_normalize_plan,
            normalize::vault_normalize_apply,
            consolidate::vault_consolidate_plan,
            consolidate::vault_consolidate_apply,
            clis::detect_clis,
            appcmds::log_fatal,
            appcmds::import_sample_vault,
            appcmds::remember_vault,
            appcmds::vault_exists,
            appcmds::bootstrap_vault,
            settings::ui_settings_get,
            settings::ui_prefs_get,
            settings::ui_prefs_set,
            settings::profile_prefs_get,
            settings::profile_prefs_set,
            settings::ui_settings_set,
            chat::chat_send,
            chat::open_in_terminal,
            chat::summarize_conversation,
            benchmark::benchmark_runs,
            benchmark::benchmark_run_detail,
            usage::usage_append,
            usage::usage_summary,
            usage::usage_summary_domain,
            usage::engine_budget_status,
            intents::intent_append,
            intents::intents_read,
            intents::intents_read_all,
            intents::capture_prompts_read,
            intents::intents_distill,
            intents::intents_distilled_read,
            omega::read_omega,
            omega::write_omega,
            omega::omega_versions,
            omega::omega_distill,
            intent_daemon::intent_daemon_start,
            intent_daemon::intent_daemon_stop,
            intent_daemon::intent_daemon_status,
            intents::journal_append,
            intents::decision_append,
            intents::decisions_read,
            intents::decision_feedback,
            bunker::bunker_status,
            bunker::bunker_set,
            vault_lock::vault_lock_status,
            vault_lock::vault_lock_set,
            idealstate::read_memory_md,
            idealstate::append_memory_md,
            appcmds::write_text_file,
            appcmds::read_text_file,
            appcmds::save_pasted_image,
            appcmds::spark_archive_append,
            appcmds::spark_archive_read,
            appcmds::app_diagnostics,
            appcmds::app_uninstall,
            settings::set_close_to_tray,
            settings::provider_key_set,
            settings::app_secret_set,
            settings::app_secret_exists,
            settings::provider_key_exists,
            settings::provider_key_last4,
            settings::provider_key_del,
            settings::webui_secret_set,
            settings::webui_secret_get,
            webui::webui_start,
            webui::webui_stop,
            webui::webui_status,
            webui::webui_resolve,
            webui::webui_event,
            distill::distill_start,
            distill::distill_stop,
            distill::distill_status,
            distill::distill_run_once,
            distill::build_domain_state,
            surface::domain_surface,
            surface::domain_draft_ideal,
            tasks::tasks_read,
            tasks::tasks_set,
            tasks::tasks_add,
            hooks::hooks_read,
            hooks::hooks_write,
            hooks::hooks_run,
            tasks::tasks_read_all,
            tasks::work_count,
            tasks::tasks_set_status,
            tasks::tasks_set_owner,
            tasks::task_detail_get,
            tasks::task_detail_set_description,
            tasks::task_detail_add_comment,
            tasks::decisions_pending,
            reminders::reminders_check,
            reminders::reminders_due_today,
            reminders::reminders_daemon_start,
            reminders::reminders_daemon_stop,
            reminders::reminders_daemon_status,
            taskgen::taskgen_start,
            taskgen::taskgen_stop,
            taskgen::taskgen_status,
            taskgen::taskgen_run_once,
            skillgen::skillgen_start,
            skillgen::skillgen_stop,
            skillgen::skillgen_status,
            skillgen::skillgen_run_once,
            benchmark::benchmark_questions,
            benchmark::benchmark_save_question,
            benchmark::benchmark_delete_question,
            benchmark::benchmark_set_question_archived,
            benchmark::benchmark_export_questions,
            benchmark::benchmark_import_questions,
            benchmark::benchmark_matrix,
            appcmds::read_file,
            telegram::telegram_send,
            appcmds::open_in_finder,
            appcmds::move_to_applications,
            appcmds::create_domain,
            domain::domain_context,
            domain::app_context,
            domain::domain_tree,
            domain::read_domain_prompts,
            domain::scan_skills,
            domain::skill_set_enabled,
            domain::skill_create,
            children::abort_sessions,
            idealstate::read_user_md,
            idealstate::write_user_md,
            idealstate::read_ideal_state,
            idealstate::write_ideal_state,
            appcmds::write_paste_attachment,
            appcmds::write_paste_image,
            appcmds::write_voice_note,
            appcmds::save_session,
            chat::verify_cli_model,
            chat::model_oneshot,
            appcmds::read_skill,
            benchmark::benchmark_start,
            benchmark::benchmark_score,
            benchmark::benchmark_suggest,
            engine::engine_domains,
            engine::engine_apps_list,
            engine::notify_user,
            composio::composio_status,
            composio::composio_set_key,
            composio::composio_verify,
            composio::composio_connect_app,
            composio::composio_connections,
            nango::nango_status,
            nango::nango_set_key,
            nango::nango_verify,
            nango::nango_integrations,
            nango::nango_connections,
            nango::nango_connect,
            engine::engine_app_probe,
            engine::engine_app_add,
            engine::engine_gateway_app_add,
            engine::engine_app_set_domains,
            engine::engine_app_set_integration,
            engine::engine_app_set_privacy,
            engine::engine_app_set_model,
            engine::engine_app_set_account,
            engine::engine_app_set_schedule,
            engine::engine_app_get_soul,
            engine::engine_app_set_soul,
            engine::engine_app_draft_ideal,
            engine::engine_skill_draft,
            engine::engine_skill_ideas,
            engine::engine_bench_preset_suggest,
            engine::engine_vault_migrate_v4,
            engine::engine_gws_pending_list,
            engine::engine_gws_approve,
            engine::engine_autonomy_status,
            engine::engine_autonomy_set,
            engine::engine_autonomy_cap,
            engine::engine_autonomy_policy,
            engine::engine_list_playbooks,
            engine::engine_run_playbook_stream,
            engine::engine_app_set_enabled,
            engine::engine_app_runs,
            engine::engine_app_sync,
            engine::engine_app_remove,
            engine::engine_app_oauth,
            engine::engine_app_browser_login,
            google::google_cli_status,
            google::google_profiles,
            runtime_connectors::discover_runtime_connectors,
            retrospect::retrospect_rollup,
            favicon::app_favicon,
            google::google_profile_login,
            google::google_profile_remove,
            google::google_scaffold,
            google::google_cli_install_stream,
            google::google_auth_login_stream,
            engine::composio_cli_status,
            engine::composio_cli_install,
            engine::composio_cli_login,
            engine::app_data_files,
            engine::engine_apps_sync_due,
            engine::engine_app_connect,
            engine::engine_recommendations,
            engine::app_suggestions_read,
            engine::app_suggestions_generate,
            engine::model_suggestions_read,
            engine::model_scout_run,
            engine::engine_alignment,
            engine::engine_app_skills,
            engine::engine_app_skill_files,
            engine::engine_app_set_pull_instructions,
            engine::engine_app_gateway_capabilities,
            engine::engine_vault_embed,
            engine::engine_vault_migrate_data,
            engine::engine_vault_archive_data,
            engine::engine_vault_migrate_build,
            engine::engine_vault_archive_build,
            engine::engine_appmode_get,
            engine::engine_appmode_set,
            engine::engine_config_vault,
            engine::engine_set_config_vault,
            engine::engine_production_init,
            engine::engine_appmode_mark_demo,
            engine::engine_discover_models,
            engine::engine_lock_status,
            engine::engine_lock_set,
            engine::engine_lock_verify,
            engine::engine_lock_clear,
            engine::engine_lock_reset,
            engine::engine_biometric_authenticate,
            idealstate::ideal_state_versions,
            idealstate::read_domain_ideal,
            idealstate::write_domain_ideal,
            engine::engine_vault_status,
            engine::machine_role_get,
            engine::machine_role_set,
            engine::mcp_test_handshake,
            integrations::capture_status,
            integrations::capture_install,
            integrations::capture_sync,
            integrations::capture_set_enabled,
            integrations::mcp_install,
            integrations::mcp_install_status,
            integrations::set_auto_council,
            integrations::get_auto_council,
            engine::headless_learn_status,
            engine::headless_learn_set,
            engine::engine_vault_unlock,
            engine::engine_vault_lock_session,
            engine::engine_vault_encrypt,
            engine::engine_vault_decrypt,
            engine::engine_vault_recover,
            engine::engine_score,
            engine::engine_score_audit,
            engine::engine_calendar_pull,
            engine::engine_manifest_get,
            engine::engine_score_all,
            engine::engine_score_stream,
            engine::engine_connector_learn_stream,
            engine::engine_connector_run_stream,
            engine::engine_connector_import_login,
            loops::loops_run_once,
            loops::loop_execute_action,
            loops::loop_request_approval,
            approval::autonomy_classify,
            loops::loop_run_now,
            loops::loop_run_now_stream,
            loops::loop_pending_drop,
            activity::activity_read,
            engine::engine_score_history,
            engine::engine_onboard_recommend,
            engine::engine_onboard_apply,
            engine::engine_vault_backup,
            engine::vault_backup_to,
            engine::vault_backup_dir,
            engine::vault_backups_list,
            engine::vault_restore_archive,
            engine::engine_vault_archive,
            engine::engine_vault_restore,
            engine::engine_list_archived,
            engine::engine_manifest_set,
            engine::engine_chat,
            engine::route_learn_record,
            engine::engine_agent_run,
            engine::engine_app_run_skill,
            threads::list_threads,
            threads::load_thread,
            threads::save_thread,
            threads::rename_thread,
            threads::delete_thread,
            ingestion::ingestion_status,
            ingestion::ingestion_mcp_list,
            ingestion::ingestion_mcp_start,
            ingestion::ingestion_mcp_stop,
            ingestion::ingestion_composio_set_key,
            ingestion::ingestion_composio_start,
            ingestion::ingestion_composio_stop,
            ingestion::ingestion_keychain_set,
            ingestion::ingestion_keychain_del,
            ingestion::ingestion_mcp_config_path,
            ingestion::ingestion_mcp_config_init,
            ingestion::ingestion_mcp_reload,
            ingestion::ingestion_list_artifacts,
            ingestion::ingestion_mcp_stderr,
            ingestion::ingestion_connector_catalog,
            ingestion::ingestion_connector_logos,
            ingestion::ingestion_cli_providers,
            ingestion::ingestion_cli_probe,
            ingestion::ingestion_cli_run,
            ingestion::ingestion_domain_stats,
            ingestion::ingestion_audit_tail,
            ingestion::ingestion_vacuum_imports,
            telegram_bridge::telegram_bridge_start,
            telegram_bridge::telegram_bridge_stop,
            telegram_bridge::telegram_bridge_status,
            gateway_log::gateway_log_read,
            gateway_log::gateway_log_clear,
            webhook_bridge::webhook_bridge_start,
            webhook_bridge::webhook_bridge_stop,
            webhook_bridge::webhook_bridge_status,
            native_bridge::native_bridge_start,
            native_bridge::native_bridge_stop,
            native_bridge::native_bridge_status,
            discord_bridge::discord_bridge_start,
            discord_bridge::discord_bridge_stop,
            discord_bridge::discord_bridge_status,
            slack_bridge::slack_bridge_start,
            slack_bridge::slack_bridge_stop,
            slack_bridge::slack_bridge_status,
            email_bridge::email_bridge_start,
            email_bridge::email_bridge_stop,
            email_bridge::email_bridge_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod path_safety_tests {
    use super::*;
    use crate::paths::{guard_managed_path, is_safe_domain, safe_domain_subdir};

    #[test]
    fn safe_domain_rejects_traversal_and_separators() {
        assert!(is_safe_domain("wealth"));
        assert!(is_safe_domain("real-estate"));
        assert!(is_safe_domain("a_b"));
        assert!(!is_safe_domain(".."));
        assert!(!is_safe_domain("../etc"));
        assert!(!is_safe_domain("a/b"));
        assert!(!is_safe_domain(".hidden"));
        assert!(!is_safe_domain(""));
        assert!(!is_safe_domain(&"x".repeat(65)));
    }

    #[test]
    fn safe_domain_subdir_rejects_unsafe_instead_of_root_fallback() {
        // Safe domain → joined under the domain.
        let ok = safe_domain_subdir("/v", &Some("wealth".into()), "_threads").unwrap();
        assert!(ok.ends_with("wealth/_threads"));
        // No domain → vault root sub (General space).
        let none = safe_domain_subdir("/v", &None, "_threads").unwrap();
        assert!(none.ends_with("_threads") && !none.to_string_lossy().contains("wealth"));
        // Unsafe domain → ERROR, not a silent vault-root write.
        assert!(safe_domain_subdir("/v", &Some("../escape".into()), "_threads").is_err());
        assert!(safe_domain_subdir("/v", &Some("a/b".into()), "_log").is_err());
    }

    #[test]
    fn guard_managed_path_basics() {
        // Relative paths and traversal are rejected before any FS touch.
        assert!(guard_managed_path("relative/_threads/x.md", "/_threads/", ".md").is_err());
        assert!(guard_managed_path("/v/_threads/../../x.md", "/_threads/", ".md").is_err());
        // Wrong shape rejected.
        assert!(guard_managed_path("/v/_threads/x.txt", "/_threads/", ".md").is_err());
        assert!(guard_managed_path("/v/notthreads/x.md", "/_threads/", ".md").is_err());
    }
}

#[cfg(test)]
mod env_scrub_tests {
    use super::*;
    use crate::chat::is_secret_env_key;

    #[test]
    fn secret_keys_are_classified() {
        // Mirrors cli-bridge.ts SECRET_ENV_PREFIXES / SECRET_ENV_SUBSTRINGS.
        for k in [
            "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY",
            "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "GITHUB_TOKEN", "GH_TOKEN",
            "TELEGRAM_BOT_TOKEN", "PREVAIL_TELEGRAM_TOKEN", "OP_SERVICE_ACCOUNT_TOKEN",
            "MY_CLIENT_SECRET", "SSH_PRIVATE_KEY", "DB_PASSWORD",
        ] {
            assert!(is_secret_env_key(k), "{k} should be treated as secret");
        }
        // Things the CLIs legitimately need must NOT be stripped.
        for k in ["PATH", "HOME", "USER", "LOGNAME", "LANG", "TERM", "PREVAIL_OPENROUTER_KEY", "PREVAIL_OLLAMA_URL"] {
            assert!(!is_secret_env_key(k), "{k} must survive the scrub");
        }
    }

    #[test]
    fn scrubbed_env_omits_a_seeded_secret() {
        std::env::set_var("ANTHROPIC_API_KEY", "sk-should-not-leak");
        std::env::set_var("HOME", "/Users/test");
        let pairs = scrubbed_env_pairs();
        assert!(pairs.iter().all(|(k, _)| k != "ANTHROPIC_API_KEY"), "secret leaked into child env");
        assert!(pairs.iter().any(|(k, _)| k == "HOME"), "HOME must be preserved for CLI auth");
        std::env::remove_var("ANTHROPIC_API_KEY");
    }
}

#[cfg(test)]
mod usage_tests {
    use super::*;
    use crate::intents::{decision_append, decision_feedback, decisions_read, intent_append, intents_read, journal_append};
    use crate::usage::{
        map_eng_summary, migrate_legacy_usage, usage_record_payload, EngBucket, EngSummary,
        UsageRecord,
    };

    fn rec(
        day: &str,
        cli: &str,
        model: Option<&str>,
        domain: Option<&str>,
        inp: Option<u64>,
        out: Option<u64>,
        cost: Option<f64>,
        ok: bool,
    ) -> UsageRecord {
        UsageRecord {
            ts: 0,
            day: day.to_string(),
            domain: domain.map(|s| s.to_string()),
            thread: None,
            cli: cli.to_string(),
            model: model.map(|s| s.to_string()),
            input_tokens: inp,
            output_tokens: out,
            cost_usd: cost,
            ok,
        }
    }

    // Aggregation + pricing now live in the engine (prevail-cli usage.ts, tested
    // there). The desktop only owns (1) translating a turn into the engine's
    // record input, (2) mapping the engine's roll-up shape to the frontend's,
    // and (3) the one-time legacy-ledger migration. Those are what we test here.

    #[test]
    fn record_payload_maps_to_engine_camelcase() {
        let r = rec("2026-06-06", "claude", Some("opus"), Some("wealth"), Some(100), Some(40), Some(0.12), true);
        let p = usage_record_payload(&r);
        // Engine RecordUsageInput is camelCase and takes tokens, not cost.
        assert_eq!(p["cli"], "claude");
        assert_eq!(p["model"], "opus");
        assert_eq!(p["domain"], "wealth");
        assert_eq!(p["inputTokens"], 100);
        assert_eq!(p["outputTokens"], 40);
        assert_eq!(p["surface"], "chat");
        assert!(p.get("cost_usd").is_none(), "cost is the engine's job");
        // No thread → a stable default session.
        assert_eq!(p["session"], "desktop");
    }

    #[test]
    fn maps_engine_summary_shape_to_frontend() {
        let eng = EngSummary {
            total: EngBucket { key: "__total__".into(), calls: 3, input_tokens: 300, output_tokens: 100, est_cost_usd: 0.42 },
            by_day: vec![EngBucket { key: "2026-06-06".into(), calls: 2, input_tokens: 200, output_tokens: 60, est_cost_usd: 0.30 }],
            by_cli: vec![EngBucket { key: "claude".into(), calls: 2, input_tokens: 300, output_tokens: 100, est_cost_usd: 0.42 }],
            by_model: vec![],
            by_domain: vec![],
        };
        let s = map_eng_summary(eng);
        assert_eq!(s.total_turns, 3);
        assert_eq!(s.total_input_tokens, 300);
        assert!((s.total_cost_usd - 0.42).abs() < 1e-9);
        assert_eq!(s.by_cli[0].key, "claude");
        assert_eq!(s.by_cli[0].turns, 2); // calls → turns
        assert_eq!(s.by_day[0].key, "2026-06-06");
    }

    #[test]
    fn migrates_legacy_ledger_once_into_engine_ledger() {
        let vault = std::env::temp_dir().join(format!("prevail-usage-mig-{}", std::process::id()));
        let _ = fs::remove_dir_all(&vault);
        let usage_dir = vault.join("usage");
        fs::create_dir_all(&usage_dir).unwrap();
        // Two legacy desktop records.
        let l1 = serde_json::to_string(&rec("2026-06-06", "claude", Some("opus"), Some("wealth"), Some(100), Some(40), Some(0.12), true)).unwrap();
        let l2 = serde_json::to_string(&rec("2026-06-07", "codex", None, None, None, None, None, true)).unwrap();
        fs::write(usage_dir.join("usage.ndjson"), format!("{l1}\n{l2}\n")).unwrap();

        migrate_legacy_usage(&vault.to_string_lossy());

        // Engine ledger now has both lines, in the engine schema.
        let engine_ledger = vault.join("_meta").join("usage.jsonl");
        let raw = read_to_string_retry(&engine_ledger).expect("engine ledger written");
        let lines: Vec<&str> = raw.lines().filter(|l| !l.trim().is_empty()).collect();
        assert_eq!(lines.len(), 2);
        let first: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(first["est_cost_usd"], 0.12); // legacy cost preserved
        assert_eq!(first["input_tokens"], 100);
        assert_eq!(first["session"], "desktop");

        // Marker prevents a second migration from double-appending.
        assert!(vault.join("usage").join(".migrated-to-engine").exists());
        migrate_legacy_usage(&vault.to_string_lossy());
        let raw2 = read_to_string_retry(&engine_ledger).unwrap();
        assert_eq!(raw2.lines().filter(|l| !l.trim().is_empty()).count(), 2, "idempotent");

        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn intent_ledger_and_journal_roundtrip() {
        let vault = std::env::temp_dir().join(format!("prevail-intent-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&vault);
        let vault_s = vault.to_string_lossy().to_string();

        // An intent + its raw reply, both tied to the same session, in a domain.
        intent_append(
            vault_s.clone(),
            Some("wealth".into()),
            serde_json::json!({
                "kind": "intent", "session": "s1", "domain": "wealth",
                "model": "opus", "message": "net worth?", "prompt": "FULL PROMPT net worth?",
                "prefs": { "framework": "first-principles", "web": true }
            }),
        )
        .unwrap();
        intent_append(
            vault_s.clone(),
            Some("wealth".into()),
            serde_json::json!({ "kind": "reply", "session": "s1", "model": "opus", "raw": "\u{1b}[1mRAW\u{1b}[0m reply", "ok": true }),
        )
        .unwrap();
        // No-domain (General) intent goes to the vault root.
        intent_append(vault_s.clone(), None, serde_json::json!({ "kind": "intent", "session": "s2", "message": "hi" })).unwrap();

        // Domain ledger: two lines, both valid JSON, prompt + raw preserved verbatim.
        // New domains now default to the v3 layout (<vault>/domains/<domain>).
        let dom_ledger = read_to_string_retry(vault.join("domains").join("wealth").join("_intents.jsonl")).expect("domain ledger written");
        let lines: Vec<&str> = dom_ledger.lines().filter(|l| !l.trim().is_empty()).collect();
        assert_eq!(lines.len(), 2);
        let intent: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(intent["prompt"], "FULL PROMPT net worth?");
        assert_eq!(intent["prefs"]["framework"], "first-principles");
        let reply: serde_json::Value = serde_json::from_str(lines[1]).unwrap();
        assert!(reply["raw"].as_str().unwrap().contains("RAW")); // raw, escape codes intact
        // Root ledger holds the General turn.
        assert!(read_to_string_retry(vault.join("_intents.jsonl")).unwrap().contains("\"s2\""));

        // Journal: header + newest-first ordering.
        journal_append(vault_s.clone(), Some("wealth".into()), "- 2026-06-07 09:00 · [opus] first".into()).unwrap();
        journal_append(vault_s.clone(), Some("wealth".into()), "- 2026-06-07 10:00 · [opus] second".into()).unwrap();
        let journal = read_to_string_retry(vault.join("domains").join("wealth").join("_journal.md")).unwrap();
        assert!(journal.starts_with("# Journal\n\n"));
        let i_first = journal.find("first").unwrap();
        let i_second = journal.find("second").unwrap();
        assert!(i_second < i_first, "newest entry should be on top");

        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn decision_log_append_read_feedback() {
        let vault = std::env::temp_dir().join(format!("prevail-decision-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&vault);
        let vault_s = vault.to_string_lossy().to_string();

        decision_append(
            vault_s.clone(),
            Some("health".into()),
            serde_json::json!({ "id": "d-1", "kind": "council", "ts": 1, "verdict": "go with Mayo" }),
        )
        .unwrap();
        decision_append(
            vault_s.clone(),
            Some("health".into()),
            serde_json::json!({ "id": "d-2", "kind": "chat", "ts": 2, "verdict": "annual physical in March" }),
        )
        .unwrap();

        // Read returns newest-first.
        let recs = decisions_read(vault_s.clone(), Some("health".into()), None).unwrap();
        assert_eq!(recs.len(), 2);
        assert_eq!(recs[0]["id"], "d-2");
        assert_eq!(recs[1]["id"], "d-1");

        // limit caps the result.
        let one = decisions_read(vault_s.clone(), Some("health".into()), Some(1)).unwrap();
        assert_eq!(one.len(), 1);
        assert_eq!(one[0]["id"], "d-2");

        // Feedback attaches to the right record and survives a re-read.
        decision_feedback(vault_s.clone(), Some("health".into()), "d-1".into(), "up".into(), Some("spot on".into())).unwrap();
        let after = decisions_read(vault_s.clone(), Some("health".into()), None).unwrap();
        let d1 = after.iter().find(|r| r["id"] == "d-1").unwrap();
        assert_eq!(d1["feedback"]["rating"], "up");
        assert_eq!(d1["feedback"]["note"], "spot on");

        // clear removes the feedback.
        decision_feedback(vault_s.clone(), Some("health".into()), "d-1".into(), "clear".into(), None).unwrap();
        let cleared = decisions_read(vault_s.clone(), Some("health".into()), None).unwrap();
        let d1c = cleared.iter().find(|r| r["id"] == "d-1").unwrap();
        assert!(d1c.get("feedback").is_none());

        // Unknown id errors.
        assert!(decision_feedback(vault_s.clone(), Some("health".into()), "nope".into(), "up".into(), None).is_err());

        let _ = fs::remove_dir_all(&vault);
    }
}

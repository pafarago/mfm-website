<?php
/**
 * Plugin Name: MFM Docs
 * Description: Shows Google Drive folders (Handbook, Public Documents, Memorial Minutes) as numbered document lists, with cached PDF and Word copies. Replaces embed-all-shortcode.
 * Version:     1.0.1
 * Requires at least: 6.5
 * Requires PHP: 8.1
 * Author:      Midlothian Friends Meeting
 * License:     GPL-2.0-or-later
 * Text Domain: mfm-docs
 *
 * Overview
 *   Settings → MFM Docs        entry folders, status, Refresh button
 *   /docs/<entry>/             top of an entry (e.g. /docs/handbook/)
 *   /docs/<entry>/<folderId>/  a sub-folder
 *   /docs/file/<fileId>.pdf    a document as PDF (exported/converted if needed)
 *   /docs/file/<fileId>.docx   the Word version, where one exists
 *   [mfm_doc id="…"]           one document as a card
 *   [embed-all id="…"]         old shortcode: a folder list or a document card
 *   /embed?id=…                old links, redirected once embed-all is off
 *
 * Nothing here needs Composer: Google sign-in uses PHP's OpenSSL, and Drive
 * is called through WordPress's HTTP functions.
 */

defined( 'ABSPATH' ) || exit;

define( 'MFM_DOCS_VERSION', '1.0.1' );
// Paths go through WordPress's plugin folder, not __FILE__/__DIR__: on the
// droplet this folder is a link into a release, and PHP reports (and caches)
// the physical release path, which then leaks into URLs and goes stale.
define( 'MFM_DOCS_DIR', WP_PLUGIN_DIR . '/' . basename( __DIR__ ) );
define( 'MFM_DOCS_FILE', MFM_DOCS_DIR . '/mfm-docs.php' );

// Both can be overridden in wp-config.php.
if ( ! defined( 'MFM_DOCS_CACHE_DIR' ) ) {
	define( 'MFM_DOCS_CACHE_DIR', '/var/cache/mfm-docs' );
}
if ( ! defined( 'MFM_DOCS_KEY_FILE' ) ) {
	define( 'MFM_DOCS_KEY_FILE', '/var/opt/GoogleAPI/google-service-account.json' );
}

require MFM_DOCS_DIR . '/includes/class-mfm-docs-log.php';
require MFM_DOCS_DIR . '/includes/class-mfm-docs-settings.php';
require MFM_DOCS_DIR . '/includes/class-mfm-docs-google.php';
require MFM_DOCS_DIR . '/includes/class-mfm-docs-titles.php';
require MFM_DOCS_DIR . '/includes/class-mfm-docs-library.php';
require MFM_DOCS_DIR . '/includes/class-mfm-docs-cache.php';
require MFM_DOCS_DIR . '/includes/class-mfm-docs-render.php';
require MFM_DOCS_DIR . '/includes/class-mfm-docs-front.php';
require MFM_DOCS_DIR . '/includes/class-mfm-docs-admin.php';

MFM_Docs_Front::init();
MFM_Docs_Admin::init();
MFM_Docs_Library::init();

if ( defined( 'WP_CLI' ) && WP_CLI ) {
	require MFM_DOCS_DIR . '/includes/class-mfm-docs-cli.php';
	WP_CLI::add_command( 'mfm-docs', 'MFM_Docs_CLI' );
}

register_activation_hook( MFM_DOCS_FILE, function () {
	MFM_Docs_Front::add_rewrites();
	flush_rewrite_rules();
	MFM_Docs_Library::schedule();
	MFM_Docs_Library::rescan_citations();
} );

register_deactivation_hook( MFM_DOCS_FILE, function () {
	wp_clear_scheduled_hook( MFM_Docs_Library::CRON_HOOK );
	flush_rewrite_rules();
} );

<?php
/**
 * wp mfm-docs sync | status
 */

defined( 'ABSPATH' ) || exit;

class MFM_Docs_CLI {

	/**
	 * Re-list Drive and prepare missing PDF/Word copies.
	 *
	 * ## OPTIONS
	 * [--budget=<seconds>]
	 * : Time allowed for conversions. Default 600.
	 */
	public function sync( $args, $assoc ) {
		$r = MFM_Docs_Library::sync( (int) ( $assoc['budget'] ?? 600 ) );
		if ( ! $r['ok'] ) {
			WP_CLI::error( $r['error'] );
		}
		WP_CLI::success( sprintf( '%d folders, %d documents, %d copies prepared.', $r['folders'], $r['files'], $r['converted'] ) );
	}

	/** Show configuration and cache status. */
	public function status() {
		$tree  = MFM_Docs_Library::tree();
		$stats = MFM_Docs_Cache::stats();
		WP_CLI::line( 'Service account: ' . ( MFM_Docs_Google::account_email() ?: 'key not readable at ' . MFM_DOCS_KEY_FILE ) );
		WP_CLI::line( 'Cache: ' . MFM_Docs_Cache::dir() . ( MFM_Docs_Cache::writable() ? '' : ' (NOT WRITABLE)' ) . " — {$stats['count']} files" );
		WP_CLI::line( 'LibreOffice: ' . ( MFM_Docs_Cache::soffice() ?: 'not found' ) );
		WP_CLI::line( 'Last sync: ' . ( $tree['synced'] ? human_time_diff( $tree['synced'] ) . ' ago' : 'never' ) . sprintf( ' — %d folders, %d documents', count( $tree['folders'] ), count( $tree['files'] ) ) );
		foreach ( MFM_Docs_Settings::entries() as $e ) {
			WP_CLI::line( sprintf( '  /docs/%s/  %s  (%s)', $e['slug'], $e['title'], $e['folder'] ) );
		}
	}
}
